export const messages = {
  "zh-TW": {
    computer: "這台電腦", agents: "{count} 個 agents", needs: "· {count} 個需要你", commands: "指令",
    quotaError: "額度 ⚠️", quotaLoading: "額度…", usage: "用量", weekly: "每週", monthly: "每月", period: "週期", reset: "（已重置）", left: " 剩餘", resetsIn: "（{time}後重置）",
    noData: "沒有資料", dataTime: "資料時間 {time}", title: "AI 額度", updated: "{time} 更新", loading: "載入中…", settings: "⚙ 設定", refreshing: "更新中…", refresh: "↻ 重新整理", configPrefix: "設定：{error}",
    settingsTitle: "額度設定", style: "樣式", percent: "百分比", used: "用掉 used", remaining: "剩下 left", language: "語言 Language", auto: "跟系統", chinese: "中文", english: "English", close: "關閉", save: "儲存並套用",
    legend1: "layout 照順序放元素，寫 default 或單獨一家（claude、codex、grok、agy），寫了就蓋過 preset：",
    legend2: "logo 圖示 · name 名稱 · group 分組名（agy） · weekly 週額度% · weekly.bar 週額度條 · weekly.reset 週重置倒數（用到 weeklyResetAt% 才出現）",
    legend3: "5h 五小時% · 5h.bar 五小時條 · 5h.reset 五小時倒數（0% 不出現） · 其他字照字面顯示，例如 \"|\"",
    legend4: "例：\"layout\": { \"agy\": [\"logo\", \"group\", \"weekly\", \"weekly.reset\", \"5h.bar\"] }　providers 決定順序與要不要顯示",
    readError: "讀不到設定：{error}", tweakError: "JSON 有錯，先修好才能用按鈕：{error}", objectRequired: "要是一個 { … } 物件", jsonError: "JSON 有錯，還沒存：{error}", writeError: "存不進去：{error}（檔案在外面被改過的話，關掉再開一次）", applying: "已存檔，套用中…", applyError: "已存檔，但這些沒套用：{error}", applied: "已存檔並套用", currentErrors: "目前的設定有問題：{error}", renderError: "quota-status 畫面錯誤：{error}", resumed: "已接回 {count} 個 Claude 對話",
    qInvalidJson: "config.json 不是正確的 JSON：{detail}", qObject: "config.json 要是一個 { … } 物件", qProviders: "providers 要是字串陣列，例如 [\"claude\", \"agy\"]", qUnknown: "providers 有不認得的：{unknown}（可用 {available}）", qPreset: "preset 只能是 {available}", qPercent: "percent 只能是 used（用掉）或 left（剩下）", qRange: "{key} 要是 0～100 的數字", qLayoutArray: "layout.{key} 要是字串陣列，例如 [\"logo\", \"weekly\", \"5h.bar\"]", qLayoutProvider: "layout.{key}：沒有這一家（可用 default、{available}）", qLayoutToken: "layout.{key} 的 {unknown} 不是元素，會照字面顯示（元素：{available}）",
    qConnection: "連線失敗", qConnectionDetail: "連線失敗：{detail}", qLoginAgain: "需重新登入", qInvalidLogin: "HTTP {status}，登入資訊無效", qLimited: "被限流", qLimitedDetail: "HTTP 429，被限流，稍後自動重試", qNotJson: "回應不是 JSON", qNotLoggedIn: "未登入", qExpired: "token 過期", qExpiredDetail: "token 過期，開一次 {name} 就會更新", qNoData: "沒有資料", qCodexData: "最近的 Codex session 裡找不到 rate_limits", qFormat: "格式不認得", qBilling: "billing API 回應裡沒有用量百分比", qMissing: "未安裝", qMissingAgy: "找不到 agy（Antigravity CLI）", qTimeout: "逾時", qExecution: "執行失敗", qAgyJson: "agy /usage 的輸出不是 JSON", qError: "錯誤", qNoResponse: "沒有回應", qAgyNone: "agy /usage 沒有回傳額度"
  },
  en: {
    computer: "This computer", agents: "{count} agents", needs: "· {count} need you", commands: "commands",
    quotaError: "Quota ⚠️", quotaLoading: "Quota…", usage: "Usage", weekly: "Weekly", monthly: "Monthly", period: "Period", reset: "(reset)", left: " left", resetsIn: " (resets in {time})",
    noData: "No data", dataTime: "Data as of {time}", title: "AI quota", updated: "Updated {time}", loading: "Loading…", settings: "⚙ Settings", refreshing: "Refreshing…", refresh: "↻ Refresh", configPrefix: "Settings: {error}",
    settingsTitle: "Quota settings", style: "Style", percent: "Percentage", used: "Used", remaining: "Left", language: "語言 Language", auto: "System", chinese: "中文", english: "English", close: "Close", save: "Save and apply",
    legend1: "layout orders elements; default or a provider (claude, codex, grok, agy) overrides preset:",
    legend2: "logo icon · name provider · group name (agy) · weekly % · weekly.bar bar · weekly.reset countdown (from weeklyResetAt%)",
    legend3: "5h % · 5h.bar bar · 5h.reset countdown (hidden at 0%) · other text appears literally, e.g. \"|\"",
    legend4: "Example: \"layout\": { \"agy\": [\"logo\", \"group\", \"weekly\", \"weekly.reset\", \"5h.bar\"] }  providers controls order and visibility",
    readError: "Could not read settings: {error}", tweakError: "Fix the JSON before using buttons: {error}", objectRequired: "Must be a { … } object", jsonError: "Invalid JSON; not saved: {error}", writeError: "Could not save: {error} (if the file changed outside the app, close and reopen)", applying: "Saved; applying…", applyError: "Saved, but these settings were not applied: {error}", applied: "Saved and applied", currentErrors: "Current settings have errors: {error}", renderError: "quota-status display error: {error}", resumed: "Reconnected {count} Claude conversations",
    qInvalidJson: "config.json is not valid JSON: {detail}", qObject: "config.json must be a { … } object", qProviders: "providers must be an array of strings, e.g. [\"claude\", \"agy\"]", qUnknown: "Unknown providers: {unknown} (available: {available})", qPreset: "preset must be one of {available}", qPercent: "percent must be used or left", qRange: "{key} must be a number from 0 to 100", qLayoutArray: "layout.{key} must be an array of strings, e.g. [\"logo\", \"weekly\", \"5h.bar\"]", qLayoutProvider: "layout.{key}: unknown provider (available: default, {available})", qLayoutToken: "layout.{key}: {unknown} is not an element and will appear literally (elements: {available})",
    qConnection: "Connection failed", qConnectionDetail: "Connection failed: {detail}", qLoginAgain: "Sign in again", qInvalidLogin: "HTTP {status}: invalid login", qLimited: "Rate limited", qLimitedDetail: "HTTP 429: rate limited; will retry automatically", qNotJson: "Response is not JSON", qNotLoggedIn: "Not signed in", qExpired: "Token expired", qExpiredDetail: "Token expired; open {name} to renew it", qNoData: "No data", qCodexData: "No rate_limits found in recent Codex sessions", qFormat: "Unrecognized format", qBilling: "No usage percentage in billing API response", qMissing: "Not installed", qMissingAgy: "agy (Antigravity CLI) not found", qTimeout: "Timed out", qExecution: "Execution failed", qAgyJson: "agy /usage output is not JSON", qError: "Error", qNoResponse: "No response", qAgyNone: "agy /usage returned no quota"
  }
};

