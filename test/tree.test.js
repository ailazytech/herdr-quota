import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyTree,
  canMove,
  move,
  slotNear,
  insertFolder,
  deleteFolder,
  settle,
  rowsOf,
  setFolded,
  updateFolder,
  isHex,
} from "../mods/herdr-folders/tree.js";

// This computer: folders a (holding b and a local space) and a local space.
// Machine dev holds folder m and a remote space; m holds another.
// Machine other holds folder o.
function sample() {
  const folder = (name) => ({ name, icon: "mods/workspace-chrome/folder.svg", color: null, folded: false });
  return {
    version: 1,
    folders: { a: folder("a"), b: folder("b"), m: folder("m"), o: folder("o") },
    machines: {},
    children: {
      root: ["folder:a", "machine:dev", "machine:other", "space:l1"],
      "folder:a": ["folder:b", "space:l2"],
      "folder:b": [],
      "machine:dev": ["folder:m", "space:dev/r1"],
      "folder:m": ["space:dev/r2"],
      "machine:other": ["folder:o"],
      "folder:o": [],
    },
  };
}

const keysOf = (nodes) => nodes.map((n) => n.key);

test("canMove: each rule, one row per case", () => {
  const cases = [
    ["local space into a folder inside a machine", "space:l1", "folder:m", false],
    ["local space into a machine", "space:l1", "machine:dev", false],
    ["local space into a root folder", "space:l1", "folder:a", true],
    ["remote space out of its machine, to root", "space:dev/r1", "root", true],
    ["remote space out of its machine, to a root folder", "space:dev/r1", "folder:a", true],
    ["remote space into another machine's folder", "space:dev/r1", "folder:o", false],
    ["remote space into a folder inside its machine", "space:dev/r1", "folder:m", true],
    ["remote space into its machine", "space:dev/r2", "machine:dev", true],
    ["machine into a folder inside another machine", "machine:dev", "folder:o", false],
    ["machine into another machine", "machine:dev", "machine:other", false],
    ["machine into a root-level folder", "machine:dev", "folder:a", true],
    ["machine to root", "machine:dev", "root", true],
    ["folder into its own child", "folder:a", "folder:b", false],
    ["folder into itself", "folder:a", "folder:a", false],
    ["empty folder into a machine", "folder:b", "machine:dev", true],
    ["folder holding a local space into a machine", "folder:a", "machine:dev", false],
    ["folder holding a remote space to root", "folder:m", "root", true],
    ["folder holding a remote space into its machine", "folder:m", "machine:dev", true],
    ["folder holding a remote space into another machine", "folder:m", "machine:other", false],
  ];
  for (const [name, key, target, expected] of cases) {
    assert.equal(canMove(sample(), key, target), expected, name);
  }
});

test("canMove: a folder holding a machine cannot go inside a machine", () => {
  const tree = sample();
  tree.children.root = ["folder:a", "machine:other", "space:l1"];
  tree.children["folder:a"] = ["machine:dev"];
  assert.equal(canMove(tree, "folder:a", "machine:other"), false);
  assert.equal(canMove(tree, "folder:a", "root"), true);
});

test("move: inserts at an index in another parent", () => {
  const moved = move(sample(), "space:l1", "folder:a", 0);
  assert.deepEqual(moved.children["folder:a"], ["space:l1", "folder:b", "space:l2"]);
  assert.deepEqual(moved.children.root, ["folder:a", "machine:dev", "machine:other"]);
});

test("move: reorders within the same parent", () => {
  const tree = sample();
  tree.children.root = ["space:x", "space:y", "space:z"];
  assert.deepEqual(move(tree, "space:z", "root", 0).children.root, ["space:z", "space:x", "space:y"]);
  assert.deepEqual(move(tree, "space:x", "root", 2).children.root, ["space:y", "space:z", "space:x"]);
  assert.deepEqual(move(tree, "space:x", "root", 1).children.root, ["space:y", "space:x", "space:z"]);
});

