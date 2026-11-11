// herdr-folders. This file started as Herdr's "spaces" mod, v0.1.13
// (https://github.com/herdrdev/herdr-app, defaults/mods/spaces, Apache 2.0;
// see LICENSE-APACHE and NOTICE). Changed from it, per Apache 2.0 section 4(b):
//   - the rows are drawn as a tree of folders, spaces and remote machines
//     (tree.js, folders.js); the "This computer" header is gone;
//   - a New folder button on the header;
//   - a machine's fold state is kept in the folder tree, not localStorage;
//   - dragging a row moves it in the tree, not in Herdr's space order.
// Changed from herdr-folders for herdr-quota: a folder outside every machine can
// hold spaces from any machine (their rows name the machine), a folded folder
// shows its count and what's waiting in it, folders and spaces can show an emoji
// (the space's right-click menu, or the "emoji" command; a space shows its agent's
// icon until then), rows show one mark per busy agent as the Agents list does, a
// Pinned section sits on top, under it 執行與待觀看 lists every space with an agent
// working, waiting or done, with the folders it sits in (a click there goes to a finished agent
// first), both stay put while the tree under them scrolls, the list can be sorted without touching the tree,
// the narrow sidebar shows each space's letter or emoji instead of numbers, a space
// marked 主控 or 副控 (by its name or a tab's, or from its menu) gets an outlined icon
// and a colored name while the rest step back, a 主控 has its own spinner, a space's
// name is followed by its first agent's address (a click copies it), and a
// space's right click opens this mod's menu, which lists every agent's address to copy.
//
// Workspace spaces: stable colored avatars, worktrees under their checkout,
// grouped by machine when more than one is known. After a space's name, the repo
// its first terminal is in now, only where unusual: branch, ahead/behind. Agent state lives in the agents list, not here. Click to
// switch, right-click for its menu, drag to reorder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, machines, panes, run, exec, hc, theme, shared, setShared, watchFolder, window, layout, props, nextCommand } from "herdr";
import { Folders, overlayFor, openEmoji, openSortMenu, openSpaceMenu, markSpace, setSort, FADE, named } from "./folders.js";
import { nameOf, PINNED } from "./tree.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const rowHeight = ({ tree }) => (tree ? 28 : 30);
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

// When a folder with no repo last changed (ms). Here node is on the PATH, which
// quota-status needs anyway; another machine is asked with stat.
async function folderDate(cwd, on) {
  try {
    const r = on
      ? await exec("stat", ["-c", "%Y", "."], { cwd, on })
      : await exec("node", ["-p", "require('fs').statSync('.').mtimeMs"], { cwd });
    return (Number(r.stdout.trim()) || 0) * (on ? 1000 : 1);
  } catch {
    return 0;
  }
}