export function t(key, vars = {}, language = "en") {
  const template = messages[language]?.[key] ?? messages.en[key] ?? key;
  return template.replace(/\{([^{}]+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
}

// 舊版快取也可能含中文錯誤；輸出 JSON 前轉成與語言無關的代碼。
const exactErrors = {
  "config.json 要是一個 { … } 物件": "qObject", 'providers 要是字串陣列，例如 ["claude", "agy"]': "qProviders",
  "percent 只能是 used（用掉）或 left（剩下）": "qPercent", "連線失敗": "qConnection", "需重新登入": "qLoginAgain", "被限流": "qLimited", "HTTP 429，被限流，稍後自動重試": "qLimitedDetail", "回應不是 JSON": "qNotJson", "未登入": "qNotLoggedIn", "token 過期": "qExpired", "沒有資料": "qNoData", "最近的 Codex session 裡找不到 rate_limits": "qCodexData", "格式不認得": "qFormat", "billing API 回應裡沒有用量百分比": "qBilling", "未安裝": "qMissing", "找不到 agy（Antigravity CLI）": "qMissingAgy", "逾時": "qTimeout", "執行失敗": "qExecution", "agy /usage 的輸出不是 JSON": "qAgyJson", "錯誤": "qError", "沒有回應": "qNoResponse", "agy /usage 沒有回傳額度": "qAgyNone"
};
const patterns = [
  [/^config\.json 不是正確的 JSON：([\s\S]*)$/, "qInvalidJson", ["detail"]],
  [/^providers 有不認得的：([\s\S]*)（可用 ([\s\S]*)）$/, "qUnknown", ["unknown", "available"]],
  [/^preset 只能是 ([\s\S]*)$/, "qPreset", ["available"]],
  [/^(warnAt|cautionAt) 要是 0～100 的數字$/, "qRange", ["key"]],
  [/^layout\.(.+) 要是字串陣列，例如 \["logo", "weekly", "5h\.bar"\]$/, "qLayoutArray", ["key"]],
  [/^layout\.(.+)：沒有這一家（可用 default、(.+)）$/, "qLayoutProvider", ["key", "available"]],
  [/^layout\.(.+) 的 (.+) 不是元素，會照字面顯示（元素：(.+)）$/, "qLayoutToken", ["key", "unknown", "available"]],
  [/^連線失敗：([\s\S]*)$/, "qConnectionDetail", ["detail"]],
  [/^HTTP (401|403)，登入資訊無效$/, "qInvalidLogin", ["status"]],
  [/^token 過期，開一次 (.+) 就會更新$/, "qExpiredDetail", ["name"]]
];

export function encodeQuotaText(value) {
  if (typeof value !== "string") return value;
  if (exactErrors[value]) return { key: exactErrors[value] };
  for (const [pattern, key, names] of patterns) {
    const match = value.match(pattern);
    if (match) return { key, vars: Object.fromEntries(names.map((name, i) => [name, match[i + 1]])) };
  }
  // 外部 CLI、系統或 API 的訊息原樣呈現。
  if (value === "agy：沒有回應") return { key: "qAgyError", vars: { detail: { key: "qNoResponse" } } };
  return value;
}

export function quotaText(value, language) {
  if (!value || typeof value !== "object" || !value.key) return value;
  const vars = Object.fromEntries(Object.entries(value.vars ?? {}).map(([name, v]) => [name, quotaText(v, language)]));
  if (value.key === "qAgyError") return `agy: ${vars.detail}`;
  return t(value.key, vars, language);
}

