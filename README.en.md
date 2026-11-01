# herdr-quota

English ｜ [繁體中文](README.md)

A layout for the [herdr app](https://herdr.dev): the bottom status bar shows, at its right end, how much of your Claude, Codex, Grok and Antigravity plans is left.

![Quota Main](preview.png)

- **Weekly limit**: the brand logo followed by the percentage (yellow from 70 %, red from 90 %, plus the days until reset when it's nearly used up)
- **5-hour limit** (Claude and Antigravity have one): a small bar with the percentage inside, followed by the time until it resets (no countdown while it's at 0 %)
- **Antigravity** (agy) splits its limits into groups: after its logo, one segment per group — `Gemini` (Gemini Flash / Pro), `Opus` (Claude Opus, Sonnet, GPT-OSS) and `Argon` (Gemini 4 Argon, weekly only)
- **Click** for a popup with a bar per limit, exact reset times, the plan and how fresh the data is, and a refresh button; "⚙ 設定" (settings) edits the look right in the app (see Settings)
- **Arrange it yourself**: like claude-hud, pick a preset or use `layout` to choose which elements each provider shows, in what order
- With [tendr](https://github.com/ailazytech/tendr) installed, a "tendr" button with a flame icon toggles the tendr board on the right (the flame is lit while the board shows), and Claude Code conversations come back automatically after a reboot

## Install

You need the herdr app (installed and opened once), Node.js 18+ on PATH, and git.

```bash
git clone https://github.com/ailazytech/herdr-quota
node herdr-quota/install.mjs --switch
```

- Installs into `~/.config/herdr-app`: `layouts/quota-main.json` and `mods/quota-status/`
- `--switch` checks the mod and switches to `quota-main`; `Ctrl+Shift+L` switches back
- An existing `quota-main.json` is kept (you may have changed it); pass `--force` for the new one, the old one is backed up
- Update: `git pull`, then run `node install.mjs` again (the mod is updated, the layout as above)

### With tendr (optional)

The layout's right panel has a slot for the tendr board. Without tendr the installer removes it; once tendr is installed:

```bash
node tendr/app/install.mjs --layout quota-main
```

tendr's installer records its location in `~/.tendr/install.json`. When the status bar finds it, it:

- shows "tendr" with a flame icon to toggle the board on the right
- runs tendr's `resume.mjs` after the app starts, bringing back the Claude conversations from before the reboot

## Where the data comes from

`mods/quota-status/quota.mjs` reads each CLI's local login, and **each token goes only to that provider's own usage API**:

| | Reads | Sends to |
| --- | --- | --- |
| Claude | `~/.claude/.credentials.json` (or `CLAUDE_CONFIG_DIR`) | `api.anthropic.com/api/oauth/usage` |
| Codex | the latest session logs in `~/.codex/sessions` | nothing (offline) |
| Grok | `~/.grok/auth.json` | `cli-chat-proxy.grok.com/v1/billing` |
| Antigravity | no login files: runs `agy -p /usage --output-format json` | agy asks its own service (no model quota used) |

- Results are cached in `%LOCALAPPDATA%\herdr-quota\cache.json` (`~/.cache/herdr-quota` elsewhere): Claude 5 minutes (the API is rate limited), Grok 2 minutes, Antigravity 3 minutes (each check starts agy, about 5 s)
- Without agy installed, Antigravity isn't shown. agy reports what's left; like the others, the bar shows what's used
- **Tokens are never refreshed** (that would steal the CLI's login). An expired token shows 🔑; open that CLI once
- Codex updates its limits only at the end of a turn; some plans have only a weekly limit
- A service you're not logged in to shows 🔑 or ⚠️ without affecting the others

From a terminal:

```bash
node ~/.config/herdr-app/mods/quota-status/quota.mjs line     # one line
node ~/.config/herdr-app/mods/quota-status/quota.mjs detail   # table
```

## Settings

Click the quota in the status bar for the popup, then "⚙ 設定" (settings) to edit them right in the app (or `herdr-app do quota-status.settings`): quick buttons for the preset and the percentage on top, the JSON below. Saving checks the JSON first and applies it at once.

Settings live in `~/.config/herdr-app/mods/quota-status/config.json`; updates leave it alone, and any editor works too (applied at the next refresh, within a minute). A wrong entry is listed in the popup and the settings window and falls back to its default, so the bar keeps working. `node quota.mjs config` prints the settings in effect.

### The status bar's look (like claude-hud)

`preset` picks a ready-made set:

| preset | Each provider shows |
| --- | --- |
| `compact` (default) | logo, weekly %, weekly reset countdown (when nearly used up), 5-hour bar, 5-hour countdown |
| `full` | adds the name and draws the weekly limit as a bar too |
| `minimal` | logo, weekly %, 5-hour %, all as plain text |

To arrange it yourself, write `layout`: elements in order, either as `default` (every provider) or for one provider (`claude`, `codex`, `grok`, `agy`); it overrides the preset.

| Element | Shows |
| --- | --- |
| `logo` | brand icon |
| `name` | name (Claude, Antigravity, …) |
| `group` | group name (agy only: Gemini, Opus, Argon) |
| `weekly` | weekly (or monthly) percentage |
| `weekly.bar` | weekly limit as a small bar with the percentage inside |
| `weekly.reset` | time until the weekly limit resets, e.g. `2d11h`; only from `weeklyResetAt` % used |
| `5h` | 5-hour percentage |
| `5h.bar` | 5-hour limit as a small bar |
| `5h.reset` | time until the 5-hour limit resets (left out at 0 %) |
| anything else | shown as is, e.g. `"|"`, `"W"` |

agy's limits come in groups: `logo` and `name` appear once, every other element once per group.

Example: only the 5-hour limit for Claude, and agy's weekly limits as bars:

```json
{
  "preset": "compact",
  "layout": {
    "claude": ["logo", "5h.bar", "5h.reset"],
    "agy": ["logo", "group", "weekly.bar", "weekly.reset", "5h.bar"]
  }
}
```

### Other settings

| Setting | Meaning | Default |
| --- | --- | --- |
| `providers` | Which services to show, in order | `["claude", "codex", "grok", "agy"]` |
| `percent` | `used` shows what's used, `left` what's left (colors always follow what's used) | `"used"` |
| `cautionAt`, `warnAt` | Yellow and red from this much used | `70`, `90` |
| `weeklyResetAt` | Show `weekly.reset` from this much used; one number for every provider, or per provider | `{ "default": 90, "agy": 0 }` (agy's groups reset at different times, so always) |
| `ttlSec` | Cache seconds per service | `{ "claude": 300, "grok": 120, "agy": 180 }` |
| `timeoutMs` | Network timeout | `8000` |
| `agyTimeoutMs` | Timeout for `agy -p /usage` | `30000` |

## Commands

`herdr-app do quota-status.<command>`, or `quota-status:<command>` in `keys.json`:

- `detail`: open the popup
- `settings`: open the settings window
- `refresh`: refetch now, ignoring the cache
- `tendr`: toggle the tendr board on the right

## Uninstall

Switch to another layout with `Ctrl+Shift+L`, then delete `~/.config/herdr-app/layouts/quota-main.json` and `~/.config/herdr-app/mods/quota-status/`.

## For agents

[RECIPE.md](RECIPE.md) is the rebuild brief in herdr's format: follow it from an empty folder to build the same layout and mod.

## License

[MIT](LICENSE)