test("move: an index past the end appends; a key in no list is added", () => {
  const appended = move(sample(), "space:l1", "folder:a", 99);
  assert.deepEqual(appended.children["folder:a"], ["folder:b", "space:l2", "space:l1"]);
  const added = move(sample(), "space:new", "folder:a", 1);
  assert.deepEqual(added.children["folder:a"], ["folder:b", "space:new", "space:l2"]);
});

test("move: a move canMove refuses changes nothing, and the input is never changed", () => {
  const tree = sample();
  const before = structuredClone(tree);
  assert.deepEqual(move(tree, "space:l1", "folder:m", 0), before);
  move(tree, "space:l1", "folder:a", 0);
  assert.deepEqual(tree, before);
});

test("slotNear: the index before or after a sibling, ignoring the moved key", () => {
  const tree = sample();
  tree.children.root = ["space:x", "space:y", "space:z"];
  assert.equal(slotNear(tree, "root", "space:x", "space:z", "before"), 1);
  assert.equal(slotNear(tree, "root", "space:x", "space:z", "after"), 2);
  assert.equal(slotNear(tree, "root", "space:z", "space:x", "before"), 0);
  assert.equal(slotNear(tree, "root", "space:z", "space:x", "after"), 1);
  assert.equal(slotNear(tree, "root", "space:x", "space:gone", "before"), 2);
});

test("deleteFolder: its children go to its parent at its place", () => {
  const tree = sample();
  tree.children.root = ["space:x", "folder:a", "space:y"];
  const after = deleteFolder(tree, "a");
  assert.deepEqual(after.children.root, ["space:x", "folder:b", "space:l2", "space:y"]);
  assert.equal("a" in after.folders, false);
  assert.equal("folder:a" in after.children, false);
});

test("deleteFolder: a folder inside a machine hands its children to the machine", () => {
  const after = deleteFolder(sample(), "m");
  assert.deepEqual(after.children["machine:dev"], ["space:dev/r2", "space:dev/r1"]);
});

test("deleteFolder: a folder in no list hands its children to the root's end", () => {
  const tree = sample();
  tree.children.root = ["machine:dev"];
  const after = deleteFolder(tree, "a");
  assert.deepEqual(after.children.root, ["machine:dev", "folder:b", "space:l2"]);
});

test("insertFolder: goes after the last folder in its parent", () => {
  const tree = sample();
  tree.folders.c = { name: "c", icon: "i", color: null, folded: false };
  tree.children.root = ["space:s", "folder:a", "space:t", "machine:dev", "space:u"];
  const after = insertFolder(tree, "root", "n", "New folder");
  assert.deepEqual(after.children.root, ["space:s", "folder:a", "folder:n", "space:t", "machine:dev", "space:u"]);
  assert.equal(after.folders.n.name, "New folder");
  assert.equal(after.folders.n.folded, false);
  assert.deepEqual(after.children["folder:n"], []);
});

test("insertFolder: with no folder yet, goes first; a machine can be the parent", () => {
  const tree = emptyTree();
  tree.children.root = ["space:s"];
  assert.deepEqual(insertFolder(tree, "root", "n", "New folder").children.root, ["folder:n", "space:s"]);
  const inMachine = insertFolder(sample(), "machine:dev", "n", "New folder");
  assert.deepEqual(inMachine.children["machine:dev"], ["folder:m", "folder:n", "space:dev/r1"]);
});

const known = (spaces, machines = []) => ({ spaces, machines });
const local = (id) => ({ id, machine: null });
const remote = (machine, id) => ({ id: `${machine}/${id}`, machine });

test("rowsOf: unplaced spaces and machines go to the end of the root or their machine", () => {
  const tree = emptyTree();
  tree.folders.a = { name: "a", icon: "i", color: null, folded: false };
  tree.children.root = ["folder:a"];
  const nodes = rowsOf(tree, known([remote("dev", "r1"), local("l1")], ["dev"]));
  assert.deepEqual(keysOf(nodes), ["folder:a", "space:l1", "machine:dev", "space:dev/r1"]);
  assert.deepEqual(nodes.map((n) => n.depth), [0, 0, 0, 1]);
  assert.equal(nodes[3].parent, "machine:dev");
});

