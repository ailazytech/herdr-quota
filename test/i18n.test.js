import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { messages, t, encodeQuotaText, quotaText } from "../mods/quota-status/i18n.js";

test("翻譯鍵與參數一致", () => {
  assert.deepEqual(Object.keys(messages["zh-TW"]).sort(), Object.keys(messages.en).sort());
  for (const key of Object.keys(messages.en)) {
    const vars = (text) => [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(vars(messages["zh-TW"][key]), vars(messages.en[key]), key);
  }
  assert.equal(t("agents", { count: 3 }, "zh-TW"), "3 個 agents");
  assert.equal(t("resetsIn", { time: "2h" }, "en"), " (resets in 2h)");
  assert.equal(t("title", {}, "fr"), "AI quota");
  assert.equal(t("missing", {}, "zh-TW"), "missing");
  const title = messages["zh-TW"].title;
  try {
    delete messages["zh-TW"].title;
    assert.equal(t("title", {}, "zh-TW"), "AI quota");
  } finally { messages["zh-TW"].title = title; }
});

test("額度錯誤代碼保留參數並可即時翻譯", () => {
  const error = encodeQuotaText("warnAt 要是 0～100 的數字");
  assert.deepEqual(error, { key: "qRange", vars: { key: "warnAt" } });
  assert.equal(quotaText(error, "en"), "warnAt must be a number from 0 to 100");
  assert.equal(quotaText(error, "zh-TW"), "warnAt 要是 0～100 的數字");
  assert.equal(quotaText(encodeQuotaText("agy：沒有回應"), "en"), "agy: No response");
  assert.equal(encodeQuotaText("HTTP 500"), "HTTP 500");
});

test("quota config 以代碼回傳設定錯誤，不讀登入資料", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "quota-i18n-"));
  try {
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ providers: ["unknown"], percent: "bad", warnAt: 101, layout: { agy: ["weekly.rest"] } }));
    const output = execFileSync(process.execPath, ["mods/quota-status/quota.mjs", "config"], { encoding: "utf8", env: { ...process.env, HERDR_QUOTA_CONFIG: file } });
    const errors = JSON.parse(output).configErrors;
    assert.deepEqual(errors.map((e) => e.key), ["qUnknown", "qPercent", "qRange", "qLayoutToken"]);
    assert.match(quotaText(errors[0], "en"), /Unknown providers: unknown/);
    assert.match(quotaText(errors[3], "zh-TW"), /weekly\.rest/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
