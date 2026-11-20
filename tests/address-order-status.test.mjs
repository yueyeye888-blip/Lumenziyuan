import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { orderDisplay, orderStep, orderTime } from "../lib/order-presentation.mjs";

test("payment confirmation remains unfulfilled until a completion callback", () => {
  const view = orderDisplay({ status: "payment_confirmed" });
  assert.equal(orderStep("payment_confirmed"), 4);
  assert.equal(view.tone, "working");
  assert.ok(!/预计|处理完成|2 分钟/.test(view.detail + view.title));
  assert.equal(orderStep("delivered"), 5);
  assert.equal(orderDisplay({ status: "delivered" }).tone, "ready");
});

test("failure preserves the actual cause instead of a completion indicator", () => {
  assert.equal(orderDisplay({ status: "failed", error: "Mail authorization unavailable" }).detail, "Mail authorization unavailable");
  assert.equal(orderDisplay({ status: "failed" }).tone, "error");
  assert.equal(orderDisplay({ status: "new-future-status" }).tone, "working");
});

test("employee order API does not expose payment destination", async () => {
  const source = await readFile(path.join(root, "app", "api", "address-orders", "[requestNo]", "route.ts"), "utf8");
  assert.ok(!source.includes("row.externalOrderUrl"));
  assert.ok(!source.includes("row.paymentAmount"));
  assert.ok(!source.includes("row.paymentNetwork"));
  assert.ok(!source.includes("row.paymentAddress"));
});

test("a queued order gets an honest warning after three minutes without changing state", () => {
  const row = { status: "queued", updatedAt: "2026-11-15 06:38:19" };
  const before = orderTime(row.updatedAt) + 179999;
  assert.equal(orderDisplay(row, before).tone, "working");
  const display = orderDisplay(row, before + 1);
  assert.equal(display.tone, "warning");
  assert.ok(display.detail.includes("无需再次提交"));
  assert.equal(row.status, "queued");
  assert.equal(orderStep(row.status), 1);
});

test("SQL UTC timestamps and ISO timestamps have the same age across timezones", () => {
  assert.equal(orderTime("2026-11-15 06:38:19"), orderTime("2026-11-15T06:38:19Z"));
  assert.equal(orderTime("2026-11-15T14:38:19+08:00"), orderTime("2026-11-15T06:38:19Z"));
  const time = orderTime("2026-11-15 06:38:19");
  assert.equal(orderDisplay({ status: "queued", updatedAt: "invalid", createdAt: "2026-11-15 06:38:19" }, time + 180000).tone, "warning");
  assert.equal(orderDisplay({ status: "queued", updatedAt: "invalid" }, time).tone, "working");
});

test("late receipt clears the warning and terminal states remain authoritative", () => {
  const past = "2026-11-15T06:00:00Z", now = orderTime(past) + 3600000;
  assert.equal(orderDisplay({ status: "generating", updatedAt: past }, now).tone, "warning");
  assert.equal(orderDisplay({ status: "generating", updatedAt: new Date(now).toISOString() }, now).tone, "working");
  assert.equal(orderDisplay({ status: "delivered", updatedAt: past }, now).tone, "ready");
  assert.equal(orderDisplay({ status: "failed", updatedAt: past }, now).tone, "error");
});