test("rowsOf: a remote space whose machine is in a folder follows the machine", () => {
  const tree = emptyTree();
  tree.folders.a = { name: "a", icon: "i", color: null, folded: false };
  tree.children.root = ["folder:a"];
  tree.children["folder:a"] = ["machine:dev"];
  const nodes = rowsOf(tree, known([remote("dev", "r1")], ["dev"]));
  assert.deepEqual(keysOf(nodes), ["folder:a", "machine:dev", "space:dev/r1"]);
  assert.deepEqual(nodes.map((n) => n.depth), [0, 1, 2]);
});

test("rowsOf: keys for things that are gone are skipped and kept", () => {
  const tree = sample();
  tree.children.root = ["space:gone", "folder:a", "machine:ghost", "folder:nope", "space:l1"];
  const nodes = rowsOf(tree, known([local("l1"), local("l2")]));
  assert.deepEqual(keysOf(nodes), ["folder:a", "folder:b", "space:l2", "space:l1"]);
  assert.deepEqual(tree.children.root.includes("space:gone"), true);
  assert.deepEqual(settle(tree, known([local("l1")])).children.root.includes("machine:ghost"), true);
});

test("rowsOf: a folded folder or machine hides its children", () => {
  const tree = sample();
  tree.folders.a.folded = true;
  tree.machines.dev = { folded: true };
  const nodes = rowsOf(tree, known([local("l1"), local("l2"), remote("dev", "r1"), remote("dev", "r2")], ["dev", "other"]));
  assert.deepEqual(keysOf(nodes), ["folder:a", "machine:dev", "machine:other", "folder:o", "space:l1"]);
  assert.equal(nodes[0].folded, true);
  assert.equal(nodes[1].folded, true);
});

test("rowsOf: a machine with nothing to show says so", () => {
  const tree = emptyTree();
  const nodes = rowsOf(tree, known([remote("dev", "r1")], ["dev", "idle"]));
  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  assert.equal(byKey["machine:dev"].empty, false);
  assert.equal(byKey["machine:idle"].empty, true);
});

test("rowsOf: each node knows its parent", () => {
  const nodes = rowsOf(sample(), known([local("l1"), local("l2")], ["dev", "other"]));
  const second = nodes.find((n) => n.key === "space:l2");
  assert.equal(second.parent, "folder:a");
});

test("settle: puts every known space and machine in a list, and is repeatable", () => {
  const tree = emptyTree();
  const once = settle(tree, known([local("l1"), remote("dev", "r1")], ["dev"]));
  assert.deepEqual(once.children.root, ["space:l1", "machine:dev"]);
  assert.deepEqual(once.children["machine:dev"], ["space:dev/r1"]);
  assert.deepEqual(settle(once, known([local("l1"), remote("dev", "r1")], ["dev"])), once);
});

test("setFolded and updateFolder: change a copy", () => {
  const tree = sample();
  assert.equal(setFolded(tree, "folder:a", true).folders.a.folded, true);
  assert.deepEqual(setFolded(tree, "machine:dev", true).machines.dev, { folded: true });
  assert.equal(updateFolder(tree, "a", { name: "Work", color: "ansi3" }).folders.a.name, "Work");
  assert.equal(tree.folders.a.name, "a");
  assert.equal(tree.folders.a.folded, false);
});

test("setFolded unfolds a folded folder, which is what the + button does", () => {
  const tree = sample();
  tree.folders.a.folded = true;
  assert.equal(setFolded(tree, "folder:a", false).folders.a.folded, false);
});

test("move: a drop onto a folded folder leaves it folded", () => {
  const tree = sample();
  tree.folders.a.folded = true;
  assert.equal(move(tree, "space:l1", "folder:a", Infinity).folders.a.folded, true);
});

