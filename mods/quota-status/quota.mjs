#!/usr/bin/env node
// Claude / Codex / Grok / Antigravity（agy）的 5h、週額度與重置時間。讀各家 CLI 本機的登入資訊，只送到各自官方的用量 API；
// agy 直接跑它自己的 `agy -p /usage`（不碰 token、不耗模型額度）。
//   node quota.mjs json [--force]  原始結果（quota-status 狀態列讀這個）
//   node quota.mjs line            一行文字
//   node quota.mjs refresh         忽略快取重抓，印出一行
//   node quota.mjs detail [--wait] 詳細表格；--wait 會等按鍵
// 設定：同一個資料夾的 config.json（或 HERDR_QUOTA_CONFIG 指的檔），見 DEFAULTS
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const CACHE_FILE = path.join(process.env.LOCALAPPDATA ?? path.join(HOME, '.cache'), 'herdr-quota', 'cache.json');
const CONFIG_FILE = process.env.HERDR_QUOTA_CONFIG ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'config.json');
const GROK_HOME = process.env.GROK_HOME ?? path.join(HOME, '.grok');

const DEFAULTS = {
  // 沒裝 agy 的電腦不顯示它（見 PROVIDERS 的 optional）
  providers: ['claude', 'codex', 'grok', 'agy'],
  warnAt: 90,
  // usage API 有限流，claude-hud 也是 5 分鐘抓一次；agy 每次要起一個 CLI（約 5 秒），3 分鐘一次
  ttlSec: { claude: 300, grok: 120, agy: 180 },
  timeoutMs: 8000,
  // agy 啟動時可能要先續期登入，給它久一點
  agyTimeoutMs: 30000,
};

function loadConfig() {
  const user = readJson(CONFIG_FILE) ?? {};
  return { ...DEFAULTS, ...user, ttlSec: { ...DEFAULTS.ttlSec, ...user.ttlSec } };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value));
    fs.renameSync(tmp, file);
  } catch { /* 寫不進去就下次重抓 */ }
}

class QuotaError extends Error {
  constructor(short, { detail, retryAfterMs } = {}) {
    super(detail ?? short);
    this.short = short;
    this.retryAfterMs = retryAfterMs;
  }
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const toMs = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

async function getJson(url, headers, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': 'herdr-quota/0.1', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new QuotaError('連線失敗', { detail: `連線失敗：${e.message}` });
  }
  if (res.status === 401 || res.status === 403) {
    throw new QuotaError('需重新登入', { detail: `HTTP ${res.status}，登入資訊無效` });
  }
  if (res.status === 429) {
    const sec = Number(res.headers.get('retry-after'));
    throw new QuotaError('被限流', {
      detail: 'HTTP 429，被限流，稍後自動重試',
      retryAfterMs: (sec > 0 ? sec : 300) * 1000,
    });
  }
  if (!res.ok) throw new QuotaError(`HTTP ${res.status}`);
  try { return await res.json(); } catch { throw new QuotaError('回應不是 JSON'); }
}

// ---- Claude Code：用本機 OAuth 登入資訊查 usage API ----

