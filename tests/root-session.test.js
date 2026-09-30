import assert from "node:assert/strict";
import test from "node:test";
import { createRootSessionFilter } from "../root-session.js";

test("root filter accepts only explicit roots and reports unknown ancestry", () => {
  let diagnostics = 0;
  const isRoot = createRootSessionFilter((id) => id === "root" ? "root" : id === "child" ? "root" : undefined, () => diagnostics++);
  assert.equal(isRoot("root"), true);
  assert.equal(isRoot("child"), false);
  assert.equal(isRoot("unknown"), false);
  assert.equal(isRoot(""), false);
  assert.equal(diagnostics, 1);
});
