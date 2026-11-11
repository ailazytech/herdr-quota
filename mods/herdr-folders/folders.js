// Everything folder-shaped that touches Herdr: the saved tree, the folder rows,
// dragging, and the popups and dialog the sidebar opens as overlays of itself.
// The rules for where things may go live in tree.js.

import { div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, spaces, agents, terminals, openOverlay, closeOverlay, theme, shared, setShared } from "herdr";
import {
  ROOT, DEFAULT_ICON, emptyTree, kindOf, nameOf, machineAt, isFolded, canMove, move, slotNear,
  insertFolder, deleteFolder, updateFolder, setFolded, settle, rowsOf, isHex, spacesUnder,
  cleanEmoji, emojiOf, setEmoji, PINNED, isPinned, pin, unpin, ranked, agentRole, agentScore, spaceRole, setRole, setRoleColor, pathOf,
  addressesBySpace,
} from "./tree.js";

const MOD = "herdr-folders";
const STORE_KEY = "herdr-folders";
const PENDING_KEY = "herdr-folders.pending";
const SORT_KEY = "herdr-folders.sort";
const NEW_FOLDER_NAME = "新資料夾";
const PENDING_SPACE_MS = 60000;
const FOLDER_ROW = 28;
const INDENT = 14;
const EDGE = 7; // px at a folder row's top or bottom that drop beside it, not into it
const SPACE_ROW_HALF = 15;
const SWATCHES_PER_ROW = 8;
const MENU_ADDRESSES = 8; // a space's menu lists at most this many agents' addresses

// Theme names show these muted values on a folder's tile.
const THEME_COLORS = { ansi6: "#399a8f", ansi3: "#c67e57", ansi4: "#5d84cc", ansi5: "#8377cf", ansi2: "#4e9c6b", ansi1: "#bd6790" };

// "No color" shows the theme's dim grey with a cross, so it differs from the greys.
const NO_COLOR = null;

// 32 presets: 8 hues (red, orange, yellow, green, teal, blue, violet, pink)
// in three rows (vibrant, a little muted, more muted), then No color and 7
// greys, light to dark, none so light that the white icon vanishes.
const PRESETS = [
  "#e13e33", "#f86f25", "#eaa918", "#2bbf62", "#0dc6b1", "#2b75fe", "#664ff7", "#e4408e",
  "#ca524a", "#dc7741", "#ce9e34", "#3eac67", "#26ad9e", "#477de2", "#7665e1", "#ce568f",
  "#b8625c", "#c67e57", "#b8964a", "#4e9c6b", "#399a8f", "#5d84cc", "#8377cf", "#bd6790",
  NO_COLOR, "#a6a6a6", "#969696", "#858585", "#757575", "#656565", "#545454", "#444444",
];

const ICONS = ["folder", "layers", "archive", "files", "file-text", "server", "monitor", "terminal", "git-branch", "settings", "pin", "clock"];
const iconPath = (name) => `mods/workspace-chrome/${name}.svg`;

// Quick picks in the emoji dialogs; any other emoji can be typed in the field.
const EMOJIS = [
  "📁", "💼", "🐯", "🌐", "🤖", "🧠", "🧩", "💬", "🔎", "🛠️", "🧰", "📊",
  "📐", "📝", "🎬", "🎥", "🧭", "🕹️", "🛰️", "🐧", "✍️", "📨", "🖥️", "🚀",
];
const EMOJIS_PER_ROW = 12;

// Marks on one row; the rest show as +N.
const MAX_MARKS = 4;
const MARK_ORDER = ["blocked", "done", "working"];

// How far a row steps back while something else is marked 主控 or 副控.
export const FADE = 0.72;
const ROLE_NAME = { main: "主控", sub: "副控" };
const ROLE_RANK = { main: 0, sub: 1 };
// Light enough to read as a name on the dark sidebar. None goes back to the theme's;
// amber is left out: it's the color of an ordinary agent working.
const ROLE_COLORS = [null, "#ef6b6b", "#f59e5b", "#4fce7f", "#3fd0c4", "#6ea8ff", "#a78bfa", "#f472b6"];
const roleColor = (role, t) => loadTree().roleColors?.[role] ?? (role === "main" ? t.accent : t.ansi5);
const byRole = (a, b) => (ROLE_RANK[a.role] ?? 2) - (ROLE_RANK[b.role] ?? 2);
const namesOf = (space) => [space.name, ...(space.tabs ?? []).map((tab) => tab.name)];

// How the list is sorted. Only the drawing changes: the tree keeps its own order.
const SORTS = [
  { id: "manual", label: "原始", icon: "layers" },
  { id: "date", label: "資料夾日期", icon: "clock" },
  { id: "agents", label: "啟用 agent", icon: "terminal" },
];
const sortOf = () => SORTS.find((s) => s.id === shared(SORT_KEY)) ?? SORTS[0];