test("isHex: six hex digits after a #", () => {
  const cases = [["#a1B2c3", true], ["#000000", true], ["#abc", false], ["a1b2c3", false], ["#12345g", false], ["#1234567", false], ["", false], [null, false]];
  for (const [text, expected] of cases) assert.equal(isHex(text), expected, String(text));
});

test("a folder outside every machine holds spaces from several machines", async () => {
  const { emptyTree, insertFolder, settle, move, machineAt, canMove, spacesUnder, ROOT } = await import("../mods/herdr-folders/tree.js");
  let tree = insertFolder(emptyTree(), ROOT, "mix", "Mix");
  const known = { spaces: [{ id: "l1", machine: null }, { id: "dev/r1", machine: "dev" }, { id: "other/r2", machine: "other" }], machines: ["dev", "other"] };
  tree = settle(tree, known);
  for (const key of ["space:l1", "space:dev/r1", "space:other/r2"]) tree = move(tree, key, "folder:mix", Infinity);
  assert.deepEqual(tree.children["folder:mix"], ["space:l1", "space:dev/r1", "space:other/r2"]);
  assert.equal(machineAt(tree, "space:dev/r1"), null);
  assert.deepEqual(spacesUnder(tree, "folder:mix"), ["l1", "dev/r1", "other/r2"]);
  assert.equal(canMove(tree, "folder:mix", "machine:dev"), false);
});

test("a space's emoji is kept by id, moves with nothing, and can be cleared", async () => {
  const { emptyTree, setEmoji, emojiOf, cleanEmoji, insertFolder, updateFolder, settle, move, ROOT } = await import("../mods/herdr-folders/tree.js");
  const known = { spaces: [{ id: "l1", machine: null }], machines: [] };
  let tree = settle(insertFolder(emptyTree(), ROOT, "a", "A"), known);
  const before = tree;
  tree = setEmoji(tree, "l1", "🐯");
  assert.equal(emojiOf(before, "l1"), null);
  assert.equal(emojiOf(move(tree, "space:l1", "folder:a", 0), "l1"), "🐯");
  assert.equal(emojiOf(setEmoji(tree, "l1", null), "l1"), null);
  assert.equal(emojiOf({ folders: {}, children: {} }, "l1"), null); // a tree saved before emoji existed
  assert.equal(cleanEmoji("  🐯 "), "🐯");
  assert.equal(cleanEmoji("   "), null);
  assert.equal(updateFolder(tree, "a", { emoji: "🧠" }).folders.a.emoji, "🧠");
});

test("pin: goes on top with what it holds, and unpin puts it back at its place", async () => {
  const { emptyTree, insertFolder, settle, move, pin, unpin, isPinned, rowsOf, ROOT, PINNED } = await import("../mods/herdr-folders/tree.js");
  const known = { spaces: [{ id: "a", machine: null }, { id: "b", machine: null }, { id: "c", machine: null }], machines: [] };
  let tree = settle(insertFolder(emptyTree(), ROOT, "f", "F"), known);
  tree = move(tree, "space:b", "folder:f", 0);
  tree = move(tree, "space:c", "folder:f", 1);
  const start = tree.children["folder:f"];
  const pinned = pin(tree, "space:b");
  assert.equal(isPinned(pinned, "space:b"), true);
  assert.deepEqual(pinned.children["folder:f"], ["space:c"]);
  assert.equal(rowsOf(pinned, known)[0].key, "space:b");
  assert.equal(rowsOf(pinned, known)[0].parent, PINNED);
  assert.deepEqual(unpin(pinned, "space:b").children["folder:f"], start);
  assert.equal(pin(pinned, "space:b"), pinned);

  const folder = pin(tree, "folder:f");
  assert.deepEqual(rowsOf(folder, known).slice(0, 3).map((n) => [n.key, n.depth]), [["folder:f", 0], ["space:b", 1], ["space:c", 1]]);
});

