// quota-status：herdr App 底部狀態列（從內建的 workspace-status 複製），右下角加上 AI 額度。
// 精簡版：品牌 logo、週額度百分比、5 小時進度條（百分比寫在條裡）與重置倒數；點一下開詳細小視窗（claude-hud 樣式）。
// 小視窗是同一個 mod 以 props().detail 開啟；資料放 shared，任一邊重新整理兩邊都更新。
// 額度由同一個資料夾的 quota.mjs 抓（Claude／Codex／Grok，各家 CLI 本機的登入資訊）。
// 有裝 tendr 的話（~/.tendr/install.json），也負責開機後接回 Claude，以及開關右側的 tendr 看板
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { spaces, agents, theme, run, window, exec, shared, setShared, openOverlay, closeOverlay, nextCommand, props, layout, notify, home, appHome, readTextFile } from "herdr";

const MOD = "quota-status";
const SHARED_KEY = MOD + ".quota";
// 重開機後接回 Claude：App 一啟動跑一次，core 恢復終端機可能晚一點，前 10 分鐘每分鐘再看一次
const RESUME_TRIES = 10;
const LABEL = { "5h": "Usage", week: "Weekly", month: "Monthly", period: "Period" };
const NAME = { claude: "Claude", codex: "Codex", grok: "Grok" };
// 品牌圖示用 App 內建的 icons/：彩色的用 image，單色（currentColor）的用 svg 跟著文字色
const LOGO = { claude: ["image", "icons/claude.svg"], codex: ["image", "icons/codex.svg"], grok: ["svg", "icons/grok.svg"] };
const WARN_AT = 90;
const BAR = 48;

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
  const m = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h}h${m % 60}m` : `${m}m`;
}

// 狀態列用的最短寫法：3d、5h、37m
function fmtShort(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m >= 1440) return `${Math.round(m / 1440)}d`;
  if (m >= 60) return `${Math.round(m / 60)}h`;
  return `${m}m`;
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
const toneOf = (t, pct, calm) => (pct >= WARN_AT ? t.ansi1 : pct >= 70 ? t.ansi3 : calm);
// token 過期、沒登入用 🔑（開一次那個 CLI 就好），其他錯誤用 ⚠️
const errorEmoji = (error) => (/過期|登入/.test(error ?? "") ? "🔑" : "⚠️");

export default class QuotaStatus extends View {
  init(_props, cx) {
    // overlay 帶的 props 要從 herdr 的 props() 讀，init 收到的不是
    this.detail = Boolean(props()?.detail);
    this.busy = false;
    this.quotaError = null;
    if (!this.detail) {
      // 右側 tendr 看板（panel-body 裡 id 是 tendr）：tab 列只記得 workspace.panels 裡的面板，
      // 不加進去的話一換 space 就被收起來
      const panels = shared("workspace.panels");
      if (find(layout(), "tendr") && Array.isArray(panels) && !panels.includes("tendr")) setShared("workspace.panels", [...panels, "tendr"]);
      // quota.mjs 自己有快取（Claude 5 分鐘、Grok 2 分鐘），這裡每分鐘問一次就好
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
          if (c === "tendr") this.toggleTendr();
          if (c === "refresh") this.refresh(cx, true);
          cx.notify();
        }
      });
    }
    this.refresh(cx, false);
  }

  refresh(cx, force) {
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const script = appHome() + "/mods/" + MOD + "/quota.mjs";
        const r = await exec("node", force ? [script, "json", "--force"] : [script, "json"]);
        setShared(SHARED_KEY, { at: Date.now(), data: JSON.parse(r.stdout) });
        this.quotaError = null;
      } catch (e) {
        this.quotaError = String(e?.message ?? e);
      }
      this.busy = false;
      cx.notify();
    });
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

  openDetail(at) {
    openOverlay({ mod: MOD, kind: "popup", props: { detail: true }, width: 700, height: 190, ...(at ? { at } : {}) });
  }

  // ---- 狀態列：精簡版 ----

  // 品牌 → 週額度（純百分比，沒有圖示）→ 5 小時（進度條，百分比寫在條裡，後面是重置倒數）
  chip(r, t, now) {
    const good = r.good;
    if (!good || (r.error && allReset(good, now))) {
      return h_flex().gap(4).items_center().child(logo(r.id, 13)).child(div().text_color(t.ansi3).child(errorEmoji(r.error)));
    }
    const parts = [];
    for (const w of good.windows.filter((x) => x.kind !== "5h")) {
      const left = w.resetsAt ? w.resetsAt - now : null;
      if (left != null && left <= 0) {
        parts.push(div().text_color(t.dim).child("✓"));
        continue;
      }
      const pct = Math.round(w.used);
      // 快用完時才把重置倒數放出來，平常點開小視窗看
      const soon = pct >= WARN_AT && left != null ? ` ${fmtShort(left)}` : "";
      parts.push(div().text_color(toneOf(t, pct, t.muted)).child(`${pct}%${soon}`));
    }
    for (const w of good.windows.filter((x) => x.kind === "5h")) {
      const left = w.resetsAt ? w.resetsAt - now : null;
      // 過了重置時間就是新的一輪，還沒抓到新資料前當 0%
      const live = left == null || left > 0;
      parts.push(this.miniBar(live ? Math.round(w.used) : 0, t));
      if (live && left != null) parts.push(div().text_color(t.dim).child(fmtCompact(left)));
    }
    return h_flex().gap(5).items_center().child(logo(r.id, 13)).children(parts);
  }

  miniBar(pct, t) {
    const W = 44;
    const fill = Math.max(0, Math.min(W, (pct / 100) * W));
    return div().relative().w(W).h(13).rounded(3).bg(t.border)
      .child(div().absolute().left(0).top(0).bottom(0).w(fill).rounded(3).bg(toneOf(t, pct, t.ansi4)).opacity(0.65))
      .child(h_flex().absolute().inset_0().items_center().justify_center().text_size(10).text_color(t.foreground).child(`${pct}%`));
  }

  quotaChips(t) {
    const data = shared(SHARED_KEY)?.data;
    if (!data) return div().text_color(t.dim).child(this.quotaError ? "額度 ⚠️" : "額度…");
    const now = Date.now();
    return h_flex().id("quota").gap(12).items_center()
      .on_click(() => this.openDetail("pointer"))
      .children(data.map((r) => this.chip(r, t, now)));
  }

  // ---- 詳細小視窗：claude-hud 樣式 ----

  windowView(w, t, now) {
    const kind = div().text_color(t.dim).child(LABEL[w.kind] ?? w.kind);
    const left = w.resetsAt ? w.resetsAt - now : null;
    if (left != null && left <= 0) return h_flex().gap(5).items_center().child(kind).child(div().text_color(t.dim).child("(reset)"));
    const pct = Math.round(w.used);
    const tone = toneOf(t, pct, t.ansi4);
    const fill = Math.max(0, Math.min(BAR, (w.used / 100) * BAR));
    const bar = div().w(BAR).h(6).rounded(3).bg(t.border).child(div().h_full().w(fill).rounded(3).bg(tone));
    return h_flex().gap(5).items_center().child(kind).child(bar)
      .child(div().text_color(tone).child(`${pct}%${left != null ? ` (resets in ${fmtLeft(left)})` : ""}`));
  }

  detailRow(r, t, now) {
    const head = h_flex().w(84).gap(6).items_center().child(logo(r.id, 15)).child(div().text_color(t.foreground).child(NAME[r.id] ?? r.id));
    const good = r.good;
    let body;
    if (!good || (r.error && allReset(good, now))) {
      body = div().text_color(t.ansi3).child(`${errorEmoji(r.error)} ${r.errorDetail ?? r.error ?? "沒有資料"}`);
    } else {
      const segs = [];
      good.windows.forEach((w, i) => {
        if (i) segs.push(div().text_color(t.dim).child("|"));
        segs.push(this.windowView(w, t, now));
      });
      body = h_flex().gap(6).items_center().children(segs);
    }
    const notes = [];
    if (good?.plan) notes.push(good.plan);
    if (good?.asOf && now - good.asOf > 120_000) notes.push(`資料時間 ${clock(good.asOf)}`);
    if (r.error && good && !allReset(good, now)) notes.push(r.errorDetail ?? r.error);
    return v_flex().gap(2)
      .child(h_flex().gap(8).items_center().child(head).child(body))
      .when(notes.length > 0, (el) => el.child(div().pl(90).text_color(t.dim).text_size(11).child(notes.join(" · "))));
  }

  detailView(t) {
    const q = shared(SHARED_KEY);
    const now = Date.now();
    const header = h_flex().items_center().gap(8)
      .child(div().text_color(t.foreground).font_semibold().child("AI 額度"))
      .child(div().text_color(t.dim).child(q?.at ? `${clock(q.at)} 更新` : "載入中…"))
      .child(div().flex_1())
      .child(div().id("quota-refresh").px(8).py(2).rounded(4).bg(t.raised).hover((s) => s.bg(t.hover)).text_color(t.muted)
        .on_click((_e, cx) => this.refresh(cx, true)).child(this.busy ? "更新中…" : "↻ 重新整理"))
      .child(div().id("quota-close").px(6).text_color(t.dim).hover((s) => s.text_color(t.foreground))
        .on_click(() => closeOverlay(props()?.overlay)).child("✕"));
    return v_flex().size_full().p(14).gap(10).bg(t.popover).text_size(12.5).text_color(t.muted)
      .child(header)
      .children((q?.data ?? []).map((r) => this.detailRow(r, t, now)));
  }

  render() {
    const t = theme();
    if (this.detail) return this.detailView(t);
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(Boolean(find(layout(), "tendr")), (el) => el.child(div().id("tendr-toggle").px(6).rounded(4)
        .text_color(this.tendrShown() ? t.foreground : t.dim).hover((s) => s.text_color(t.foreground))
        .on_click(() => this.toggleTendr()).child("📋 tendr")))
      .child(this.quotaChips(t))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(`${window()?.platform === "macos" ? "⌘" : "Ctrl"} Shift P  commands`));
  }
}
