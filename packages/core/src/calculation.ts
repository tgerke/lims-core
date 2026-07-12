import {
  analysisCalculationInputs,
  analysisCalculations,
  analysisRequests,
  results,
} from "@lims-core/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";
import { enterResult } from "./results.js";

/**
 * Evaluates a restricted arithmetic expression over named variables (ADR-0020).
 * Supports + - * / , parentheses, unary minus, decimal numbers, and identifiers
 * bound in `vars`. No `eval`: a hand-written recursive-descent parser, so the
 * only things it can compute are arithmetic over the supplied variables. Throws
 * a DomainError on a parse error, an unknown variable, or division by zero.
 *
 *   grammar:  expr   := term (('+' | '-') term)*
 *             term   := factor (('*' | '/') factor)*
 *             factor := '-' factor | '(' expr ')' | number | identifier
 */
export function evaluateExpression(expr: string, vars: Record<string, number>): number {
  // Tokenize: numbers, identifiers, operators, parentheses; whitespace ignored.
  const tokens = expr.match(/\d+\.?\d*|\.\d+|[A-Za-z_]\w*|[+\-*/()]/g) ?? [];
  const consumed = tokens.join("").length;
  if (consumed !== expr.replace(/\s+/g, "").length) {
    throw new DomainError(`invalid character in expression: ${expr}`);
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new DomainError("division by zero in calculation");
        value /= rhs;
      } else {
        value *= rhs;
      }
    }
    return value;
  }

  function parseFactor(): number {
    const token = peek();
    if (token === undefined) throw new DomainError("unexpected end of expression");
    if (token === "-") {
      next();
      return -parseFactor();
    }
    if (token === "(") {
      next();
      const value = parseExpr();
      if (next() !== ")") throw new DomainError("unbalanced parentheses in expression");
      return value;
    }
    if (/^[A-Za-z_]/.test(token)) {
      next();
      if (!(token in vars)) throw new DomainError(`unknown variable in expression: ${token}`);
      return vars[token] as number;
    }
    if (/^[\d.]/.test(token)) {
      next();
      return Number(token);
    }
    throw new DomainError(`unexpected token in expression: ${token}`);
  }

  const result = parseExpr();
  if (pos !== tokens.length) throw new DomainError(`unexpected token in expression: ${peek()}`);
  if (!Number.isFinite(result))
    throw new DomainError("calculation did not produce a finite number");
  return result;
}

/** The active calculation for a service with its input variable bindings, or null. */
export async function activeCalculation(tx: Tx, serviceId: string) {
  const [calc] = await tx
    .select()
    .from(analysisCalculations)
    .where(
      and(eq(analysisCalculations.serviceId, serviceId), eq(analysisCalculations.active, true)),
    )
    .orderBy(desc(analysisCalculations.effectiveFrom))
    .limit(1);
  if (!calc) return null;
  const inputs = await tx
    .select()
    .from(analysisCalculationInputs)
    .where(eq(analysisCalculationInputs.calculationId, calc.id));
  return { calc, inputs };
}

export interface CreateCalculationInput {
  serviceId: string;
  expression: string;
  inputs: { variable: string; inputServiceId: string }[];
  actorId: string;
}

/**
 * Sets a service's formula, superseding any active one (the prior row is
 * deactivated, not edited). Validates that the expression parses against exactly
 * the declared variables so a formula that references an undeclared input, or
 * declares an unused one, is rejected at definition time rather than at compute.
 */
export async function createCalculation(tx: Tx, input: CreateCalculationInput) {
  if (input.inputs.length === 0) throw new DomainError("a calculation needs at least one input");
  const variables = input.inputs.map((i) => i.variable);
  if (new Set(variables).size !== variables.length) {
    throw new DomainError("calculation input variables must be unique");
  }
  if (input.inputs.some((i) => i.inputServiceId === input.serviceId)) {
    throw new DomainError("a calculation cannot use its own service as an input");
  }
  // Parse-check against the declared variables (dummy values); surfaces unknown
  // variables and syntax errors now. Uses distinct non-zero values so a stray
  // division by a variable does not spuriously trip the zero guard.
  const probe = Object.fromEntries(variables.map((v, i) => [v, i + 1]));
  evaluateExpression(input.expression, probe);

  await tx
    .update(analysisCalculations)
    .set({ active: false })
    .where(
      and(
        eq(analysisCalculations.serviceId, input.serviceId),
        eq(analysisCalculations.active, true),
      ),
    );

  const [calc] = await tx
    .insert(analysisCalculations)
    .values({
      serviceId: input.serviceId,
      expression: input.expression,
      createdBy: input.actorId,
    })
    .returning();
  if (!calc) throw new Error("calculation insert returned no row");

  await tx.insert(analysisCalculationInputs).values(
    input.inputs.map((i) => ({
      calculationId: calc.id,
      variable: i.variable,
      inputServiceId: i.inputServiceId,
    })),
  );
  return calc;
}

/**
 * Computes a calculated result for an order (ADR-0020): loads the service's
 * active formula, gathers the current result of each input service on the same
 * sample, evaluates the expression, and appends the value as a `calculated`
 * result — reusing enterResult, so it is versioned and spec-evaluated exactly
 * like a measured one. Fails if the service has no formula or an input has no
 * current numeric result yet.
 */
export async function computeCalculatedResult(
  tx: Tx,
  input: { requestId: string; actorId: string; reasonForChange?: string },
) {
  const [request] = await tx
    .select()
    .from(analysisRequests)
    .where(eq(analysisRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new DomainError("analysis request not found", 404);

  const found = await activeCalculation(tx, request.serviceId);
  if (!found) throw new DomainError("this service has no active calculation", 409);
  const { calc, inputs } = found;

  // Current result per input service on the same sample. One query for all input
  // services' orders on the sample, then the latest version per request.
  const inputServiceIds = inputs.map((i) => i.inputServiceId);
  const inputRequests = await tx
    .select({ id: analysisRequests.id, serviceId: analysisRequests.serviceId })
    .from(analysisRequests)
    .where(
      and(
        eq(analysisRequests.sampleId, request.sampleId),
        inArray(analysisRequests.serviceId, inputServiceIds),
      ),
    );
  const requestByService = new Map(inputRequests.map((r) => [r.serviceId, r.id]));

  const vars: Record<string, number> = {};
  for (const { variable, inputServiceId } of inputs) {
    const inputRequestId = requestByService.get(inputServiceId);
    if (!inputRequestId) {
      throw new DomainError(`no order for input "${variable}" on this sample`, 409);
    }
    const [current] = await tx
      .select({ value: results.value })
      .from(results)
      .where(eq(results.requestId, inputRequestId))
      .orderBy(desc(results.version))
      .limit(1);
    const numeric = current ? Number(current.value) : Number.NaN;
    if (!current || current.value.trim() === "" || Number.isNaN(numeric)) {
      throw new DomainError(`input "${variable}" has no numeric result yet`, 409);
    }
    vars[variable] = numeric;
  }

  const value = evaluateExpression(calc.expression, vars);
  return enterResult(tx, {
    requestId: request.id,
    value: String(value),
    source: "calculated",
    ...(input.reasonForChange ? { reasonForChange: input.reasonForChange } : {}),
    enteredBy: input.actorId,
  });
}
