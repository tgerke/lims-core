import { DomainError } from "@lims-core/core";
import type { FastifyReply } from "fastify";

/** Maps DomainError onto the reply; rethrows anything else. */
export async function sendDomainError(reply: FastifyReply, err: unknown): Promise<void> {
  if (err instanceof DomainError) {
    await reply.code(err.statusCode).send({ error: err.message });
    return;
  }
  throw err;
}
