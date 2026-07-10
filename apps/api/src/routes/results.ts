import { enterResult, signResult, verifyResult, withActor } from "@lims-core/core";
import { analysisRequests } from "@lims-core/db";
import { resultEntrySchema, signRequestSchema } from "@lims-core/schemas";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { hasPermission } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

export const resultRoutes: FastifyPluginAsync = async (app) => {
  async function loadScopedOrder(request: FastifyRequest, reply: FastifyReply) {
    const { orderId } = request.params as { orderId: string };
    const [order] = await app.db
      .select()
      .from(analysisRequests)
      .where(eq(analysisRequests.id, orderId))
      .limit(1);
    if (!order) {
      await reply.code(404).send({ error: "analysis request not found" });
      return null;
    }
    return order;
  }

  app.post("/orders/:orderId/results", async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = resultEntrySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const order = await loadScopedOrder(request, reply);
    if (!order) return;
    if (!(await hasPermission(app.db, user.id, "result.enter", { studyId: order.studyId }))) {
      return reply.code(403).send({ error: "missing permission: result.enter" });
    }
    try {
      const row = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        enterResult(tx, {
          requestId: order.id,
          value: parsed.data.value,
          ...(parsed.data.unit ? { unit: parsed.data.unit } : {}),
          ...(parsed.data.reasonForChange ? { reasonForChange: parsed.data.reasonForChange } : {}),
          enteredBy: user.id,
        }),
      );
      return reply.code(201).send(row);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.post("/orders/:orderId/verify", async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const order = await loadScopedOrder(request, reply);
    if (!order) return;
    if (!(await hasPermission(app.db, user.id, "result.verify", { studyId: order.studyId }))) {
      return reply.code(403).send({ error: "missing permission: result.verify" });
    }
    try {
      const row = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        verifyResult(tx, { requestId: order.id, verifiedBy: user.id }),
      );
      return row;
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  // E-sign with password step-up (ADR-0003, §11.200(a)): the signer re-enters
  // their password on every signature; failures count toward lockout.
  app.post("/orders/:orderId/sign", async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = signRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const order = await loadScopedOrder(request, reply);
    if (!order) return;
    if (!(await hasPermission(app.db, user.id, "result.sign", { studyId: order.studyId }))) {
      return reply.code(403).send({ error: "missing permission: result.sign" });
    }

    const reauth = await app.authService.reauthenticate(user.id, parsed.data.password);
    if (!reauth.ok) {
      const status = reauth.reason === "no_password" ? 409 : 401;
      return reply
        .code(status)
        .send({ error: `signature re-authentication failed: ${reauth.reason}` });
    }

    try {
      const signature = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        signResult(tx, { requestId: order.id, signerId: user.id, meaning: parsed.data.meaning }),
      );
      return reply.code(201).send(signature);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });
};