test("unpin: a space whose folder is gone goes to its default parent", async () => {
  const { emptyTree, insertFolder, deleteFolder, settle, move, pin, unpin, ROOT } = await import("../mods/herdr-folders/tree.js");
  const known = { spaces: [{ id: "dev/r1", machine: "dev" }], machines: ["dev"] };
  let tree = settle(insertFolder(emptyTree(), ROOT, "f", "F"), known);
  tree = pin(move(tree, "space:dev/r1", "folder:f", 0), "space:dev/r1");
  tree = unpin(deleteFolder(tree, "f"), "space:dev/r1");
  assert.deepEqual(tree.children["machine:dev"], ["space:dev/r1"]);
  assert.deepEqual(tree.pinnedFrom, {});
});

test("pin: a remote space in the pinned list is outside every machine", async () => {
  const { emptyTree, settle, pin, machineAt } = await import("../mods/herdr-folders/tree.js");
  const known = { spaces: [{ id: "dev/r1", machine: "dev" }], machines: ["dev"] };
  assert.equal(machineAt(pin(settle(emptyTree(), known), "space:dev/r1"), "space:dev/r1"), null);
});

test("ranked: sorts siblings by what they hold, ties keep their order, the tree stays", async () => {
  const { emptyTree, insertFolder, settle, move, rowsOf, ranked, pin, ROOT } = await import("../mods/herdr-folders/tree.js");
  const known = { spaces: ["a", "b", "c", "d"].map((id) => ({ id, machine: null })), machines: [] };
  let tree = settle(insertFolder(insertFolder(emptyTree(), ROOT, "f", "F"), ROOT, "g", "G"), known);
  tree = move(tree, "space:a", "folder:f", 0);
  tree = move(tree, "space:b", "folder:g", 0);
  tree = move(tree, "space:c", "folder:g", 1);
  const before = JSON.stringify(tree.children);
  const score = { a: 1, b: 5, c: 9, d: 0 };
  const byMax = ranked(tree, (id) => score[id], (x, y) => Math.max(x, y));
  assert.deepEqual(rowsOf(tree, known, byMax).map((n) => n.key), ["folder:g", "space:c", "space:b", "folder:f", "space:a", "space:d"]);
  assert.equal(JSON.stringify(tree.children), before);
  const none = ranked(tree, () => 0, (x, y) => x + y);
  assert.deepEqual(none(["space:d", "folder:f", "folder:g"]), ["space:d", "folder:f", "folder:g"]);
  const pinned = pin(pin(tree, "space:a"), "space:c");
  const order = ranked(pinned, (id) => score[id], (x, y) => x + y);
  assert.deepEqual(rowsOf(pinned, known, order).slice(0, 2).map((n) => n.key), ["space:a", "space:c"]);
});

test("a space's names say whether it is 主控 or 副控", async () => {
  const { roleOf } = await import("../mods/herdr-folders/tree.js");
  const cases = [
    ["a tab called 主控", ["網站", "主控", "2"], "main"],
    ["a tab called 副控", ["網站", "副控"], "sub"],
    ["both: 主控 wins", ["網站", "副控", "主控"], "main"],
    ["in the space's own name", ["前端-主控", "1"], "main"],
    ["inside a longer tab name", ["web", "前端副控"], "sub"],
    ["副手 is not 副控", ["開發機-副手", "1"], null],
    ["nothing said", ["api", "1"], null],
    ["a tab with no name", ["api", null, undefined], null],
    ["no names", [], null],
  ];
  for (const [label, names, role] of cases) assert.equal(roleOf(names), role, label);
});

test("agentRole: a tab decides when any tab says something, else the space does", async () => {
  const { agentRole } = await import("../mods/herdr-folders/tree.js");
  const cases = [
    ["the 主控 tab", { tab_name: "主控" }, "main", ["主控", "3"], "main"],
    ["its neighbour", { tab_name: "3" }, "main", ["主控", "3"], null],
    ["a 副控 tab beside a 主控 tab", { tab_name: "副控" }, "main", ["主控", "副控"], "sub"],
    ["no tab says: the space's role", { tab_name: "1" }, "main", ["1"], "main"],
    ["marked 副控 by hand", { tab_name: "1" }, "sub", ["1"], "sub"],
    ["the space is marked neither", { tab_name: "主控" }, null, ["主控"], null],
  ];
  for (const [label, agent, role, tabs, want] of cases) assert.equal(agentRole(agent, role, tabs), want, label);
});