// What a stored color name looks like on an avatar (the same in every mod
// that draws space avatars): one strong color per hue, light and dark alike.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    // Opened as one of the folder menus or dialogs: draw only that.
    this.overlay = overlayFor(props());
    if (this.overlay) return;
    this.folders = new Folders();
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    this.stamps = {}; // where() -> when a folder with no repo last changed
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(); // machines folded in the folder tree, read each tick
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    // herdr-app do herdr-folders.emoji, or herdr-folders:emoji in keys.json: the shown space's emoji.
    // Likewise menu for its menu, and role-main, role-sub, role-none to mark it.
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        const shown = spaces().find((s) => s.active);
        if (command === "emoji" && shown) openEmoji(shown.id);
        if (command === "menu" && shown) openSpaceMenu(shown.id);
        if (command.startsWith("role-") && shown) markSpace(shown, command.slice(5));
        if (command === "sort") openSortMenu();
        if (command.startsWith("sort-")) setSort(command.slice(5));
        cx.notify();
      }
    });
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    this.folded = this.folders.foldedMachines();
    this.folders.adoptNew(sp);
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folders.unfoldMachine(name);
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        this.stamps[key] = await folderDate(cwd, on);
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const last = await exec("git", ["log", "-1", "--format=%ct"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, date: (Number(last.stdout.trim()) || 0) * 1000, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    openSpaceMenu(w.id);
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    return out.filter(r => this.shown.has(r.w.id));
  }

  // The rows as the folder tree: folders, spaces (each with its worktrees) and a
  // header per remote machine, in the tree's order.
  grouped(t, collapsed) {
    const rows = this.ordered();
    const draw = (r) => (collapsed ? this.compact(r, t) : this.row(r, t));
    // Each space with the worktree spaces nested under it.
    const groups = {};
    let last = null;
    for (const r of rows) {
      if (r.tree && last && groups[last][0].g?.repo === r.g?.repo) {
        groups[last].push(r);
        continue;
      }
      last = `space:${r.w.id}`;
      groups[last] = [r];
    }
    const tops = Object.values(groups).map(([r]) => ({ id: r.w.id, machine: r.w.machine ?? null }));
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || spaces().some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child(collapsed ? "…" : "Loading…");
    const ps = panes();
    this.folders.dates = Object.fromEntries(rows.map((r) => [r.w.id, r.g?.date || this.stamps[where(r.w, ps)] || 0]));
    const nodes = this.folders.nodes({ spaces: tops, machines: remote });
    if (!nodes.length) return { top: [], rest: loading(null) ? [loadingRow(null)] : [] };
    // A machine's header and, unless it's folded, a row to start a space when it has nothing.
    const machineBlock = (node) => {
      const m = nameOf(node.key);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = node.folded;
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.folders.toggleFold(node.key);
          cx.notify();
        })
        .child(svg("mods/workspace-chrome/server.svg").size(13).flex_none())
        .when(!collapsed, el => el.child(div().flex_1().truncate().child(m))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", { machine: m ?? "" }); }).child("+")))
          .when(folded && Boolean(this.folders.marksIn(node.key, t)), el => el.child(this.folders.marksIn(node.key, t)))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", { machine: m ?? "" }))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, el => el.child("New space there"));
      const shown = this.folders.wrap(head, node, t, collapsed);
      if (!collapsed && rebuilt) return { rows: [shown], hidesChildren: true };
      if (folded || !node.empty) return { rows: [shown], hidesChildren: false };
      return { rows: [shown, this.folders.indent(loading(m) ? loadingRow(m) : empty, node.depth + 1, collapsed)], hidesChildren: false };
    };
    const drawNodes = (list) => {
      const out = [];
      let hiddenBelow = null; // depth of a rebuilt machine whose spaces aren't shown
      for (const node of list) {
        if (hiddenBelow !== null && node.depth > hiddenBelow) continue;
        hiddenBelow = null;
        if (node.kind === "folder") out.push(this.folders.wrap(this.folders.folderRow(node, t, collapsed), node, t, collapsed));
        else if (node.kind === "space") out.push(this.folders.wrap(v_flex().children(groups[node.key].map(draw)), node, t, collapsed));
        else {
          const block = machineBlock(node);
          out.push(...block.rows);
          if (block.hidesChildren) hiddenBelow = node.depth;
        }
      }
      return out;
    };
    const head = (label, count) => h_flex().h(24).flex_none().px(8).gap(5).items_center().text_size(11.5).text_color(t.dim).child(label).child(String(count));
    // The pinned rows come first; the tree starts at the first top-level row outside them.
    const start = nodes.findIndex((n) => n.depth === 0 && n.parent !== PINNED);
    const split = start < 0 ? nodes.length : start;
    const pinCount = nodes.filter((n) => n.parent === PINNED).length;
    const pinned = drawNodes(nodes.slice(0, split));
    if (pinCount && !collapsed) pinned.unshift(head("Pinned", pinCount));
    // 執行與待觀看: what's running or done anywhere, folded away or not. The narrow sidebar has its corners instead.
    const byId = new Map(spaces().map((s) => [s.id, s]));
    const busy = collapsed ? [] : this.folders.busy().filter(({ id }) => byId.has(id));
    const running = busy.length ? [head("執行與待觀看", busy.length), ...busy.map(({ id, path }) => this.busyRow(byId.get(id), path, t))] : [];
    const top = [pinned, running].filter((rows) => rows.length)
      .flatMap((rows, i) => (i ? [div().h(1).flex_none().mx(8).my(6).bg(t.border), ...rows] : rows));
    return { top, rest: drawNodes(nodes.slice(split)) };
  }

  // A row of 執行與待觀看: the folders it sits in, small and dim, then its name. Both on
  // one line when they fit, else the name goes under. A click goes to the agent there
  // that finished last ("done": you haven't looked yet), else to the space.
  busyRow(w, path, t) {
    const go = () => {
      const done = agents().filter((a) => a.space === w.id && a.status === "done").sort((a, b) => b.seq - a.seq)[0];
      if (done) run("pane.focus", { pane: done.pane });
      else run("space.select", { id: w.id });
    };
    const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const marks = this.folders.marks([w.id], t);
    const address = this.folders.addressChip(w.id, t);
    return h_flex()
      .id(`busy-${w.id}`)
      .flex_none()
      .min_h(28)
      .px(8)
      .py(4)
      .gap(9)
      .items_center()
      .rounded(8)
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(go)
      .on_mouse_down("right", () => this.menu(w))
      .child(this.folders.spaceTile(w, fill, t))
      .child(h_flex().flex_1().min_w(0).flex_wrap().items_center().gap_x(6)
        .when(path.length > 0, (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(path.join(" › "))))
        .child(named(div().min_w(0).truncate().text_color(t.foreground), this.folders.roles[w.id], t).child(w.name)))
      .when(Boolean(address), (el) => el.child(address))
      .when(Boolean(marks), (el) => el.child(marks));
  }

  // Only what's unusual, after the name: "herdr \u00b7 spike \u21912 \u21931". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitTail(g, tree, name, t) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    const where = [repo, branch].filter(Boolean).join(" \u00b7 ");
    return h_flex()
      .flex_1()
      .min_w(0)
      .gap(5)
      .justify_end()
      .items_center()
      .text_size(11.5)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(div().flex_none().text_color(t.ansi2).child(`\u2191${g.ahead}`)))
      .when(g.behind > 0, (el) => el.child(div().flex_none().text_color(t.ansi1).child(`\u2193${g.behind}`)));
  }

  row({ w, g, tree }, t) {
    const on = w.active;
    const colors = shared("space.colors") ?? {};
    const color = colors[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const marks = this.folders.marks([w.id], t);
    const address = this.folders.addressChip(w.id, t);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .px(8)
      .h(rowHeight({ tree }))
      .flex_none()
      .justify_center()
      .rounded(8)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(9)
          .items_center()
          // Stepping back leaves the marks alone: they say what the agents are doing.
          .child(h_flex().flex_1().min_w(0).gap(9).items_center()
            .when(this.folders.faded(w), el => el.opacity(FADE))
            .when(Boolean(tree), el => el.pl(22).child(svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim)))
            .when(!tree, el => el.child(this.folders.spaceTile(w, fill, t)))
            .child(h_flex().flex_shrink(0).gap(5).items_center()
              .child(named(div().flex_shrink(0).max_w(150).truncate().text_color(t.foreground), this.folders.roles[w.id], t).child(w.name))
              .when(Boolean(address), el => el.child(address)))
            .child(g ? this.gitTail(g, tree, w.name, t) : div().flex_1())
            .when(this.folders.away(w), el => el.child(h_flex().flex_none().gap(3).items_center().text_size(10.5).text_color(t.dim)
              .child(svg("mods/workspace-chrome/server.svg").size(11)).child(w.machine))))
          .when(!tree && this.folders.hovered === `space:${w.id}`, el => el.child(this.folders.pinButton(`space:${w.id}`, t)))
          .when(Boolean(marks), el => el.child(marks)),
      );
  }

  // The narrow sidebar: a space is its letter or emoji, with the most urgent mark on a corner.
  compact({ w, tree }, t) {
    const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    const corner = this.folders.corner([w.id], t);
    return h_flex()
      .relative()
      .id(`space-${w.id}`)
      .h(30)
      .flex_none()
      .justify_center()
      .items_center()
      .rounded(8)
      .tooltip(this.folders.label(this.folders.roles[w.id], w.name))
      .when(w.active, (el) => el.bg(t.selected))
      .when(!w.active, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(div().when(this.folders.faded(w), (el) => el.opacity(FADE))
        .child(tree ? svg("mods/workspace-chrome/branch.svg").size(13).text_color(t.dim) : this.folders.spaceTile(w, fill, t, true)))
      .when(Boolean(corner), (el) => el.child(corner));
  }

  render() {
    if (this.overlay) return this.overlay.render();
    const t = theme();
    const collapsed = narrow();
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map(p => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = c => Object.values(kept).filter(v => v === c).length;
      kept[p.id] = palette.reduce((best, c) => uses(c) < uses(best) ? c : best);
      changed = true;
    }
    if (changed) setShared("space.colors", kept);
    const { top, rest } = this.grouped(t, collapsed);
    return v_flex().id("spaces").size_full().min_h(0).bg(t.chrome).text_size(13)
      // Here, not on the tree: a drag may go from the tree up into Pinned.
      .on_mouse_up("left", (_e, cx) => { this.folders.cancel(); cx.notify(); })
      // gpui-kit has no "mouse up outside" handler, so leaving the sidebar ends the drag.
      .on_hover((hovered, cx) => { if (!hovered) { this.folders.cancel(); cx.notify(); } })
      .child(h_flex().h(31).pl(collapsed ? 9 : 16).pr(collapsed ? 9 : 10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(!collapsed, el => el.child("Spaces"))
        .child(h_flex().items_center()
          .when(!collapsed, el => el.child(this.folders.sortButton(t)).child(this.folders.newFolderButton(t)))
          .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14)))))
      // Pinned and 執行與待觀看 stay put and only the tree scrolls; capped, so the tree keeps room.
      .when(top.length > 0, (el) => el.child(v_flex().id("spaces-top").flex_none().max_h("55%").px(8).overflow_y_scroll().children(top))
        .when(rest.length > 0, (el) => el.child(div().h(1).flex_none().mx(16).my(6).bg(t.border))))
      .child(v_flex().id("spaces-tree").flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always").children(rest));
  }
}
