// quota-status：herdr App 底部狀態列（從內建的 workspace-status 複製），右下角加上 AI 額度。
// 每一家怎麼畫照設定（mods/quota-status/config.json 的 preset／layout，仿 claude-hud）：預設是品牌 logo、週額度百分比、
// 5 小時進度條（百分比寫在條裡）與重置倒數。點一下開詳細小視窗（claude-hud 樣式），小視窗的「⚙ 設定」在 App 裡直接改 config.json。
// 小視窗、設定視窗是同一個 mod 以 props().detail／props().settings 開啟；資料放 shared，任一邊重新整理全部更新。
// 額度由同一個資料夾的 quota.mjs 抓（Claude／Codex／Grok 讀各家 CLI 本機的登入資訊；Antigravity 跑 agy 自己的 /usage），
// 設定也由它讀、驗證，算好每一家的 layout 一起回傳（display）。
// Antigravity 的額度分組（Gemini、Opus＝Claude 與 GPT、Argon）：logo、name 放一次，其餘元素每組各一段。
// 有裝 tendr 的話（~/.tendr/install.json），也負責開機後接回 Claude，以及開關右側的 tendr 看板（火焰圖示：守著爐火的人）
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, Editor, EditorState } from "gpui-base";
import { spaces, agents, theme, run, window, exec, shared, setShared, openOverlay, closeOverlay, nextCommand, props, layout, notify, home, appHome, readTextFile, writeTextFile, settings } from "herdr";

const MOD = "quota-status";
const SHARED_KEY = MOD + ".quota";
// 重開機後接回 Claude：App 一啟動跑一次，core 恢復終端機可能晚一點，前 10 分鐘每分鐘再看一次
const RESUME_TRIES = 10;
const LABEL = { "5h": "Usage", week: "Weekly", month: "Monthly", period: "Period" };
const NAME = { claude: "Claude", codex: "Codex", grok: "Grok", agy: "Antigravity" };
// 品牌圖示用 App 內建的 icons/：彩色的用 image，單色（currentColor）的用 svg 跟著文字色
const LOGO = { claude: ["image", "icons/claude.svg"], codex: ["image", "icons/codex.svg"], grok: ["svg", "icons/grok.svg"], agy: ["image", "icons/antigravity.svg"] };
// quota.mjs 沒回顯示設定時（例如還是舊版）：跟 preset compact 一樣
const FALLBACK = { percent: "used", warnAt: 90, cautionAt: 70, providers: {} };
const FALLBACK_LAYOUT = ["logo", "group", "weekly", "weekly.reset", "5h.bar", "5h.reset"];
const PRESET_NAMES = { compact: "精簡", full: "完整", minimal: "極簡" };
const BAR = 48;

const scriptPath = () => appHome() + "/mods/" + MOD + "/quota.mjs";
const configPath = () => appHome() + "/mods/" + MOD + "/config.json";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