async function fetchClaude(cfg) {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, '.claude');
  const oauth = readJson(path.join(dir, '.credentials.json'))?.claudeAiOauth;
  if (!oauth?.accessToken) throw new QuotaError('未登入');
  // token 由 Claude Code 自己續期；不自己 refresh，免得把它的登入搶掉
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    throw new QuotaError('token 過期', { detail: 'token 過期，開一次 Claude Code 就會更新' });
  }
  const j = await getJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${oauth.accessToken}`,
    'anthropic-beta': 'oauth-2025-04-20',
  }, cfg.timeoutMs);
  const windows = [];
  for (const [kind, w] of [['5h', j.five_hour], ['week', j.seven_day]]) {
    if (w) windows.push({ kind, used: num(w.utilization) ?? 0, resetsAt: toMs(w.resets_at) });
  }
  return { plan: oauth.subscriptionType ?? null, windows };
}

// ---- Codex：每個 turn 結束時 rollout 檔會記下 rate_limits，純本機 ----

const windowKind = (minutes) => {
  if (minutes == null) return '?';
  if (minutes <= 360) return '5h';
  if (minutes >= 10000) return 'week';
  return `${Math.round(minutes / 60)}h`;
};
const KIND_ORDER = { '5h': 0, week: 2, month: 3 };
const kindOrder = (w) => KIND_ORDER[w.kind] ?? 1;

function recentRollouts(root, limit) {
  const desc = (dir) => { try { return fs.readdirSync(dir).sort().reverse(); } catch { return []; } };
  const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const files = [];
  outer: for (const y of desc(root)) {
    for (const m of desc(path.join(root, y))) {
      for (const d of desc(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        for (const f of desc(dir)) {
          if (f.startsWith('rollout-') && f.endsWith('.jsonl')) files.push(path.join(dir, f));
        }
        if (files.length >= limit) break outer;
      }
    }
  }
  return files.map((f) => [f, mtime(f)]).sort((a, b) => b[1] - a[1]).map(([f]) => f);
}

function lastRateLimits(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    // 先讀尾端 512KB，找不到再擴大到 16MB；更大的檔就放棄
    for (const want of [512 * 1024, 16 * 1024 * 1024]) {
      const len = Math.min(want, size);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        try {
          const ev = JSON.parse(lines[i]);
          const rl = ev.payload?.rate_limits;
          if (rl) return { rl, ts: toMs(ev.timestamp) ?? Date.now() };
        } catch { /* 切到半行 */ }
      }
      if (len === size) break;
    }
  } catch { /* 讀不到就換下一個檔 */ } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  return null;
}

function readCodex() {
  const root = path.join(process.env.CODEX_HOME ?? path.join(HOME, '.codex'), 'sessions');
  for (const file of recentRollouts(root, 30)) {
    const hit = lastRateLimits(file);
    if (!hit) continue;
    const { rl, ts } = hit;
    const windows = [rl.primary, rl.secondary].filter(Boolean).map((w) => ({
      kind: windowKind(w.window_minutes),
      used: num(w.used_percent) ?? 0,
      // 舊版只有 resets_in_seconds，以事件時間為基準
      resetsAt: toMs(w.resets_at) ?? (num(w.resets_in_seconds) != null ? ts + w.resets_in_seconds * 1000 : null),
    })).sort((a, b) => kindOrder(a) - kindOrder(b));
    return { plan: rl.plan_type ?? null, windows, asOf: ts };
  }
  throw new QuotaError('沒有資料', { detail: '最近的 Codex session 裡找不到 rate_limits' });
}

// ---- Grok Build：用 ~/.grok/auth.json 的 token 查 billing API ----

const periodKind = (type) => {
  const t = String(type ?? '').toUpperCase();
  if (t.includes('WEEK')) return 'week';
  if (t.includes('MONTH')) return 'month';
  return 'period';
};

async function fetchGrok(cfg) {
  const auth = readJson(path.join(GROK_HOME, 'auth.json')) ?? {};
  const entry = Object.values(auth).find((e) => typeof (e?.key ?? e?.access_token) === 'string');
  if (!entry) throw new QuotaError('未登入');
  // 跟 Claude 一樣不自己 refresh，等 grok 下次啟動時續期
  if (entry.expires_at && Date.parse(entry.expires_at) < Date.now()) {
    throw new QuotaError('token 過期', { detail: 'token 過期，開一次 grok 就會更新' });
  }
  let version = '';
  try { version = fs.readFileSync(path.join(GROK_HOME, '.metadata_version'), 'utf8').trim(); } catch { /* 沒有就不帶 */ }
  const j = await getJson('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
    Authorization: `Bearer ${entry.key ?? entry.access_token}`,
    Accept: 'application/json',
    ...(version && { 'x-grok-client-version': version }),
  }, cfg.timeoutMs);
  const c = j?.config ?? j;
  const usage = Array.isArray(c?.productUsage) ? c.productUsage[0] : null;
  // 回應是 protobuf 轉的 JSON，值是 0 的欄位整個省略：有計費週期卻沒有百分比＝這期還沒用
  const used = num(c?.creditUsagePercent) ?? num(usage?.usagePercent) ?? (c?.currentPeriod ? 0 : null);
  if (used == null) throw new QuotaError('格式不認得', { detail: 'billing API 回應裡沒有用量百分比' });
  const period = c.currentPeriod ?? {};
  return {
    plan: usage?.product ?? null,
    windows: [{ kind: periodKind(period.type), used, resetsAt: toMs(period.end ?? c.billingPeriodEnd) }],
  };
}

// grok-hud 在 grok 裡跑時會留快取，比我們新就拿來用
function grokHudCache() {
  const c = readJson(path.join(GROK_HOME, 'plugins', 'grok-hud', 'billing-cache.json'));
  const d = c?.data;
  if (num(d?.percent) == null) return null;
  const kind = { weekly: 'week', monthly: 'month' }[d.periodType] ?? 'period';
  return {
    plan: d.product ?? null,
    windows: [{ kind, used: d.percent, resetsAt: toMs(d.periodEnd) }],
    asOf: toMs(c.fetchedAt) ?? 0,
  };
}

// ---- Antigravity CLI（agy）：跑它自己的 /usage，拿各組模型的額度 ----
// 回應的 command.data.groups 是一組一組共用額度的模型（Gemini、Claude 與 GPT、Gemini 4 Argon…），
// 每組有 weekly、5h 的 bucket，給的是剩下的比例（remaining_fraction）；這裡跟其他家一樣換成用掉的百分比

// 狀態列放不下完整組名：用短名稱（使用者講的 Gemini／Opus／Argon），認不得的取第一個字
const AGY_SHORT = [[/argon/i, 'Argon'], [/claude|gpt|opus/i, 'Opus'], [/gemini/i, 'Gemini']];
const AGY_KIND = { '5h': '5h', weekly: 'week', monthly: 'month' };

function runAgy(timeoutMs) {
  return new Promise((resolve, reject) => {
    // 不經過 shell：/usage 不會被 Git Bash 之類的轉成路徑；在暫存資料夾跑，免得在專案裡留下狀態
    execFile('agy', ['-p', '/usage', '--output-format', 'json'], {
      cwd: os.tmpdir(), timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20,
    }, (err, stdout, stderr) => {
      if (err?.code === 'ENOENT') return reject(new QuotaError('未安裝', { detail: '找不到 agy（Antigravity CLI）' }));
      if (err && !String(stdout).trim()) {
        return reject(new QuotaError(err.killed ? '逾時' : '執行失敗', { detail: `agy：${String(stderr || err.message).trim().slice(0, 200)}` }));
      }
      resolve(String(stdout));
    });
  });
}

async function fetchAgy(cfg) {
  const out = await runAgy(cfg.agyTimeoutMs);
  let j;
  try { j = JSON.parse(out.slice(out.indexOf('{'))); } catch { throw new QuotaError('格式不認得', { detail: 'agy /usage 的輸出不是 JSON' }); }
  if (j.status !== 'SUCCESS') {
    const msg = String(j.response ?? j.error ?? j.status ?? '').trim();
    throw new QuotaError(/sign.?in|log.?in|auth|登入/i.test(msg) ? '未登入' : '錯誤', { detail: `agy：${msg.slice(0, 200) || '沒有回應'}` });
  }
  const groups = (j.command?.data?.groups ?? []).map((g) => {
    const name = String(g.name ?? '');
    const desc = String(g.description ?? '');
    return {
      name,
      short: AGY_SHORT.find(([re]) => re.test(name))?.[1] ?? (name.split(/\s+/)[0] || '?'),
      models: /^Models within this group:/i.test(desc) ? desc.replace(/^Models within this group:\s*/i, '') : '',
      windows: (Array.isArray(g.buckets) ? g.buckets : []).map((b) => ({
        kind: AGY_KIND[b.window] ?? String(b.window ?? '?'),
        used: num(b.remaining_fraction) != null ? Math.round((1 - b.remaining_fraction) * 1000) / 10 : 0,
        resetsAt: toMs(b.reset_time),
      })).sort((a, b) => kindOrder(a) - kindOrder(b)),
    };
  }).filter((g) => g.windows.length);
  if (!groups.length) throw new QuotaError('沒有資料', { detail: 'agy /usage 沒有回傳額度' });
  // windows 攤平一份：「全部都重置過了」這類判斷照舊用
  return { plan: null, groups, windows: groups.flatMap((g) => g.windows) };
}

// ---- 收集 ----

// optional：這台沒裝那個 CLI 就整個不列（不顯示 ⚠️）
const PROVIDERS = {
  claude: { label: 'Claude', fetch: fetchClaude, network: true },
  codex: { label: 'Codex', fetch: readCodex },
  grok: { label: 'Grok', fetch: fetchGrok, network: true, fallback: grokHudCache },
  agy: { label: 'Antigravity', fetch: fetchAgy, network: true, optional: true },
};

async function collect(cfg, force) {
  const cache = readJson(CACHE_FILE) ?? {};
  const now = Date.now();
  const results = await Promise.all(cfg.providers.filter((id) => PROVIDERS[id]).map(async (id) => {
    const p = PROVIDERS[id];
    if (!p.network) {
      try { return { id, good: { asOf: now, ...p.fetch(cfg) } }; } catch (e) {
        return { id, error: e.short ?? '錯誤', errorDetail: e.message };
      }
    }
    const c = cache[id] ?? {};
    const due = c.retryAt ? now >= c.retryAt : !c.checkedAt || now - c.checkedAt >= (cfg.ttlSec[id] ?? 120) * 1000;
    const throttled = c.error === '被限流' && c.retryAt > now;
    if (due || (force && !throttled)) {
      try {
        cache[id] = { checkedAt: now, good: { ...(await p.fetch(cfg)), asOf: now } };
      } catch (e) {
        cache[id] = {
          ...c,
          checkedAt: now,
          error: e.short ?? '錯誤',
          errorDetail: e.message,
          retryAt: now + (e.retryAfterMs ?? 60_000),
        };
      }
    }
    const s = cache[id];
    let good = s.good;
    const alt = p.fallback?.();
    if (alt && (!good || alt.asOf > good.asOf)) good = alt;
    return { id, good, error: s.error, errorDetail: s.errorDetail };
  }));
  writeJsonAtomic(CACHE_FILE, cache);
  return results.filter((r) => !(PROVIDERS[r.id].optional && r.error === '未安裝' && !r.good));
}

// ---- 顯示（仿 claude-hud）----

const LABEL = { '5h': 'Usage', week: 'Weekly', month: 'Monthly', period: 'Period' };
const BAR_WIDTH = 10;
const pad2 = (n) => String(n).padStart(2, '0');
const fmtTime = (ms) => {
  // API 的重置時間會差幾百毫秒（09:59:59.8），四捨五入到分鐘
  const d = new Date(Math.round(ms / 60000) * 60000);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function fmtLeft(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

const painter = (on) => (code, s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
// 舊資料的視窗全都重置過了，等於沒資料
const allReset = (good, now) => good.windows.length > 0 && good.windows.every((w) => w.resetsAt && w.resetsAt <= now);

// [Claude] Usage ██░░░░░░░░ 18% (resets in 59m) | Weekly ███████░░░ 68% (resets in 2d 10h)
function renderProvider({ id, good, error, errorDetail }, cfg, paint, now, { nameWidth = 0, long = false } = {}) {
  const label = PROVIDERS[id].label;
  const tag = (s) => paint('36', `[${s}]`) + ' '.repeat(Math.max(0, nameWidth - s.length - 2));
  if (!good || (error && allReset(good, now))) {
    return `${tag(label)} ${paint('33', (long ? errorDetail : null) ?? error ?? '沒有資料')}`;
  }
  const name = tag(error ? `${label}*` : label);
  if (!good.windows.length) return `${name} —`;
  const seg = (w) => {
    const kind = paint('2', LABEL[w.kind] ?? w.kind);
    const left = w.resetsAt ? w.resetsAt - now : null;
    if (left != null && left <= 0) return `${kind} ${paint('2', '(reset)')}`;
    const pct = Math.round(w.used);
    const tone = pct >= cfg.warnAt ? '31' : pct >= 70 ? '33' : '34';
    const filled = Math.round(Math.min(100, Math.max(0, w.used)) / 100 * BAR_WIDTH);
    const bar = paint(tone, '█'.repeat(filled)) + paint('2', '░'.repeat(BAR_WIDTH - filled));
    const reset = left != null ? ` (resets in ${fmtLeft(left)})` : '';
    return `${kind} ${bar} ${paint(tone, `${pct}%${reset}`)}`;
  };
  const join = (windows) => windows.map(seg).join(paint('2', ' | '));
  // agy 這種分組的：一行內用 · 隔開；詳細表格一組一行，對齊在名稱後面
  if (good.groups) {
    const parts = good.groups.map((g) => `${paint('36', g.short)} ${join(g.windows)}`);
    return `${name} ${parts.join(long ? '\n' + ' '.repeat(nameWidth + 1) : paint('2', ' · '))}`;
  }
  return `${name} ${join(good.windows)}`;
}

function renderLine(results, cfg, color, now = Date.now()) {
  const paint = painter(color);
  return results.map((r) => renderProvider(r, cfg, paint, now)).join(paint('2', ' │ '));
}

function renderDetail(results, cfg, color, now = Date.now()) {
  const paint = painter(color);
  const nameWidth = Math.max(...results.map((r) => PROVIDERS[r.id].label.length + 3));
  const out = [`${paint('1', 'AI 額度')}  ${paint('2', `${fmtTime(now)} 更新`)}`, ''];
  for (const r of results) {
    out.push(renderProvider(r, cfg, paint, now, { nameWidth, long: true }));
    const notes = [];
    if (r.good?.plan) notes.push(r.good.plan);
    // 分組的短名稱各含哪些模型
    for (const g of r.good?.groups ?? []) if (g.models) notes.push(`${g.short}＝${g.models}`);
    if (r.good?.asOf && now - r.good.asOf > 120_000) notes.push(`資料時間 ${fmtTime(r.good.asOf)}`);
    // 錯誤只顯示了一半（還有舊資料可看）時，補在下一行
    if (r.error && r.good && !allReset(r.good, now)) notes.push(r.errorDetail ?? r.error);
    if (notes.length) out.push(' '.repeat(nameWidth + 1) + paint('2', notes.join(' · ')));
  }
  return out.join('\n');
}

async function detail(cfg, wait, color) {
  const draw = (results) => {
    if (wait) process.stdout.write('\x1b[2J\x1b[H');
    process.stdout.write(renderDetail(results, cfg, color) + '\n');
    if (wait) process.stdout.write(`\n${painter(color)('2', 'r 重新整理 · 其他鍵關閉')}`);
  };
  draw(await collect(cfg, false));
  if (!wait || !process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  for await (const chunk of process.stdin) {
    if (String(chunk).toLowerCase() !== 'r') break;
    draw(await collect(cfg, true));
  }
  process.stdin.setRawMode(false);
  process.exit(0);
}

const [cmd = 'line', ...args] = process.argv.slice(2);
const cfg = loadConfig();
// 終端機預設上色；狀態列這類會剝掉 ANSI 的地方用純文字，--color / --no-color 可強制
const color = args.includes('--color') || (!args.includes('--no-color') && Boolean(process.stdout.isTTY));
try {
  switch (cmd) {
    case 'line': console.log(renderLine(await collect(cfg, false), cfg, color)); break;
    case 'refresh': console.log(renderLine(await collect(cfg, true), cfg, color)); break;
    case 'json': console.log(JSON.stringify(await collect(cfg, args.includes('--force')), null, 2)); break;
    case 'detail': await detail(cfg, args.includes('--wait'), color); break;
    default:
      console.error('usage: node quota.mjs [line|refresh|detail [--wait]|json] [--color|--no-color]');
      process.exit(2);
  }
} catch (e) {
  // 狀態列遇到非 0 會整格清掉，寧可顯示錯誤
  console.log(`額度 錯誤：${e.message}`);
}
