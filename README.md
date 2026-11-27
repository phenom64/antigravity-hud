# antigravity-hud

[![npm version](https://img.shields.io/npm/v/antigravity-hud)](https://www.npmjs.com/package/antigravity-hud)
[![npm downloads](https://img.shields.io/npm/dm/antigravity-hud)](https://www.npmjs.com/package/antigravity-hud)
[![License](https://img.shields.io/github/license/phenom64/antigravity-hud)](LICENSE)

> A 4-line statusline HUD & terminal window title provider for the [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli).

![Antigravity HUD Preview](img/antigravity-hud.png)

## The backstory

Whilst building SynCloudOS I burned through my entire [Claude Code](https://claude.ai) and [ChatGPT Codex](https://chat.openai.com) weekly usage limits in about 48 hours. Classic. Then I rediscovered **Google Antigravity**, Google's agentic coding CLI that runs Gemini models and third-party models like Claude Opus and Sonnet through the same interface. More importantly, I realised I had been paying for it the whole time and figured I should use it at least once.

Now that Gemini 4 Neon, Carbon, Hydrogen, and Orchestrator are actually awesome, running Antigravity as a daily driver makes total sense.

Antigravity's built-in statusline is minimal, though. I wanted a HUD that shows everything at a glance: active model, context window burn, prompt cache hit rate, 5-hour and weekly quota bars, reset timers, git/jj/hg branch state, live step checklists, Vim mode, queued prompts, and tool activity — à la [claude-hud](https://github.com/jarrodwatts/claude-hud).

So I built this. First as a [PowerShell script](legacy/statusline-syn.ps1), then as a zero-dependency Node.js CLI.

## What's new in 0.6.0

- **Full Antigravity CLI v1.5.17 statusline payload parity**:
  - **Native USD cost (`cost.total_usd` / `cost.subagent_usd`)**: Uses exact CLI-reported spend (including subagent breakdown `+$0.04 sub`) when supplied, falling back to `~` API estimates only when omitted.
  - **Vim editor mode badge (`vim.mode`)**: Shows color-coded `NORMAL`, `INSERT`, `VISUAL`, or `V-LINE` on Line 1 when Vim mode is active.
  - **Queued prompt counter (`pending_input_count`)**: Displays `⏳ N queued` (or `Nq` in `tiny`) next to the agent state when follow-up messages are queued.
  - **Artifact counter (`artifact_count`)**: Displays `N artifacts` on Line 4 with a clickable OSC 8 link to the conversation's brain directory.
  - **Structured `subagents[]` status**: Separates `running` vs `completed` subagents (`1 agents (Codebase Researcher 35s, +1 done)`) instead of lumping them together.
  - **All `agent_state` values**: Dedicated styling for `error` (`✖ error`), `reviewing` (`⏸ reviewing`), `initializing`, and `authenticating`.
  - **Custom agents, `model.effort` & Orchestrator pairs**: Shows `@<agent.name>` for custom agents, appends `model.effort` when not already in the label, and enriches `Orchestrator` with your configured `Planner → Executor` pair from `settings.json`.
  - **VCS awareness (`vcs.type`)**: Supports `git`, Jujutsu (`jj`), and Mercurial (`hg`) badges, and skips spawning `git` outside repositories on CLI v1.4+.
- **Companion terminal window title (`antigravity-hud title`)**:
  - Plain-text single-line title renderer for Antigravity CLI's `"title"` config block (`antigravity-hud install --with-title`, toggleable in the TUI with `/title`).
- **Live `update_steps` checklist tracking (CLI v1.5.16+)**:
  - Parses `update_steps` calls from `transcript.jsonl` to show real-time `N/M steps (active step)` and failed step counts on Line 4.
- **Context cache hit rate & auto-compaction override (CLI v1.5.15+)**:
  - Shows prompt cache hit ratio (`⚡71%`) on Line 2 and respects `AGY_CLI_AUTO_COMPACT_OVERRIDE` (`700000`, `800K`, `0.5M`, `80%`) for compaction warnings (`cmp 82%`).
- **Quota & AI credits upgrades**:
  - Hides quota bars cleanly when `quota` is empty (e.g. `GEMINI_API_KEY` sessions) instead of showing fake `100%` gauges.
  - Respects `disabled: true` buckets and displays positive `remaining_amount` balances (AI Credits) while hiding `0` balances.
  - Optional quota burn pace delta (`showQuotaPace: true` -> `⇡12%` / `⇣8%`).
- **`settings.json` hygiene & performance**:
  - `install` preserves official `statusLine.padding` and `statusLine.stack_with_default` (and adds `--with-title`, `--stack`, `--padding <n>` flags).
  - `mode` supports both `agentMode` (`default`, `accept-edits`, `plan`) and `toolPermission` (`review`, `auto`, `yolo`, `strict`).
  - Debug payload dumps (`statusline-last.json`) are now opt-in via `AGY_HUD_DEBUG=1` to eliminate disk writes on every 300ms render tick.

See [CHANGELOG.md](CHANGELOG.md) for the full release history.

## Features

- **Quota health bars & credits**: 5-hour, weekly, `argon-wk`, and AI credit gauges with colour thresholds, live reset countdowns, and optional pace deltas.
- **Context window meter**: Token input/output counts, capacity, cache hit %, auto-compaction threshold awareness, and a colour-shifting progress bar.
- **Tool tallies & live steps**: Counts tool usage per category from the active session transcript (`✔ read ×5 │ ✔ edit ×2 │ ✔ bash ×3`) and tracks live `update_steps` checklists.
- **Window title mode**: Dynamic terminal tab/window titles (`antigravity-hud title`) so you can monitor agent state even when the terminal is minimized.
- **OSC 8 terminal hyperlinks**: Clickable links for the project folder, remote GitHub branch tree, conversation artifacts folder, and transcript log.
- **Adaptive layouts**: Scales across `normal` (`>=118` cols), `compact` (`92-117` cols), and `tiny` (`<92` cols) terminal widths.
- **Zero dependencies**: Pure Node.js built-ins (`node >= 18`) on Windows, macOS, and Linux.

## Installation

### One-command install (recommended)

Works out of the box on macOS, Linux, and Windows (Node.js 18+):

```bash
npx antigravity-hud install
```

This installs a zero-dependency standalone copy into `~/.gemini/antigravity-cli/antigravity-hud/`, backs up your existing `~/.gemini/antigravity-cli/settings.json` (keeping the 5 newest backups), and wires up `statusLine` automatically. Re-run `npx antigravity-hud@latest install` anytime to upgrade.

### Global install (adds `antigravity-hud` to your `PATH`)

If you also want to run `antigravity-hud configure`, `doctor`, or `mode` directly without `npx`:

**macOS / Linux:**
```bash
npm install -g antigravity-hud && antigravity-hud install
```

**Windows (PowerShell):**
```powershell
npm install -g antigravity-hud; antigravity-hud install
```

**Also enable dynamic terminal window titles (`title`):**
```bash
npx antigravity-hud install --with-title
```

**Or configure directly inside the Antigravity TUI:**
```text
/statusline antigravity-hud
```
Use `/statusline off` to pause, `/statusline enable` to resume, `/statusline delete` to revert, and `/title` to toggle window titles.

`antigravity-hud install` creates `~/.gemini/antigravity-cli/settings.json` if needed, backs up your existing settings (keeping the 5 newest backups), preserves `padding` and `stack_with_default`, and supports `--with-title`, `--stack`, `--no-stack`, and `--padding <n>`.

### Verify installation

```bash
antigravity-hud doctor
```

Checks your `PATH`, prints the active `agentMode`, `toolPermission`, `statusLine`, and `title` settings, and renders sample HUD + window title outputs.

### Configuration

Run the interactive configuration wizard:

```bash
antigravity-hud configure
```

Preferences are saved to `~/.gemini/antigravity-cli/antigravity-hud-config.json`:

```json
{
  "preset": "full",
  "showCost": true,
  "showSpeed": true,
  "showCacheHit": true,
  "showQuotaPace": false,
  "showArtifacts": true,
  "showConversationId": false,
  "enableLinks": true,
  "colorMode": true,
  "unicodeMode": true,
  "colors": {
    "model": "cyan",
    "project": "yellow",
    "git": "brightBlue",
    "label": "gray"
  }
}
```

#### Presets

- **`full`** (default): 4-line HUD with model, repo, VCS status, spinner, Vim mode, context bar, cache hit %, quotas, cost, speed, tool tallies, mode badge, artifacts, subagents, live steps/plan progress, skills/MCP counts, and session duration.
- **`essential`**: 2-line HUD with model, repo, VCS, spinner, context bar, quotas, and cost/speed on Line 1.
- **`minimal`**: 1-line HUD with model, repo, VCS, spinner, and cost/speed.

### Uninstalling

```bash
antigravity-hud uninstall
```

Sets `statusLine.enabled = false` (and `title.enabled = false` if configured) in `settings.json` and prints the command to restore your latest backup.

## Commands

### Tool Permission & Agent Execution Mode

Line 4 displays your active mode, reading `cycle_mode` from the live Antigravity CLI payload (`Shift+Tab` in the TUI cycles `default → accept-edits → auto → plan`) and falling back to `toolPermission` / `agentMode` in `settings.json`. You can also inspect or change persisted defaults:

- **Show current modes:**
  ```bash
  antigravity-hud mode
  ```
- **Set startup `agentMode`:**
  ```bash
  antigravity-hud mode <default|accept-edits|plan>
  ```
- **Set or cycle `toolPermission`:**
  ```bash
  antigravity-hud mode <review|auto|yolo|strict|next>
  ```

## Output lines explained

```
Line 1:  Gemini 4 Neon (High) │ ws git:(feat/hud* ↑1) │ ⠸ working ⏳ 1 queued │ NORMAL
Line 2:  ctx [████░░░░] 21% (48.0k ↑ / 4.0k ↓ / 1.0m) ⚡71% │ 5h [█████░] 90% 4h 54m │ wk [█████░] 90% 6d 3h │ $0.421 │ 35.4 t/s
Line 3:  ✔ write ×19 │ ✔ edit ×2 │ ✔ read ×34 │ ✔ bash ×20 │
Line 4:  ⏩ auto mode on ● 20 shell ● 1 tasks ● 2 artifacts ● 1 agents (Codebase Researcher 42s) ● 3/5 steps (Run tests) ● 2 skills ● 1 mcp ● 14m 20s
```

| Element | Source |
|---|---|
| Model & agent | `model.display_name`, `model.effort`, `settings.orchestrator` (`Planner → Executor`), and custom `agent.name` (`@name`) |
| Repo & VCS | Basename of `workspace.project_dir` (OSC 8 link) + `git` / `jj` / `hg` branch, dirty `*`, ahead/behind (`↑N ↓M`) |
| State, queue & Vim | `agent_state` (`idle`, `working`, `tool_use`, `reviewing`, `error`, `initializing`), `⚠ confirm`, `pending_input_count`, and `vim.mode` |
| Context & cache | `context_window.used_percentage`, token counts, prompt cache hit `⚡N%`, and `AGY_CLI_AUTO_COMPACT_OVERRIDE` compaction threshold |
| Quotas & credits | `5h` + `wk` (or `argon-wk` on Argon Pro), positive AI credits (`remaining_amount`), optional pace delta (`⇡N%`/`⇣N%`); hidden cleanly in `GEMINI_API_KEY` mode |
| Cost & speed | Native `cost.total_usd` (+ `subagent_usd`) with cache-aware API fallback (`~`), plus `t/s` output streaming rate |
| Tool tallies | Parsed from the active conversation's `transcript.jsonl` |
| Mode badge | Live `Shift+Tab` `cycle_mode` (`⏩ auto mode on`, `⏵⏵ accept edits on`, `⏸ plan mode on`) or `settings.json` fallback |
| Session telemetry | Shell, task, artifact (`artifact_count`), structured subagent (`running`/`completed` + role & timer), live `update_steps` / plan progress, skills, MCP servers, sandbox, and session duration |

### Quota colour thresholds

| Remaining | Colour |
|---|---|
| 50-100% | Purple-Blue (`#8EA2FF`) |
| 25-49% | Amber |
| 15-24% | Orange |
| 1-14% | Red |
| 0% | `⚠ Limit reached` |

## Layout modes & environment variables

| Layout | Terminal width | Bar length | Tool categories |
|---|---|---|---|
| `normal` | `>= 118` cols | 10-16 blocks | up to 6 |
| `compact` | `92-117` cols | 8 blocks | up to 5 |
| `tiny` | `< 92` cols | no bars (`%` only) | up to 4 |

| Variable | Values | Description |
|---|---|---|
| `AGY_HUD_LAYOUT` | `normal`, `compact`, `tiny` | Force a specific layout mode |
| `AGY_HUD_NO_COLOR` | `1` | Disable ANSI colour codes |
| `AGY_HUD_NO_UNICODE` | `1` | Use ASCII glyphs only |
| `AGY_HUD_NO_SPINNER` | `1` | Disable spinner animation |
| `AGY_HUD_TOOL_MAX` | `1`-`10` | Max tool categories shown on Line 3 |
| `AGY_HUD_TRANSCRIPT` | path | Override transcript JSONL path (useful for testing) |
| `AGY_HUD_LINKS` | `0`, `1` | Override OSC 8 terminal hyperlinks (enabled by default; set `0` to disable) |
| `AGY_HUD_DEBUG` | `1` | Dump raw stdin JSON payload to `~/.gemini/antigravity-cli/statusline-last.json` |
| `AGY_CLI_AUTO_COMPACT_OVERRIDE` | `800K`, `0.5M`, `80%`, `700000` | Antigravity CLI compaction threshold (reflected in HUD context warning & `cmp N%`) |

## Project structure

```
antigravity-hud/
├── bin/
│   └── antigravity-hud.js    # CLI entrypoint (HUD, title, install, configure, doctor, mode)
├── src/
│   ├── config.js             # Config loader & defaults
│   ├── git.js                # VCS-aware (git/jj/hg) TTL-cached branch & remote resolver
│   ├── hyperlinks.js         # OSC 8 terminal hyperlink helpers
│   ├── quota.js              # Quota, AI credits, pace delta, compaction override & cost resolver
│   ├── title.js              # Plain-text terminal window title renderer
│   ├── transcript.js         # Conversation-scoped transcript & update_steps parser + speed tracker
│   └── render/
│       └── lines.js          # Adaptive 4-line ANSI HUD renderer
├── tests/
│   ├── test-hyperlinks.js
│   ├── test-integration.js
│   ├── test-parser.js
│   └── test-render.js
├── legacy/
│   └── statusline-syn.ps1    # Original PowerShell prototype
├── scripts/
│   ├── install.ps1           # Windows installer
│   └── install.sh            # macOS/Linux installer
├── docs/
│   └── payload-examples/
│       ├── statusline-last.example.json
│       └── transcript.example.jsonl
├── package.json
├── LICENSE
├── CHANGELOG.md
└── README.md
```

## Development

```bash
# Run unit & integration test suite
npm test

# Test HUD render with sample payload
cat docs/payload-examples/statusline-last.example.json | node bin/antigravity-hud.js

# Test window title render with sample payload
cat docs/payload-examples/statusline-last.example.json | node bin/antigravity-hud.js title

# Test with sample transcript
cat docs/payload-examples/statusline-last.example.json | AGY_HUD_TRANSCRIPT=docs/payload-examples/transcript.example.jsonl node bin/antigravity-hud.js
```

On Windows PowerShell:
```powershell
Get-Content docs\payload-examples\statusline-last.example.json -Raw | node bin\antigravity-hud.js
Get-Content docs\payload-examples\statusline-last.example.json -Raw | node bin\antigravity-hud.js title
```

## License

[MIT](LICENSE).

## Credits

Designed by Kavish Krishnakumar in Manchester. Personal project, not affiliated with Syndromatic Limited. Inspired by [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud).
