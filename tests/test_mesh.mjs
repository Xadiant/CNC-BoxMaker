import assert from "node:assert/strict";
import test from "node:test";

import { miteredCellSpan } from "../static/mesh.js";

test("mitered cell spans taper toward the inner wall face", () => {
  assert.deepEqual(miteredCellSpan(0, 12, 0, 0, 450), [0, 12]);
  assert.deepEqual(miteredCellSpan(0, 12, 5, 0, 450), [5, 12]);
  assert.deepEqual(miteredCellSpan(0, 12, 12, 0, 450), [12, 12]);
  assert.deepEqual(miteredCellSpan(12, 438, 12, 0, 450), [12, 438]);
  assert.deepEqual(miteredCellSpan(438, 450, 5, 0, 450), [438, 445]);
});
