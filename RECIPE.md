# Quota Main

Herdr's default window (spaces and agents on the left, tabs on top, pane cards, Files / Changes / tendr panels on the right) with one change: the bottom status bar shows how much of each AI coding plan is left. Claude, Codex, Grok and Antigravity each get their logo, the weekly limit as a plain percentage, and, where the plan has one, the 5-hour limit as a small bar with its percentage inside and the time until it resets. Antigravity's limits come in groups (Gemini, Claude and GPT, Gemini 4 Argon), so its logo is followed by one short segment per group. Clicking them opens a popup with every limit as a bar, its exact reset time, the plan name and how fresh the data is.

![Quota Main](preview.png)

## What you see

- **Layout:** a clone of Herdr's `main` layout (app 0.1.10). Left sidebar 268 px (brand 46 px, spaces and agents lists, footer 69 px); work column with the tab bar (42 px), the active tab's panes as cards, an optional right panel 368 px (a stack of Files, Changes and tendr), and the status bar (28 px) at the bottom.
- **Status bar, left to right:** "This computer" (or the space's machine) with a monitor icon, the branch, "N agents" and "· N needs you" in the blocked color, a spacer, then on the right:
  - "tendr" after a 13 px flame (`mods/quota-status/flame.svg`, Lucide's `flame`, stroke 1.5 like the app's own glyphs), only when the layout has a block with id `tendr`: text dim and flame dim when the panel is hidden; text foreground and flame `ansi3` (lit) when it shows the tendr board. (tendr: the one who tends the fire.)
  - One chip per provider, 12 px apart. What a chip shows is set by the settings (see "Settings"): a list of elements per provider. The default (`compact` preset) is, in order (5 px gaps):
    1. The brand logo, 13 px: `icons/claude.svg`, `icons/codex.svg` and `icons/antigravity.svg` drawn as full-color images, `icons/grok.svg` as a tinted svg (the app ships all four).
    2. The weekly (or monthly) limit as text, e.g. `77%`: muted below 70 %, the theme's `ansi3` (yellow) from 70 %, `ansi1` (red) from 90 %. Then, in `dim`, the time until it resets (`2d11h`, `1d`, `10h14m`) once it's used at least `weeklyResetAt` % (90 by default; 0 for Antigravity, so always). A window whose reset time has passed shows `✓`.
    3. The 5-hour limit (Claude and Antigravity) as a bar 44 × 13 px, radius 3, track `border`, fill in `ansi4` (or yellow / red as above) at opacity 0.65, the percentage centered on top in 10 px `foreground`, e.g. `4%`; then the countdown in `dim`, e.g. `3h48m`, left out while the window is at 0 % (an unused 5-hour window always reads 5h).
    4. A provider with no usable data shows its logo and `🔑` (token expired or not logged in: run that CLI once) or `⚠️` (anything else).
  - Antigravity's chip: the logo once, then per group (6 px apart, separated by a `dim` `·`) the group's short name in `dim` — `Gemini`, `Opus` (the Claude and GPT group), `Argon` — followed by items 2 and 3 for that group, e.g. `Gemini 19% 9h50m [6%] 3h10m · Opus 63% 2d11h [0%] · Argon 28% 23h57m`. Argon has a weekly limit only.
  - When the settings have a mistake, a `⚙⚠️` in `ansi3` follows the chips.
  - "Ctrl Shift P  commands" (⌘ on macOS), opening the palette.
- **Popup** (760 wide, kind `popup`, at the pointer; height from the content: 58 px plus, per provider, 10 + 18 per line + 4 between lines + 18 for a notes line, kept within 190–480): header "AI 額度", the update time (date added when not today), a "⚙ 設定" button (opens the settings window and closes the popup), a "↻ 重新整理" button and ✕; under it, one 11 px `ansi3` line per settings mistake ("設定：…"). Percentages follow `percent` (`… left` when showing what's left). One row per provider: logo 15 px and name in an 84 px column, then each window as `Usage ▬ 4% (resets in 3h 50m) | Weekly ▬ 77% (resets in 2d 3h)` with 48 × 6 px bars; Antigravity gets one such line per group, its short name in a 46 px `foreground` column, the provider name aligned with the first line. Under it, in 11 px `dim`, the plan, each group's models (`Opus＝Claude Opus, Claude Sonnet, GPT-OSS`), "資料時間 hh:mm" when older than 2 minutes, and the error if the shown data is stale.

## Settings

- **File:** `mods/quota-status/config.json` beside `quota.mjs` (git-ignored, never overwritten by install). `quota.mjs` reads and checks it; a wrong entry is reported in `configErrors` and falls back to its default instead of breaking the bar.
- **Look, like claude-hud:** `preset` is `compact` (default: `logo`, `group`, `weekly`, `weekly.reset`, `5h.bar`, `5h.reset`), `full` (`logo`, `name`, `group`, `weekly.bar`, `weekly.reset`, `5h.bar`, `5h.reset`) or `minimal` (`logo`, `group`, `weekly`, `5h`). `layout` overrides it with its own list, as `default` or per provider. Elements: `logo`, `name`, `group` (agy's group name), `weekly`, `weekly.bar`, `weekly.reset`, `5h`, `5h.bar`, `5h.reset`; any other string is shown as is in `dim` (separators, own labels). For a provider with groups, `logo` and `name` appear once and the rest once per group. A string that looks like a misspelled element (`weekly.rest`) is still shown, and also reported.
- **Other keys:** `providers` (order and which), `percent` (`used` or `left`; colors always follow what's used), `cautionAt` 70 / `warnAt` 90, `weeklyResetAt` (a number for all, or `{default: 90, agy: 0}`), `ttlSec`, `timeoutMs`, `agyTimeoutMs`.
- **Settings window** (`kind: "dialog"`, 780 × 620, so a click elsewhere doesn't lose an edit; opened from the popup's ⚙ or the `settings` command): header "額度設定" with the file path and ✕; a row of quick buttons — "樣式" with one per preset (`精簡 compact`, `完整 full`, `極簡 minimal`; picking one sets `preset` and removes `layout.default`) and "百分比" with `用掉 used` / `剩下 left` — the active ones in `solid`; four 11 px `dim` lines explaining `layout` and the elements; a JSON `Editor` (`EditorState`, language `json`, the person's mono font) filling the rest; a footer with the message and "關閉" / "儲存並套用". It starts from the file, or, when there's none yet, from `node quota.mjs config` (the settings in effect). Saving parses the JSON (an error keeps it unsaved), writes with `writeTextFile(path, text, original)` so an outside edit since opening isn't overwritten, refreshes, and reports "已存檔並套用" or the entries that didn't apply.

## How it behaves

- Data refreshes every 60 s. `quota.mjs` caches the network calls (Claude 5 min, the API's rate limit; Grok 2 min; Antigravity 3 min, since each check starts agy for about 5 s); Codex is read from local files every time.
- Antigravity is optional: on a computer without `agy` it's left out entirely (no `⚠️`).
- Clicking the chips opens the popup; ↻ forces a refresh past the cache. Both views share one `shared("quota-status.quota")` value, so either refresh updates both.
- Settings changes apply at the next refresh (within a minute), or at once when saved from the settings window.
- Mod commands (`herdr-app do quota-status.<command>`, or `quota-status:<command>` in keys.json): `detail` opens the popup, `settings` the settings window, `refresh` forces a refresh, `tendr` toggles the tendr panel.
- If drawing the bar ever throws, it shows "quota-status 畫面錯誤：…" in `ansi1` instead of freezing on the last frame.
- "tendr" shows or hides the right panel on the tendr board (`layout.select {stack: "panel-body", child: "tendr"}`, `layout.show {id: "panel"}`). At start it adds `tendr` to the shared `workspace.panels`, so the shipped tab bar remembers the panel per space.
- If tendr is installed (`~/.tendr/install.json` exists), the bar also brings Claude Code back after a reboot: it runs tendr's `resume.mjs` at start and every minute for the first 10 minutes, and posts "已接回 N 個 Claude 對話" when it resumed something.
- Agent statuses (working, blocked, done, idle) are drawn by the shipped sidebar mods; the status bar only counts agents and blocked ones.

## Built from

- **Layout `quota-main`:** `row#root` → `column#sidebar` [`block#brand` workspace-chrome, `column#sidebar-lists` [`block#spaces` spaces, `block#agents` agents], `block#sidebar-footer` workspace-chrome `{footer: true}`] and `column#work` [`block#tabs` tabs, `row#work-body` [`block#main` content `{tab: "active"}` with pane header mod `pane-address`, `column#panel` [`stack#panel-body` [files, changes, `block#tendr` tendr-board]]], `block#status` quota-status].
- **Mod `quota-status`** (this repo): a copy of the shipped `workspace-status` plus the quota chips and popup. The same mod renders the popup when opened with `props().detail` and the settings window with `props().settings`. It uses `spaces`, `agents`, `theme`, `run`, `window`, `exec`, `shared`, `setShared`, `openOverlay`, `closeOverlay`, `nextCommand`, `props`, `layout`, `notify`, `home`, `appHome`, `readTextFile`, `writeTextFile`, `settings`, and `Editor` / `EditorState` from gpui-base. Its own icon: `flame.svg` (Lucide `flame`, ISC).
- **Layout `quota-folders`:** `quota-main` with `block#spaces` showing the mod `herdr-folders`.
- **Mod `pane-address`** (this repo): a copy of the shipped `pane` header (0.1.15) with the terminal's address (`props().pane` → `panes()` → `terminal`) after the name, small, monospace and outlined; a click copies it with `cx.write_to_clipboard` and shows 已複製 for 1.5 s (`cx.timer.after`). `install.mjs` switches an installed layout's `pane` headers to it.
- **Mod `herdr-folders`** (this repo): the folder tree in `tree.js` (no Herdr calls; `npm test` covers it), rows, dragging and overlays in `folders.js`, and `main.js`, a copy of the shipped `spaces`. The tree is stored in shared state under `herdr-folders`.
- **Shipped mods:** workspace-chrome, spaces, agents, tabs, files, changes. **Optional:** `tendr-board` from [ailazytech/tendr](https://github.com/ailazytech/tendr) (`app/`).
- **Programs:** `node` runs `mods/quota-status/quota.mjs json` (and tendr's `resume.mjs` when installed); `quota.mjs` runs `agy -p /usage --output-format json` in the temp folder, without a shell.
- **Network and files outside the mod folder:** `quota.mjs` reads `~/.claude/.credentials.json` (or `$CLAUDE_CONFIG_DIR`) and calls `https://api.anthropic.com/api/oauth/usage`; reads `~/.grok/auth.json` and calls `https://cli-chat-proxy.grok.com/v1/billing`; reads Codex's `~/.codex/sessions/**/rollout-*.jsonl` (no network). Each token goes only to its own provider. Antigravity's numbers come from agy's own `/usage` (its `command.data.groups[].buckets[]`: `window` `weekly` / `5h`, `remaining_fraction`, `reset_time`); no login files are read. It caches results in `%LOCALAPPDATA%/herdr-quota/cache.json` (`~/.cache/herdr-quota` elsewhere).

## Watch out

- A popup's props come from `props()`; the `init` argument doesn't carry them.
- `herdr-app do <mod>.<command>` reaches shown copies only, and right after a layout switch the first command can be lost.
- Copy a new mod's `mod.json` first: with the app open, a `main.js` that arrives first docks a default block into the shown layout.
- `herdr-app check` can pass while a render fails on a missing name: after installing, look at `herdr-app shot`.
- Popups close on any click outside them, including the person working elsewhere in the window.
- Herdr's own layouts and mods are read-only (restored on every start): this is a clone, and so is the status mod.
- The Claude usage endpoint is rate limited: keep the 5-minute cache. `quota.mjs` never refreshes OAuth tokens (that would steal the CLI's login); an expired token shows 🔑 until the CLI runs again.
- Grok's billing response is protobuf JSON: fields that are 0 are omitted, so a current period without a percentage means 0 %.
- Codex only writes `rate_limits` at the end of a turn, and some plans have only a weekly window.
- agy's `/usage` reports the fraction left; show `used = (1 − remaining_fraction) × 100` like the other providers. Run it without a shell: Git Bash turns a bare `/usage` argument into a Windows path, and agy then sends it to the model as a prompt.
- The app's `exec` uses the person's PATH: `node` must be on it.

## Done when

- `herdr-app check ~/.config/herdr-app/mods/quota-status` passes and `herdr-app status` lists no errors after `layout.switch {name: "quota-main"}`.
- Within a minute the bar shows a logo and numbers for every provider the person is logged in to (🔑 or ⚠️ for the others).
- Clicking the chips opens the popup with one row per provider; ↻ changes the update time.
- `node ~/.config/herdr-app/mods/quota-status/quota.mjs json` prints `{results, display, configErrors}`: `results` is an array of `{id, good, error}` entries, `display` the layout and thresholds per provider.
- "⚙ 設定" opens the settings window; picking `完整 full` and saving changes the bar, and a misspelled element shows up as a settings mistake.
- Without tendr's board installed there is no "📋 tendr" and no error.
