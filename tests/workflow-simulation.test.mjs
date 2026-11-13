import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkflowSimulation } from "../lib/workflow-simulation.mjs";

const profile = {
  fullName: "TEST USER",
  addressLines: ["1 TEST STREET", "SAMPLE CITY", ""],
  recipientEmail: "tester@example.invalid",
};

test("success returns the submitted data only as a marked mock result", () => {
  const result = createWorkflowSimulation(profile, "success", "MOCK-1234");

  assert.equal(result.testOnly, true);
  assert.equal(result.status, "completed");
  assert.match(result.result.label, /SAMPLE · NOT VALID/);
  assert.deepEqual(result.result.profile, profile);
});

test("failure and timeout return no generated result", () => {
  for (const [scenario, expectedStatus] of [["failure", "failed"], ["timeout", "timed_out"]]) {
    const result = createWorkflowSimulation(profile, scenario, "MOCK-1234");
    assert.equal(result.status, expectedStatus);
    assert.equal(result.result, null);
    assert.match(result.message, /模拟/);
  }
});

test("unsupported scenarios are rejected", () => {
  assert.throws(
    () => createWorkflowSimulation(profile, "external-site", "MOCK-1234"),
    /测试场景无效/,
  );
});