test("spaceRole and setRole: a choice beats the names, and the names can have it back", async () => {
  const { emptyTree, spaceRole, setRole } = await import("../mods/herdr-folders/tree.js");
  const told = ["網站", "主控"];
  const plain = ["api", "1"];
  const empty = emptyTree();
  assert.equal(spaceRole(empty, "a", told), "main");
  assert.equal(spaceRole(empty, "a", plain), null);

  const sub = setRole(empty, "a", "sub", told);
  assert.equal(spaceRole(sub, "a", told), "sub");
  const neither = setRole(empty, "a", null, told);
  assert.equal(spaceRole(neither, "a", told), null);
  assert.equal(neither.roles.a, "none");
  assert.deepEqual(setRole(sub, "a", "main", told).roles, {});

  const marked = setRole(empty, "b", "main", plain);
  assert.equal(spaceRole(marked, "b", plain), "main");
  assert.deepEqual(setRole(marked, "b", null, plain).roles, {});
  assert.equal(empty.roles, undefined);
});

test("roles and their colors survive settle, moves and pins", async () => {
  const { emptyTree, insertFolder, settle, move, pin, unpin, setRole, setRoleColor, ROOT } = await import("../mods/herdr-folders/tree.js");
  const known = { spaces: [{ id: "a", machine: null }], machines: [] };
  let tree = setRoleColor(setRole(settle(insertFolder(emptyTree(), ROOT, "f", "F"), known), "a", "sub", []), "sub", "#a78bfa");
  tree = unpin(pin(move(settle(tree, known), "space:a", "folder:f", Infinity), "space:a"), "space:a");
  assert.equal(tree.roles.a, "sub");
  assert.equal(tree.roleColors.sub, "#a78bfa");
  assert.deepEqual(setRoleColor(tree, "sub", null).roleColors, {});
});

test("ranked: the outermost level sorts too, by what's deep inside it", async () => {
  const { emptyTree, insertFolder, settle, move, rowsOf, ranked, ROOT } = await import("../mods/herdr-folders/tree.js");
  let tree = insertFolder(emptyTree(), ROOT, "a", "A");
  tree = insertFolder(tree, ROOT, "b", "B");
  tree = insertFolder(tree, "folder:b", "deep", "Deep");
  const known = { spaces: [{ id: "calm", machine: null }, { id: "busy", machine: null }, { id: "loose", machine: null }], machines: [] };
  tree = settle(tree, known);
  tree = move(tree, "space:calm", "folder:a", Infinity);
  tree = move(tree, "space:busy", "folder:deep", Infinity);
  const top = (scores) => rowsOf(tree, known, ranked(tree, (id) => scores[id] ?? 0, (x, y) => x + y))
    .filter((node) => node.depth === 0).map((node) => node.key);
  assert.deepEqual(top({}), ["folder:a", "folder:b", "space:loose"]);
  assert.deepEqual(top({ busy: 1 }), ["folder:b", "folder:a", "space:loose"]);
  assert.deepEqual(top({ loose: 1 }), ["space:loose", "folder:a", "folder:b"]);
});

test("agentScore: one running agent beats any number finished", async () => {
  const { agentScore } = await import("../mods/herdr-folders/tree.js");
  const many = (status, n) => Array.from({ length: n }, () => ({ status }));
  assert.ok(agentScore(many("working", 1)) > agentScore(many("done", 50)));
  assert.ok(agentScore(many("blocked", 1)) > agentScore(many("done", 50)));
  assert.ok(agentScore(many("done", 1)) > agentScore(many("idle", 50)));
  assert.equal(agentScore(many("working", 2)), 2 * agentScore(many("working", 1)));
  assert.equal(agentScore([]), 0);
});