export function setSort(id) {
  if (SORTS.some((s) => s.id === id)) setShared(SORT_KEY, id);
}

// ---- the saved tree ----

function loadTree() {
  return shared(STORE_KEY) ?? emptyTree();
}

function saveTree(tree) {
  setShared(STORE_KEY, tree);
}

// What a folded folder hides: how many spaces, whether the shown one is in there,
// and the strongest role, so folding never loses a 主控.
function hiddenIn(tree, key) {
  const inside = new Set(spacesUnder(tree, key));
  const found = spaces().filter((s) => inside.has(s.id));
  const roles = found.map((s) => spaceRole(tree, s.id, namesOf(s)));
  return { count: found.length, active: found.some((s) => s.active), role: ["main", "sub"].find((r) => roles.includes(r)) ?? null };
}

// Each space's agents the way the Agents list counts them, sub-agents without a
// pane included: { space id: [{ status, role }, ...] }. A sub-agent is never a controller.
function runningBySpace(roles) {
  const all = terminals();
  const tabs = Object.fromEntries(spaces().map((s) => [s.id, (s.tabs ?? []).map((tab) => tab.name)]));
  const list = agents();
  const listed = new Set(list.map((a) => a.address));
  const children = new Set(all.filter((k) => k.parent).map((k) => k.address));
  const out = {};
  const add = (space, status, role = null) => (out[space] ??= []).push({ status, role });
  const kids = (address, space, seen) => {
    if (seen.has(address)) return;
    seen.add(address);
    for (const k of all) {
      if (k.parent !== address || k.state !== "live") continue;
      if (!listed.has(k.address) && k.status) add(space, k.status === "error" ? "blocked" : k.status === "done" ? "idle" : k.status);
      kids(k.address, space, seen);
    }
  };
  for (const a of list) {
    add(a.space, a.status, children.has(a.address) ? null : agentRole(a, roles[a.space], tabs[a.space] ?? []));
    kids(a.address, a.space, new Set());
  }
  return out;
}

// A 主控 spins its own shape in its color, a 副控 the usual shape in its color, and
// everyone else as in the Agents list: a glance says who's running.
function spinner(role, size, t) {
  const icon = role === "main" ? `mods/${MOD}/lead-spinner.svg` : "mods/workspace-chrome/spinner.svg";
  return svg(icon).size(role === "main" ? size + 1 : size).flex_none().text_color(role ? roleColor(role, t) : t.working).spin(900);
}

// A thin outline on a 主控's or 副控's icon; the row itself stays as it was.
function ringed(el, role, t) {
  return el.when(Boolean(role), (e) => e.border_1().border_color(roleColor(role, t)));
}

// A 主控's or 副控's name, in the same color as its outline.
export function named(el, role, t) {
  return el.when(Boolean(role), (e) => e.text_color(roleColor(role, t))).when(role === "main", (e) => e.font_semibold());
}

// The Agents list's own marks: a spinner, a "!", a dot.
function mark({ status, role }, t) {
  if (status === "working") return spinner(role, 12, t);
  if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
  return div().size(7).mx(2).flex_none().rounded(4).bg(t.done);
}

function fillOf(color, t) {
  if (!color) return t.dim;
  if (color.startsWith("#")) return color;
  return THEME_COLORS[color] ?? t[color];
}

// A new folder in `ref`, with its dialog open to name it.
function newFolderIn(ref) {
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  saveTree(insertFolder(loadTree(), ref, id, NEW_FOLDER_NAME));
  openEditFolder(id);
}

// ---- opening the overlays ----

function openFolderMenu(key) {
  openOverlay({ mod: MOD, kind: "popup", width: 236, height: 330, props: { folderMenu: key } });
}

function openEditFolder(id) {
  openOverlay({ mod: MOD, kind: "dialog", width: 460, props: { edit: id } });
}

export function openSortMenu() {
  openOverlay({ mod: MOD, kind: "popup", width: 190, height: 150, props: { sortMenu: true } });
}

// A right click on a space's row. Herdr's own menu can't take more items, so this
// one has its everyday ones and a way to it.
export function openSpaceMenu(id) {
  const listed = Math.min((allAddresses()[id] ?? []).length, MENU_ADDRESSES);
  openOverlay({ mod: MOD, kind: "popup", width: 236, height: 330 + (listed ? 9 + 22 + 30 * listed : 0), props: { spaceMenu: id } });
}

// Every space's agents' addresses, the ones nobody started first (see addressesBySpace).
function allAddresses() {
  const children = new Set(terminals().filter((k) => k.parent).map((k) => k.address));
  return addressesBySpace(agents(), children);
}