function fmtLeft(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// 5 小時的重置倒數：4h47m、37m（不加空白，省寬度）
function fmtCompact(ms) {
  const m = Math.max(1, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60}m` : `${m}m`;
}

// 週額度的重置倒數：2d11h、1d、10h14m
function fmtReset(ms) {
  const m = Math.max(1, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return h ? `${d}d${h}h` : `${d}d`;
  return fmtCompact(ms);
}

const pad2 = (n) => String(n).padStart(2, "0");
// 今天的只寫時間，其他天加日期（舊快取才不會看起來像剛抓的）
const clock = (ms) => {
  const d = new Date(ms);
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
};

function logo(id, size) {
  const [kind, path] = LOGO[id] ?? [];
  if (kind === "image") return image(path).size(size);
  if (kind === "svg") return svg(path).size(size);
  return div().child(NAME[id] ?? id);
}

// 舊資料的視窗全都重置過了，等於沒資料
const allReset = (good, now) => good.windows.length > 0 && good.windows.every((w) => w.resetsAt && w.resetsAt <= now);
// token 過期、沒登入用 🔑（開一次那個 CLI 就好），其他錯誤用 ⚠️
const errorEmoji = (error) => (/過期|登入/.test(error ?? "") ? "🔑" : "⚠️");
// 顏色一律看用掉多少；percent: left 時數字與條改成剩下多少
const toneOf = (t, d, used, calm) => (used >= d.warnAt ? t.ansi1 : used >= d.cautionAt ? t.ansi3 : calm);
const shownOf = (d, used) => (d.percent === "left" ? 100 - Math.round(used) : Math.round(used));

export default class QuotaStatus extends View {
  init(_props, cx) {
    // overlay 帶的 props 要從 herdr 的 props() 讀，init 收到的不是
    const p = props() ?? {};
    this.mode = p.settings ? "settings" : p.detail ? "detail" : "bar";
    this.busy = false;
    this.quotaError = null;
    if (this.mode === "settings") {
      this.editor = EditorState.new({ language: "json", value: "", font_family: settings()?.font_family, font_size: 12.5 });
      // 編輯時重畫：上面的快速按鈕跟著 JSON 亮起
      this.editor.on("change", (_e, cx) => cx.notify());
      // 打開時檔案的內容（沒有檔案是 null）：存檔時比對有沒有在外面被改過
      this.original = null;
      this.message = null; // { text, error }
      this.loadSettings(cx);
      return;
    }
    if (this.mode === "bar") {
      // 右側 tendr 看板（panel-body 裡 id 是 tendr）：tab 列只記得 workspace.panels 裡的面板，
      // 不加進去的話一換 space 就被收起來
      const panels = shared("workspace.panels");
      if (find(layout(), "tendr") && Array.isArray(panels) && !panels.includes("tendr")) setShared("workspace.panels", [...panels, "tendr"]);
      // quota.mjs 自己有快取（Claude 5 分鐘、Grok 2 分鐘、agy 3 分鐘），這裡每分鐘問一次就好；設定改了也在這時套用
      cx.timer.every(60_000, (cx) => this.refresh(cx, false));
      // tendr 的 resume.mjs 可以重複跑（送過的不會再送），存檔重載或換 layout 回來再跑一輪也沒關係
      this.resumeTries = 0;
      this.resume(cx);
      cx.timer.every(60_000, (cx) => { if (this.resumeTries < RESUME_TRIES) this.resume(cx); });
      // herdr-app do quota-status.<指令> 或 keys.json 綁 quota-status:<指令>
      cx.spawn(async (cx) => {
        for (;;) {
          const c = await nextCommand();
          if (c === "detail") this.openDetail();
          if (c === "settings") this.openSettings();
          if (c === "tendr") this.toggleTendr();
          if (c === "refresh") this.refresh(cx, true);
          cx.notify();
        }
      });
    }
    this.refresh(cx, false);
  }

  // after(cx)：抓完、寫進 shared 之後要做的事（設定視窗用來顯示套用結果）
  refresh(cx, force, after) {
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("node", force ? [scriptPath(), "json", "--force"] : [scriptPath(), "json"]);
        const out = JSON.parse(r.stdout);
        // 舊版 quota.mjs 只回陣列
        const results = Array.isArray(out) ? out : out.results ?? [];
        setShared(SHARED_KEY, { at: Date.now(), data: results, display: out.display ?? null, configErrors: out.configErrors ?? [] });
        this.quotaError = null;
      } catch (e) {
        this.quotaError = String(e?.message ?? e);
      }
      this.busy = false;
      after?.(cx);
      cx.notify();
    });
  }

  display() {
    return shared(SHARED_KEY)?.display ?? FALLBACK;
  }

  // tendr 的 app/install.mjs 把自己的位置寫在 ~/.tendr/install.json；沒裝 tendr 就什麼都不做
  resume(cx) {
    this.resumeTries += 1;
    cx.spawn(async () => {
      try {
        const info = JSON.parse((await readTextFile(home() + "/.tendr/install.json")) ?? "null");
        if (!info?.resume) return;
        const r = await exec("node", [info.resume]);
        const out = JSON.parse(r.stdout);
        if (out.resumed?.length) {
          notify({ title: `已接回 ${out.resumed.length} 個 Claude 對話`, body: out.resumed.map((x) => x.terminal).join("、"), level: "info" });
        }
      } catch {
        // hc 還沒起來之類的：下一分鐘再試
      }
    });
  }

  tendrShown() {
    const root = layout();
    const panel = find(root, "panel");
    return Boolean(panel && !panel.hidden && find(root, "panel-body")?.active === "tendr");
  }

  toggleTendr() {
    if (this.tendrShown()) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: "tendr" }); run("layout.show", { id: "panel" }); }
  }

  // 小視窗高度跟著行數：每家一行，分組的每組一行，有備註再加一行，設定有錯每則一行
  openDetail(at) {
    const q = shared(SHARED_KEY);
    const now = Date.now();
    let h = 28 + 20 + 10 + (q?.configErrors?.length ?? 0) * 16;
    for (const r of q?.data ?? []) {
      const good = r.good;
      const lines = good?.groups?.length || 1;
      const notes = Boolean(good?.plan || good?.groups?.some((g) => g.models) || (good?.asOf && now - good.asOf > 120_000) || (r.error && good));
      h += 10 + lines * 18 + (lines - 1) * 4 + (notes ? 18 : 0);
    }
    openOverlay({ mod: MOD, kind: "popup", props: { detail: true }, width: 760, height: Math.max(190, Math.min(480, Math.round(h))), ...(at ? { at } : {}) });
  }

  // 對話框（不是 popup）：在視窗別處點一下不會關掉，打到一半的設定不會不見
  openSettings() {
    openOverlay({ mod: MOD, kind: "dialog", props: { settings: true }, width: 780, height: 620 });
  }

  // ---- 狀態列 ----

  // 一個元素：一家（或 agy 的一組）的 logo、名稱、組名、週額度、5 小時；不是元素的字照字面顯示
  token(k, ctx) {
    const { id, windows, group, t, now, d, pd } = ctx;
    if (k === "logo") return logo(id, 13);
    if (k === "name") return div().text_color(t.muted).child(NAME[id] ?? id);
    if (k === "group") return group ? div().text_color(t.dim).child(group.short) : null;
    const [base, part, extra] = String(k).split(".");
    if ((base === "weekly" || base === "5h") && extra === undefined && [undefined, "bar", "reset"].includes(part)) {
      const w = base === "5h" ? windows.find((x) => x.kind === "5h") : windows.find((x) => x.kind !== "5h");
      if (!w) return null;
      const left = w.resetsAt ? w.resetsAt - now : null;
      const passed = left != null && left <= 0;
      if (base === "weekly") {
        if (passed) return part === "reset" ? null : div().text_color(t.dim).child("✓");
        if (part === "reset") return left != null && w.used >= pd.weeklyResetAt ? div().text_color(t.dim).child(fmtReset(left)) : null;
        if (part === "bar") return this.miniBar(shownOf(d, w.used), toneOf(t, d, w.used, t.ansi4), t);
        return div().text_color(toneOf(t, d, w.used, t.muted)).child(`${shownOf(d, w.used)}%`);
      }
      // 5 小時：過了重置時間就是新的一輪，還沒抓到新資料前當 0%；0% 時倒數沒意義（沒開始用就一直是滿的 5 小時）
      const used = passed ? 0 : w.used;
      if (part === "reset") return !passed && left != null && Math.round(used) > 0 ? div().text_color(t.dim).child(fmtCompact(left)) : null;
      if (part === "bar") return this.miniBar(shownOf(d, used), toneOf(t, d, used, t.ansi4), t);
      return div().text_color(toneOf(t, d, used, t.muted)).child(`${shownOf(d, used)}%`);
    }
    return div().text_color(t.dim).child(String(k).slice(0, 16));
  }

  chip(r, t, now, d) {
    const good = r.good;
    if (!good || (r.error && allReset(good, now))) {
      return h_flex().gap(4).items_center().child(logo(r.id, 13)).child(div().text_color(t.ansi3).child(errorEmoji(r.error)));
    }
    const pd = d.providers?.[r.id] ?? { layout: FALLBACK_LAYOUT, weeklyResetAt: r.id === "agy" ? 0 : 90 };
    const render = (keys, more) => keys.map((k) => this.token(k, { id: r.id, t, now, d, pd, ...more })).filter(Boolean);
    // 分組的（agy）：logo、name 放一次，其餘每組一段，組之間用 · 隔開
    if (good.groups) {
      const segs = [];
      good.groups.forEach((g, i) => {
        if (i) segs.push(div().text_color(t.dim).child("·"));
        segs.push(h_flex().gap(5).items_center().children(render(pd.layout.filter((k) => k !== "logo" && k !== "name"), { windows: g.windows, group: g })));
      });
      return h_flex().gap(6).items_center().children(render(pd.layout.filter((k) => k === "logo" || k === "name"), { windows: good.windows })).children(segs);
    }
    return h_flex().gap(5).items_center().children(render(pd.layout, { windows: good.windows }));
  }

  miniBar(pct, color, t) {
    const W = 44;
    const fill = Math.max(0, Math.min(W, (pct / 100) * W));
    return div().relative().w(W).h(13).rounded(3).bg(t.border)
      .child(div().absolute().left(0).top(0).bottom(0).w(fill).rounded(3).bg(color).opacity(0.65))
      .child(h_flex().absolute().inset_0().items_center().justify_center().text_size(10).text_color(t.foreground).child(`${pct}%`));
  }

  quotaChips(t) {
    const q = shared(SHARED_KEY);
    if (!q?.data) return div().text_color(t.dim).child(this.quotaError ? "額度 ⚠️" : "額度…");
    const now = Date.now();
    const d = this.display();
    return h_flex().id("quota").gap(12).items_center()
      .on_click(() => this.openDetail("pointer"))
      .children(q.data.map((r) => this.chip(r, t, now, d)))
      // 設定有錯：小視窗裡看得到是哪一項
      .when((q.configErrors?.length ?? 0) > 0, (el) => el.child(div().text_color(t.ansi3).child("⚙⚠️")));
  }

  // ---- 詳細小視窗：claude-hud 樣式 ----

  windowView(w, t, now, d) {
    const kind = div().text_color(t.dim).child(LABEL[w.kind] ?? w.kind);
    const left = w.resetsAt ? w.resetsAt - now : null;
    if (left != null && left <= 0) return h_flex().gap(5).items_center().child(kind).child(div().text_color(t.dim).child("(reset)"));
    const shown = shownOf(d, w.used);
    const tone = toneOf(t, d, w.used, t.ansi4);
    const fill = Math.max(0, Math.min(BAR, (shown / 100) * BAR));
    const bar = div().w(BAR).h(6).rounded(3).bg(t.border).child(div().h_full().w(fill).rounded(3).bg(tone));
    return h_flex().gap(5).items_center().child(kind).child(bar)
      .child(div().text_color(tone).child(`${shown}%${d.percent === "left" ? " left" : ""}${left != null ? ` (resets in ${fmtLeft(left)})` : ""}`));
  }

  detailRow(r, t, now, d) {
    const head = h_flex().w(84).gap(6).items_center().child(logo(r.id, 15)).child(div().text_color(t.foreground).child(NAME[r.id] ?? r.id));
    const good = r.good;
    let body;
    if (!good || (r.error && allReset(good, now))) {
      body = div().text_color(t.ansi3).child(`${errorEmoji(r.error)} ${r.errorDetail ?? r.error ?? "沒有資料"}`);
    } else {
      const line = (windows) => {
        const segs = [];
        windows.forEach((w, i) => {
          if (i) segs.push(div().text_color(t.dim).child("|"));
          segs.push(this.windowView(w, t, now, d));
        });
        return h_flex().gap(6).items_center().children(segs);
      };
      // 分組的一組一行：短名稱在前
      body = good.groups
        ? v_flex().gap(4).children(good.groups.map((g) => h_flex().gap(6).items_center()
          .child(div().w(46).text_color(t.foreground).child(g.short)).child(line(g.windows))))
        : line(good.windows);
    }
    const notes = [];
    if (good?.plan) notes.push(good.plan);
    for (const g of good?.groups ?? []) if (g.models) notes.push(`${g.short}＝${g.models}`);
    if (good?.asOf && now - good.asOf > 120_000) notes.push(`資料時間 ${clock(good.asOf)}`);
    if (r.error && good && !allReset(good, now)) notes.push(r.errorDetail ?? r.error);
    // 好幾行（分組）時名稱對齊第一行
    const top = good?.groups ? h_flex().gap(8).items_start() : h_flex().gap(8).items_center();
    return v_flex().gap(2)
      .child(top.child(head).child(body))
      .when(notes.length > 0, (el) => el.child(div().pl(90).text_color(t.dim).text_size(11).child(notes.join(" · "))));
  }

  detailView(t) {
    const q = shared(SHARED_KEY);
    const now = Date.now();
    const d = this.display();
    const button = (id, label, onClick) => div().id(id).px(8).py(2).rounded(4).bg(t.raised).hover((s) => s.bg(t.hover)).text_color(t.muted)
      .on_click((_e, cx) => onClick(cx)).child(label);
    const header = h_flex().items_center().gap(8)
      .child(div().text_color(t.foreground).font_semibold().child("AI 額度"))
      .child(div().text_color(t.dim).child(q?.at ? `${clock(q.at)} 更新` : "載入中…"))
      .child(div().flex_1())
      .child(button("quota-settings", "⚙ 設定", () => { this.openSettings(); closeOverlay(props()?.overlay); }))
      .child(button("quota-refresh", this.busy ? "更新中…" : "↻ 重新整理", (cx) => this.refresh(cx, true)))
      .child(div().id("quota-close").px(6).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click(() => closeOverlay(props()?.overlay)).child("✕"));
    return v_flex().size_full().p(14).gap(10).bg(t.popover).text_size(12.5).text_color(t.muted)
      .child(header)
      .children((q?.configErrors ?? []).map((e) => div().text_size(11).text_color(t.ansi3).child("設定：" + e)))
      .children((q?.data ?? []).map((r) => this.detailRow(r, t, now, d)));
  }

  // ---- 設定視窗：直接改 config.json ----

  loadSettings(cx) {
    cx.spawn(async (cx) => {
      try {
        let text = null;
        try { text = await readTextFile(configPath()); } catch { text = null; }
        this.original = text ?? null;
        if (text == null) {
          // 還沒有 config.json：用目前生效的設定（預設值）當起點，存檔時才建立
          const r = await exec("node", [scriptPath(), "config"]);
          text = JSON.stringify(JSON.parse(r.stdout).config, null, 2) + "\n";
        }
        this.editor.set_value(text);
      } catch (e) {
        this.message = { text: "讀不到設定：" + String(e?.message ?? e), error: true };
      }
      cx.notify();
    });
  }

  // 快速按鈕：改 JSON 裡的一項（JSON 壞掉時先請人修好）
  tweak(fn, cx) {
    let obj;
    try {
      obj = JSON.parse(this.editor.value());
    } catch (e) {
      this.message = { text: "JSON 有錯，先修好才能用按鈕：" + e.message, error: true };
      cx.notify();
      return;
    }
    fn(obj);
    this.editor.set_value(JSON.stringify(obj, null, 2) + "\n");
    this.message = null;
    cx.notify();
  }

  save(cx) {
    const text = this.editor.value();
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("要是一個 { … } 物件");
    } catch (e) {
      this.message = { text: "JSON 有錯，還沒存：" + e.message, error: true };
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(configPath(), text, this.original);
        this.original = text;
      } catch (e) {
        this.message = { text: "存不進去：" + String(e?.message ?? e) + "（檔案在外面被改過的話，關掉再開一次）", error: true };
        cx.notify();
        return;
      }
      this.message = { text: "已存檔，套用中…", error: false };
      cx.notify();
      this.refresh(cx, false, () => {
        const errs = shared(SHARED_KEY)?.configErrors ?? [];
        this.message = errs.length ? { text: "已存檔，但這些沒套用：" + errs.join("；"), error: true } : { text: "已存檔並套用", error: false };
      });
    });
  }

  settingsView(t) {
    const q = shared(SHARED_KEY);
    let cur = {};
    try { cur = JSON.parse(this.editor.value()) ?? {}; } catch { cur = {}; }
    const button = (id, label, onClick, active) => div().id(id).px(8).py(2).rounded(4)
      .bg(active ? t.solid : t.raised).text_color(active ? t.solid_foreground : t.muted).hover((s) => s.bg(active ? t.solid : t.hover))
      .text_size(11.5).on_click((_e, cx) => onClick(cx)).child(label);
    const presets = Object.keys(q?.display?.presets ?? PRESET_NAMES);
    const customLayout = Boolean(cur.layout && typeof cur.layout === "object" && cur.layout.default);
    const header = h_flex().items_center().gap(8)
      .child(div().text_color(t.foreground).font_semibold().child("額度設定"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(configPath()))
      .child(div().id("settings-close").px(6).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click(() => closeOverlay(props()?.overlay)).child("✕"));
    const quick = h_flex().gap(6).items_center()
      .child(div().text_size(11.5).text_color(t.dim).child("樣式"))
      .children(presets.map((p) => button("preset-" + p, `${PRESET_NAMES[p] ?? p} ${p}`,
        (cx) => this.tweak((o) => { o.preset = p; if (o.layout && typeof o.layout === "object") delete o.layout.default; }, cx),
        (cur.preset ?? "compact") === p && !customLayout)))
      .child(div().w(12))
      .child(div().text_size(11.5).text_color(t.dim).child("百分比"))
      .child(button("pct-used", "用掉 used", (cx) => this.tweak((o) => { o.percent = "used"; }, cx), (cur.percent ?? "used") === "used"))
      .child(button("pct-left", "剩下 left", (cx) => this.tweak((o) => { o.percent = "left"; }, cx), cur.percent === "left"));
    const legend = v_flex().gap(2).text_size(11).text_color(t.dim)
      .child("layout 照順序放元素，寫 default 或單獨一家（claude、codex、grok、agy），寫了就蓋過 preset：")
      .child("logo 圖示 · name 名稱 · group 分組名（agy） · weekly 週額度% · weekly.bar 週額度條 · weekly.reset 週重置倒數（用到 weeklyResetAt% 才出現）")
      .child("5h 五小時% · 5h.bar 五小時條 · 5h.reset 五小時倒數（0% 不出現） · 其他字照字面顯示，例如 \"|\"")
      .child("例：\"layout\": { \"agy\": [\"logo\", \"group\", \"weekly\", \"weekly.reset\", \"5h.bar\"] }　providers 決定順序與要不要顯示");
    const errs = q?.configErrors ?? [];
    const msg = this.message ?? (errs.length ? { text: "目前的設定有問題：" + errs.join("；"), error: true } : null);
    const footer = h_flex().gap(8).items_center()
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(msg?.error ? t.ansi1 : t.ansi2).child(msg?.text ?? ""))
      .child(button("settings-cancel", "關閉", () => closeOverlay(props()?.overlay), false))
      .child(button("settings-save", "儲存並套用", (cx) => this.save(cx), true));
    return v_flex().size_full().p(14).gap(10).bg(t.popover).text_size(12.5).text_color(t.muted)
      .child(header)
      .child(quick)
      .child(legend)
      .child(div().flex_1().min_h(0).rounded(6).border_1().border_color(t.border).bg(t.background).overflow_hidden()
        .child(Editor.new(this.editor).size_full()))
      .child(footer);
  }

  // 設定或資料不如預期時，寧可把錯誤寫在狀態列上，也不要整條狀態列停在上一張畫面
  render() {
    try {
      return this.renderInner();
    } catch (e) {
      return div().px(14).size_full().flex().items_center().text_color(theme().ansi1).child("quota-status 畫面錯誤：" + String(e?.message ?? e).slice(0, 200));
    }
  }

  renderInner() {
    const t = theme();
    if (this.mode === "settings") return this.settingsView(t);
    if (this.mode === "detail") return this.detailView(t);
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const tendrOn = this.tendrShown();
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      // tendr：守著爐火的人。看板開著時火是亮的
      .when(Boolean(find(layout(), "tendr")), (el) => el.child(h_flex().id("tendr-toggle").gap(5).items_center().px(6).rounded(4)
        .text_color(tendrOn ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground))
        .on_click(() => this.toggleTendr())
        .child(svg("mods/" + MOD + "/flame.svg").size(13).text_color(tendrOn ? t.ansi3 : t.dim))
        .child("tendr")))
      .child(this.quotaChips(t))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(`${window()?.platform === "macos" ? "⌘" : "Ctrl"} Shift P  commands`));
  }
}
