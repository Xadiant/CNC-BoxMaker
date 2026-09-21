import assert from "node:assert/strict";
import test from "node:test";

import { evaluateArithmetic } from "../static/arithmetic.js";

test("evaluates fractions and decimal addition", () => {
  assert.equal(evaluateArithmetic("1/32"), 0.03125);
  assert.ok(Math.abs(evaluateArithmetic("0.1+.2") - 0.3) < 1e-12);
});

test("uses standard precedence and parentheses", () => {
  assert.equal(evaluateArithmetic("2 + 3 * 4"), 14);
  assert.equal(evaluateArithmetic("(2 + 3) * 4"), 20);
  assert.equal(evaluateArithmetic("-(1 - 3) / 2"), 1);
  assert.equal(evaluateArithmetic("1e-2 * 5"), 0.05);
});

test("rejects malformed and non-finite expressions", () => {
  assert.throws(() => evaluateArithmetic(""), /Enter a value/);
  assert.throws(() => evaluateArithmetic("2 +"), /Expected a number/);
  assert.throws(() => evaluateArithmetic("2 apples"), /Unexpected/);
  assert.throws(() => evaluateArithmetic("1 / 0"), /finite number/);
  assert.throws(() => evaluateArithmetic("(1 + 2"), /Expected “\)”/);
});