// "main", "sub" or "none", for the role-* commands.
export function markSpace(space, role) {
  if (["main", "sub", "none"].includes(role)) saveTree(setRole(loadTree(), space.id, role === "none" ? null : role, namesOf(space)));
}

export function openEmoji(id) {
  openOverlay({ mod: MOD, kind: "dialog", width: 460, props: { emoji: id } });
}

// The view for a copy of the sidebar opened as an overlay, or null for the sidebar itself.
export function overlayFor(props) {
  const p = props ?? {};
  if (p.sortMenu) return new SortMenu(p.overlay);
  if (p.spaceMenu) return new SpaceMenu(p.spaceMenu, p.overlay);
  if (p.folderMenu) return new FolderMenu(p.folderMenu, p.overlay);
  if (p.edit) return new EditFolderDialog(p.edit, p.overlay);
  if (p.emoji) return new EmojiDialog(p.emoji, p.overlay);
  return null;
}

// ---- the sidebar's side: rows, dragging, new spaces ----

export class Folders {
  constructor() {
    this.tree = emptyTree();
    this.known = { spaces: [], machines: [] };
    this.running = {}; // space id -> its agents' { status, role }
    this.dates = {}; // space id -> when its folder last changed (ms)
    this.programs = {}; // space id -> the program whose icon it shows
    this.roles = {}; // space id -> "main", "sub" or null
    this.hovered = null; // the key of the row under the pointer
    this.dragged = null; // the key under the pointer since the press
    this.drop = null; // { ref, index, over, side } where a release would put it
    this.addresses = {}; // space id -> its agents' { address, name }, the row's first
    this.copied = null; // the address just copied, shown as 已複製 for a moment
  }

