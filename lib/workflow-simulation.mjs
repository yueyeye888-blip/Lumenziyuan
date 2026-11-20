const scenarios = new Set(["success", "failure", "timeout"]);

/**
 * @typedef {"success" | "failure" | "timeout"} WorkflowTestScenario
 * @typedef {import("./personal-details").PersonalDetails} PersonalDetails
 */

/**
 * @param {PersonalDetails} profile
 * @param {unknown} rawScenario
 * @param {string} requestNo
 */
export function createWorkflowSimulation(profile, rawScenario, requestNo) {
  if (typeof rawScenario !== "string" || !scenarios.has(rawScenario)) {
    throw new Error("测试场景无效");
  }

  if (rawScenario === "failure") {
    return {
      testOnly: true,
      status: "failed",
      requestNo,
      message: "模拟服务返回失败；可以检查失败提示和重试操作。",
      result: null,
    };
  }

  if (rawScenario === "timeout") {
    return {
      testOnly: true,
      status: "timed_out",
      requestNo,
      message: "模拟任务超时；可以检查超时提示和重试操作。",
      result: null,
    };
  }

  return {
    testOnly: true,
    status: "completed",
    requestNo,
    message: "模拟处理完成；结果已回显在当前合伙人页面。",
    result: {
      label: "SAMPLE · NOT VALID · MOCK RESULT",
      profile,
    },
  };
}