  // After a space's name: its first agent's address (t16), small and monospace, to hand
  // to another agent (`hc read t16`). A click copies it and says so for a moment.
  addressChip(id, t) {
    const address = this.addresses[id]?.[0]?.address;
    if (!address) return null;
    const copied = this.copied === address;
    return div().id(`space-address-${id}`).flex_none().h(17).px(4).flex().items_center().rounded(4)
      .border_1().border_color(t.border).font_family("JetBrains Mono").text_size(10.5)
      .text_color(copied ? t.done : t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip("點一下複製位址")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        cx.write_to_clipboard(address);
        this.copied = address;
        cx.notify();
        this.uncopy?.cancel();
        this.uncopy = cx.timer.after(1500, (cx) => { this.copied = null; cx.notify(); });
      })
      .child(copied ? "已複製" : address);
  }

  // The draw list for what exists now (see rowsOf). Keeps the settled tree for
  // the folder rows and for aiming a drag.
  nodes(known) {
    this.known = known;
    this.tree = settle(loadTree(), known);
    this.roles = Object.fromEntries(spaces().map((s) => [s.id, spaceRole(this.tree, s.id, namesOf(s))]));
    this.running = runningBySpace(this.roles);
    this.addresses = allAddresses();
    this.programs = {};
    for (const a of agents()) if (a.program?.icon) this.programs[a.space] ??= a.program;
    return rowsOf(this.tree, known, this.order());
  }

  // The order for the chosen sort; none keeps the tree's.
  order() {
    const sort = sortOf().id;
    if (sort === "agents") return ranked(this.tree, (id) => agentScore(this.running[id] ?? []), (a, b) => a + b);
    if (sort === "date") return ranked(this.tree, (id) => this.dates[id] ?? 0, (a, b) => Math.max(a, b));
    return undefined;
  }

  sortButton(t) {
    return h_flex().id("space-sort").flex_none().h(22).px(6).gap(3).items_center().rounded(5).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => openSortMenu())
      .child(sortOf().label)
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(10));
  }

  foldedMachines() {
    const machines = loadTree().machines;
    return new Set(Object.keys(machines).filter((name) => machines[name].folded));
  }

  toggleFold(key) {
    const tree = loadTree();
    saveTree(setFolded(tree, key, !isFolded(tree, key)));
  }

  unfoldMachine(name) {
    saveTree(setFolded(loadTree(), `machine:${name}`, false));
  }

  newFolderButton(t) {
    return div().id("folder-new").size(26).flex_none().flex().items_center().justify_center().rounded(6)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(() => newFolderIn(ROOT))
      .child(svg("mods/workspace-chrome/folder-plus.svg").size(14));
  }

  // ---- new spaces in a folder ----

  // Unfolds the folder so the new space shows. `run` names no id back, so the
  // first space that appears on the folder's machine goes in the folder (see adoptNew).
  newSpaceIn(key) {
    const tree = setFolded(loadTree(), key, false);
    saveTree(tree);
    const machine = machineAt(tree, key);
    const before = spaces().map((s) => s.id);
    const pending = { ref: key, machine, before, until: Date.now() + PENDING_SPACE_MS };
    setShared(PENDING_KEY, pending);
    run("space.new", { machine: machine ?? "" });
  }

  // Called often with the spaces that exist: files the one waiting for a folder.
  adoptNew(current) {
    const pending = shared(PENDING_KEY);
    if (!pending) return;
    if (Date.now() > pending.until) {
      setShared(PENDING_KEY, null);
      return;
    }
    const fresh = current.find((s) => !pending.before.includes(s.id) && (s.machine ?? null) === pending.machine);
    if (!fresh) return;
    setShared(PENDING_KEY, null);
    saveTree(move(loadTree(), `space:${fresh.id}`, pending.ref, Infinity));
  }

  // ---- rows ----

  // The agents worth a mark: the most urgent first, and 主控 first among equals.
  urgent(ids) {
    const all = ids.flatMap((id) => this.running[id] ?? []);
    return MARK_ORDER.flatMap((status) => all.filter((a) => a.status === status).sort(byRole));
  }

  // One mark per agent that's busy or waiting; null when none.
  marks(ids, t) {
    const list = this.urgent(ids);
    if (!list.length) return null;
    const more = list.length - MAX_MARKS;
    return h_flex().flex_none().gap(3).items_center()
      .children(list.slice(0, MAX_MARKS).map((a) => mark(a, t)))
      .when(more > 0, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`+${more}`)));
  }

  // In the narrow sidebar there's no room for a row of marks: the most urgent
  // one sits on the row's corner.
  corner(ids, t) {
    const top = this.urgent(ids)[0];
    if (!top) return null;
    const sign = top.status === "working" ? spinner(top.role, 10, t) : div().size(7).rounded(4).bg(t[top.status]);
    return h_flex().absolute().right(0).bottom(1).size(12).rounded(6).bg(t.chrome).items_center().justify_center().child(sign);
  }

  marksIn(key, t) {
    return this.marks(spacesUnder(this.tree, key), t);
  }

  // The 執行與待觀看 list: every space with an agent working, waiting on you, or done
  // and not looked at yet, folded away or not, in the tree's order, each with the
  // folders it sits in.
  busy() {
    const ids = new Set([...spacesUnder(this.tree, PINNED), ...spacesUnder(this.tree, ROOT)]);
    return [...ids]
      .filter((id) => (this.running[id] ?? []).some((a) => MARK_ORDER.includes(a.status)))
      .map((id) => ({ id, path: pathOf(this.tree, `space:${id}`) }));
  }

  togglePin(key) {
    const tree = settle(loadTree(), this.known);
    saveTree(isPinned(tree, key) ? unpin(tree, key) : pin(tree, key));
  }

  // The Agents list's pin: shown while the pointer is on the row.
  pinButton(key, t) {
    const pinned = isPinned(this.tree, key);
    return div().id(`pin-${key}`).flex_none().p(2).rounded(4).text_color(t.dim).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(pinned ? "取消釘選" : "釘到最上面")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.togglePin(key);
        // The row moves away from under the pointer, and no hover-out comes.
        this.hovered = null;
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/${pinned ? "pin-off" : "pin"}.svg`).size(13));
  }

  hoverRow(key, on, cx) {
    const next = on ? key : this.hovered === key ? null : this.hovered;
    if (next === this.hovered) return;
    this.hovered = next;
    cx.notify();
  }

  // Once something is marked, the rest steps back, unless it's the shown space,
  // it's waiting on you, or the pointer is on it.
  faded(space) {
    return Object.values(this.roles).some(Boolean) && !this.roles[space.id]
      && !space.active && space.status !== "blocked" && this.hovered !== `space:${space.id}`;
  }

  // What the narrow sidebar's tooltip says.
  label(role, name) {
    return role ? `${ROLE_NAME[role]} · ${name}` : name;
  }

  // A space's avatar: the emoji someone chose, else the icon of the agent in it,
  // else Herdr's letter on its color. The narrow sidebar goes straight to the letter:
  // agents' icons look alike and there's no name beside them.
  spaceTile(space, fill, t, letter = false) {
    const emoji = emojiOf(this.tree, space.id);
    const program = emoji || letter ? null : this.programs[space.id];
    const pic = program ? (program.tint ? svg(program.icon).size(15).text_color(t.foreground) : image(program.icon).w(15).h(15)) : null;
    return ringed(h_flex().id(`space-tile-${space.id}`).size(18).flex_none().rounded(5).items_center().justify_center(), this.roles[space.id], t)
      .when(!emoji && !pic, (el) => el.bg(fill).text_size(10.5).font_bold().text_color("#ffffff"))
      .when(Boolean(emoji), (el) => el.text_size(13))
      .child(emoji ?? pic ?? [...space.name][0]?.toUpperCase() ?? "?");
  }

  // A remote space filed outside its machine: its row says where it runs.
  away(space) {
    return Boolean(space.machine) && machineAt(this.tree, `space:${space.id}`) !== space.machine;
  }

  // `content` moved `depth` levels in; the narrow sidebar has no indent.
  indent(content, depth, collapsed) {
    return v_flex().pl(collapsed ? 0 : depth * INDENT).child(content);
  }

  folderRow(node, t, collapsed) {
    const id = nameOf(node.key);
    const folder = this.tree.folders[id];
    const hidden = node.folded ? hiddenIn(this.tree, node.key) : null;
    // A plain folder icon until someone picks an emoji or a color.
    const box = () => ringed(h_flex().size(18).flex_none().rounded(5).items_center().justify_center(), hidden?.role, t);
    const icon = folder.icon ?? DEFAULT_ICON;
    const tile = folder.emoji ? box().text_size(13).child(folder.emoji)
      : folder.color ? box().bg(fillOf(folder.color, t)).child(svg(icon).size(11).text_color("#ffffff"))
        : box().child(svg(icon).size(15).text_color(t.muted));
    const row = h_flex().relative().id(`folder-${id}`).h(FOLDER_ROW).flex_none().px(collapsed ? 2 : 8).gap(9).items_center().rounded(8)
      .text_color(t.foreground).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.toggleFold(node.key);
        cx.notify();
      });
    // Narrow: an open folder fades to a divider, a folded one sums up what it hides.
    if (collapsed) {
      const corner = node.folded ? this.corner(spacesUnder(this.tree, node.key), t) : null;
      return row.justify_center().h(node.folded ? FOLDER_ROW : 22).tooltip(this.label(hidden?.role, folder.name))
        .when(Boolean(hidden?.active), (el) => el.bg(t.selected))
        .child(node.folded ? tile : div().opacity(0.45).child(tile))
        .when(Boolean(corner), (el) => el.child(corner));
    }
    const marks = node.folded ? this.marksIn(node.key, t) : null;
    return row
      .when(Boolean(hidden?.active), (el) => el.bg(t.selected))
      .child(tile)
      .child(named(div().flex_1().min_w(0).truncate().font_medium(), hidden?.role, t).child(folder.name))
      .when(this.hovered === node.key, (el) => el.child(this.pinButton(node.key, t)))
      .when(Boolean(marks), (el) => el.child(marks))
      .when(Boolean(hidden), (el) => el.child(h_flex().flex_none().h(16).px(6).items_center().rounded(8).bg(t.raised).text_size(10.5).text_color(t.muted).child(String(hidden.count))))
      .when(this.hovered === node.key, (el) => el.child(div().id(`folder-add-${id}`).flex_none().px(4).rounded(4).text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.newSpaceIn(node.key);
        }).child("+")))
      .child(svg(`mods/workspace-chrome/chevron-${node.folded ? "right" : "down"}.svg`).size(11).flex_none().text_color(t.dim));
  }

  // Makes a row of any kind indented, draggable, a drop target, and (for a
  // folder or machine) right-clickable.
  wrap(content, node, t, collapsed) {
    const aimed = this.drop?.over === node.key ? this.drop : null;
    const left = collapsed ? 0 : node.depth * INDENT;
    return v_flex().relative().id(`node-${node.key}`).flex_none()
      .when(aimed?.side === "into", (el) => el.bg(t.selected).rounded(8))
      .when(this.dragged === node.key && this.drop !== null, (el) => el.opacity(0.5))
      .when(aimed?.side === "before", (el) => el.child(this.dropLine(t, left).top(0)))
      .when(aimed?.side === "after", (el) => el.child(this.dropLine(t, left).bottom(0)))
      .on_mouse_down("left", () => this.press(node.key))
      .on_mouse_move((e, cx) => this.hover(node, e, cx))
      .on_mouse_up("left", (_e, cx) => this.release(cx))
      .on_hover((on, cx) => this.hoverRow(node.key, on, cx))
      .when(node.kind !== "space", (el) => el.on_mouse_down("right", () => openFolderMenu(node.key)))
      .child(this.indent(content, node.depth, collapsed));
  }

  dropLine(t, left) {
    return div().absolute().left(left).right(0).h(2).bg(t.accent);
  }

  // ---- dragging ----

  press(key) {
    this.dragged = key;
    this.drop = null;
  }

  hover(node, event, cx) {
    if (!this.dragged || node.key === this.dragged) {
      this.aim(null, cx);
      return;
    }
    this.aim(this.dropAt(node, event.local_position?.y ?? 0), cx);
  }

  aim(drop, cx) {
    const same = this.drop?.over === drop?.over && this.drop?.side === drop?.side;
    if (same) return;
    this.drop = drop;
    cx.notify();
  }

  // Where a release over `node` at `y` px down would put the dragged key; null when that is not allowed.
  dropAt(node, y) {
    const tree = this.tree;
    // A sorted list has no places between rows: only a folder takes a drop.
    const sorted = sortOf().id !== "manual" && node.parent !== PINNED;
    if (sorted && node.kind === "space") return null;
    const side = sorted ? "into" : this.sideOf(node, y);
    const ref = side === "into" ? node.key : node.parent;
    if (!canMove(tree, this.dragged, ref)) return null;
    const index = side === "into" ? (tree.children[ref] ?? []).length : slotNear(tree, ref, this.dragged, node.key, side);
    return { ref, index, over: node.key, side };
  }

  // A folder or machine takes a drop in its middle; a space splits in halves.
  sideOf(node, y) {
    if (node.kind === "space") return y < SPACE_ROW_HALF ? "before" : "after";
    if (y < EDGE) return "before";
    const roomAfter = node.folded || node.empty;
    return roomAfter && y > FOLDER_ROW - EDGE ? "after" : "into";
  }

  release(cx) {
    const { dragged, drop } = this;
    this.cancel();
    if (dragged && drop) {
      const tree = settle(loadTree(), this.known);
      // Dropped among the pinned rows: pinned, so Unpin knows where it came from.
      const from = drop.ref === PINNED ? pin(tree, dragged) : tree;
      saveTree(move(from, dragged, drop.ref, drop.index));
    }
    cx.notify();
  }

  cancel() {
    this.dragged = null;
    this.drop = null;
  }
}

// ---- shared pieces of the overlays ----

function menuItem(t, overlay, key, label, action) {
  return div().id(key).h(30).px(10).flex().items_center().rounded(6).cursor_pointer()
    .hover((s) => s.bg(t.hover))
    .on_click(() => {
      closeOverlay(overlay);
      action();
    })
    .child(label);
}

function separator(t) {
  return div().mx(7).my(4).h(1).bg(t.border);
}

// Color dots in rows; `current` has a ring and `pick(color, cx)` runs on a click.
function swatches(t, key, colors, current, pick) {
  const swatch = (color) => div().id(`${key}-color-${color ?? "default"}`).size(20).flex_none().rounded(10).cursor_pointer()
    .flex().items_center().justify_center().text_size(12).text_color(t.popover).child(color === NO_COLOR ? "×" : "")
    .bg(fillOf(color, t)).border_2().border_color(color === current ? t.foreground : t.popover)
    .hover((s) => s.border_color(t.muted))
    .on_click((_e, cx) => pick(color, cx));
  const lines = [];
  for (let at = 0; at < colors.length; at += SWATCHES_PER_ROW) lines.push(colors.slice(at, at + SWATCHES_PER_ROW));
  return v_flex().px(8).pt(6).pb(8).gap(6).children(
    lines.map((line, n) => h_flex().id(`${key}-colors-${n}`).gap(6).items_center().children(line.map(swatch))),
  );
}

// Quick emoji in rows; `current` is marked and `pick(emoji, cx)` runs on a click.
function emojiPicker(t, key, current, pick) {
  const cell = (emoji, n) => h_flex().id(`${key}-emoji-${n}`).size(30).flex_none().items_center().justify_center().rounded(8).cursor_pointer()
    .text_size(15).when(emoji === current, (el) => el.bg(t.selected).border_1().border_color(t.accent))
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => pick(emoji, cx))
    .child(emoji);
  const lines = [];
  for (let at = 0; at < EMOJIS.length; at += EMOJIS_PER_ROW) lines.push(EMOJIS.slice(at, at + EMOJIS_PER_ROW));
  return v_flex().gap(2).children(
    lines.map((line, row) => h_flex().id(`${key}-emojis-${row}`).gap(2).children(line.map((emoji, n) => cell(emoji, row * EMOJIS_PER_ROW + n)))),
  );
}

const popupFrame = (t, id) => v_flex().id(id).size_full().p(5).gap(1).bg(t.popover).text_color(t.foreground).text_size(12.5);

// ---- overlay: how the list is sorted ----

class SortMenu {
  constructor(overlay) {
    this.overlay = overlay;
  }

  render() {
    const t = theme();
    const on = sortOf().id;
    return v_flex().id("sort-menu").w_full().p(5).bg(t.popover).text_color(t.foreground).text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("排序 Spaces"))
      .children(SORTS.map((s) => h_flex().id(`sort-${s.id}`).h(31).px(8).gap(9).rounded(7).items_center().cursor_pointer()
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setSort(s.id);
          closeOverlay(this.overlay);
        })
        .child(svg(iconPath(s.icon)).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg(iconPath("check")).size(14).flex_none()))));
  }
}

// ---- overlay: a space's menu ----

class SpaceMenu {
  constructor(id, overlay) {
    this.id = id;
    this.overlay = overlay;
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.id === this.id);
    if (!space) return div();
    const tree = loadTree();
    const role = spaceRole(tree, this.id, namesOf(space));
    const item = (key, label, action) => menuItem(t, this.overlay, key, label, action);
    const choice = (value, label) => item(`space-role-${value ?? "none"}`,
      h_flex().w_full().gap(9).items_center()
        .child(div().size(10).flex_none().rounded(5).when(Boolean(value), (el) => el.bg(roleColor(value, t))))
        .child(div().flex_1().child(label))
        .when(value === role, (el) => el.child(svg(iconPath("check")).size(14).flex_none())),
      () => saveTree(setRole(loadTree(), this.id, value, namesOf(space))));
    const paint = (color, cx) => {
      saveTree(setRoleColor(loadTree(), role, color));
      cx.notify();
    };
    // 複製位址: every agent in the space, its address first; a click copies it and closes.
    const addresses = (allAddresses()[this.id] ?? []).slice(0, MENU_ADDRESSES);
    const copy = ({ address, name }) => div().id(`space-copy-${address}`).h(30).px(10).flex().items_center().gap(9).rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        cx.write_to_clipboard(address);
        closeOverlay(this.overlay);
      })
      .child(div().flex_none().font_family("JetBrains Mono").text_size(12).child(address))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(name));
    return v_flex().id("space-menu").w_full().p(5).gap(1).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .when(addresses.length > 0, (el) => el
        .child(div().px(10).pt(3).h(22).text_size(11).text_color(t.dim).child("複製位址"))
        .children(addresses.map(copy))
        .child(separator(t)))
      .child(choice("main", "主控"))
      .child(choice("sub", "副控"))
      .child(choice(null, "不標記"))
      .when(Boolean(role), (el) => el.child(separator(t))
        .child(div().px(10).pt(3).text_size(11).text_color(t.dim).child(`${ROLE_NAME[role]}的顏色（全部共用，× 是預設）`))
        .child(swatches(t, "role", ROLE_COLORS, tree.roleColors?.[role] ?? NO_COLOR, paint)))
      .child(separator(t))
      .child(item("space-emoji", "Emoji…", () => openEmoji(this.id)))
      .child(item("space-rename", "重新命名", () => run("space.rename", { id: this.id })))
      .child(item("space-herdr", "Herdr 選單…", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: this.id } } })))
      .child(separator(t))
      .child(item("space-close", "關閉", () => run("space.close", { id: this.id })));
  }
}

// ---- overlay: a folder's or machine's menu ----

class FolderMenu {
  constructor(key, overlay) {
    this.key = key;
    this.overlay = overlay;
  }

  render() {
    const t = theme();
    const tree = loadTree();
    const id = nameOf(this.key);
    const isFolder = kindOf(this.key) === "folder";
    const item = (key, label, action) => menuItem(t, this.overlay, key, label, action);
    const paint = (color) => {
      saveTree(updateFolder(loadTree(), id, { color }));
      closeOverlay(this.overlay);
    };
    return popupFrame(t, "folder-menu")
      .when(isFolder, (el) => el.child(swatches(t, "folder", PRESETS, tree.folders[id]?.color ?? null, paint)))
      .child(item("folder-new-here", "在這裡新增資料夾", () => newFolderIn(this.key)))
      .child(item("folder-pin", isPinned(tree, this.key) ? "取消釘選" : "釘到最上面", () => {
        const now = loadTree();
        saveTree(isPinned(now, this.key) ? unpin(now, this.key) : pin(now, this.key));
      }))
      .when(isFolder, (el) => el.child(item("folder-edit", "編輯資料夾…", () => openEditFolder(id))))
      .when(isFolder, (el) => el.child(separator(t)).child(item("folder-delete", "刪除資料夾", () => saveTree(deleteFolder(loadTree(), id)))));
  }
}

// ---- what the dialogs share ----

class Dialog {
  labeled(t, label, content) {
    return v_flex().gap(6).child(div().text_size(12).font_medium().text_color(t.muted).child(label)).child(content);
  }

  field(t, label, input) {
    return this.labeled(t, label, this.inputBox(t, input).w_full());
  }

  inputBox(t, input) {
    return div().h(34).px(10).flex().items_center().rounded(8).border_1().border_color(t.input).bg(t.background).child(input);
  }

  button(t, key, label, primary, action) {
    return h_flex().id(key).h(32).px(14).flex_none().items_center().rounded(8).border_1()
      .border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground)
      .text_size(12.5).font_medium().cursor_pointer().hover((s) => s.opacity(0.88))
      .on_click(action).child(label);
  }
}

// ---- overlay: a space's emoji ----

class EmojiDialog extends Dialog {
  constructor(id, overlay) {
    super();
    this.id = id;
    this.overlay = overlay;
    this.emoji = InputState.new({ value: emojiOf(loadTree(), id) ?? "", placeholder: "Win + . 可以開表情符號面板" });
    this.emoji.on("submit", () => this.save(this.emoji.value()));
    this.emoji.focus();
  }

  save(value) {
    saveTree(setEmoji(loadTree(), this.id, cleanEmoji(value)));
    closeOverlay(this.overlay);
  }

  render() {
    const t = theme();
    const space = spaces().find((s) => s.id === this.id);
    return v_flex().id("space-emoji").w_full().p(20).gap(16).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(15).font_semibold().child(`${space?.name ?? "這個 space"} 的 Emoji`))
      .child(this.field(t, "Emoji", Input.new(this.emoji).w_full().text_size(13).text_color(t.foreground)))
      .child(emojiPicker(t, "space", cleanEmoji(this.emoji.value()), (emoji) => this.save(emoji)))
      .child(h_flex().pt(4).gap(8).justify_end()
        .child(this.button(t, "emoji-clear", "預設", false, () => this.save("")))
        .child(this.button(t, "emoji-cancel", "取消", false, () => closeOverlay(this.overlay)))
        .child(this.button(t, "emoji-save", "儲存", true, () => this.save(this.emoji.value()))));
  }
}

// ---- overlay: Edit folder ----

class EditFolderDialog extends Dialog {
  constructor(id, overlay) {
    super();
    this.id = id;
    this.overlay = overlay;
    const folder = loadTree().folders[id] ?? { name: NEW_FOLDER_NAME, icon: DEFAULT_ICON, color: null };
    this.icon = folder.icon ?? DEFAULT_ICON;
    this.color = folder.color ?? null;
    this.name = InputState.new({ value: folder.name });
    this.emoji = InputState.new({ value: folder.emoji ?? "", placeholder: "留空就用圖示和顏色" });
    this.hex = InputState.new({ value: isHex(this.color) ? this.color : "", placeholder: "#rrggbb" });
    this.name.on("submit", () => this.save());
    this.hex.on("change", (_e, cx) => {
      if (!isHex(this.hex.value())) return;
      this.color = this.hex.value();
      cx.notify();
    });
    this.name.set_selected_range({ start: 0, end: folder.name.length });
    this.name.focus();
  }

  save() {
    const tree = loadTree();
    const name = this.name.value().trim() || tree.folders[this.id]?.name;
    saveTree(updateFolder(tree, this.id, { name, icon: this.icon, color: this.color, emoji: cleanEmoji(this.emoji.value()) }));
    closeOverlay(this.overlay);
  }

  chooseColor(color, cx) {
    this.color = color;
    this.hex.set_value(isHex(color) ? color : "");
    cx.notify();
  }

  render() {
    const t = theme();
    return v_flex().id("folder-edit").w_full().p(20).gap(16).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        closeOverlay(this.overlay);
        cx.stop_propagation();
      })
      .child(div().text_size(15).font_semibold().child("編輯資料夾"))
      .child(this.field(t, "名稱", Input.new(this.name).w_full().text_size(13).text_color(t.foreground)))
      .child(this.field(t, "Emoji", Input.new(this.emoji).w_full().text_size(13).text_color(t.foreground)))
      .child(emojiPicker(t, "folder", cleanEmoji(this.emoji.value()), (emoji, cx) => {
        this.emoji.set_value(emoji);
        cx.notify();
      }))
      .child(this.labeled(t, "圖示", this.iconRow(t)))
      .child(this.labeled(t, "顏色", swatches(t, "edit", PRESETS, this.color, (color, cx) => this.chooseColor(color, cx))))
      .child(this.hexRow(t))
      .child(h_flex().pt(4).gap(8).justify_end()
        .child(this.button(t, "folder-cancel", "取消", false, () => closeOverlay(this.overlay)))
        .child(this.button(t, "folder-save", "儲存", true, () => this.save())));
  }

  iconRow(t) {
    return h_flex().gap(4).children(ICONS.map((name) => {
      const path = iconPath(name);
      return h_flex().id(`edit-icon-${name}`).size(30).flex_none().items_center().justify_center().rounded(8).cursor_pointer()
        .when(path === this.icon, (el) => el.bg(t.selected).border_1().border_color(t.accent))
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          this.icon = path;
          cx.notify();
        })
        .child(svg(path).size(15).text_color(t.foreground));
    }));
  }

  // A preview of the color, and the hex field.
  hexRow(t) {
    const preview = div().size(34).flex_none().rounded(8).border_1().border_color(t.input).bg(fillOf(this.color, t));
    const hexBox = this.inputBox(t, Input.new(this.hex).w_full().text_size(13).text_color(t.foreground)).flex_1().min_w(0);
    return h_flex().gap(8).child(preview).child(hexBox);
  }
}
