# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.3] - 2026-11-22

*Cumulative release notes from `0.4.1` to `0.5.3`.*

### Added
- **Gemini 4 Family & Claude 5.5 Support**:
  - Added 1,000,000-token context capacities, API-equivalent pricing estimates (with 75% prompt-cache read discounting for `cache_read_input_tokens`), and `tiny` layout effort shortening (`(XH)`, `(Orch)`, `(H)`, `(M)`, `(L)`, `(T)`) for `Gemini 4 Neon`, `Gemini 4 Argon`, `Gemini 4 Carbon`, `Gemini 4 Hydrogen`, `Gemini 3.8 Flash`, `Claude Opus 5.5`, `Claude Sonnet 5.5`, and `GPT-5` / `o3` / `o4`.
- **Gemini 4 Argon Pro Weekly Quota (`argon-wk`)**:
  - Added dedicated support for `gemini-argon-wtu-weekly` on Google AI Pro plans (`argon-wk` progress bar, percentage, and reset timer on Line 2).
  - Suppresses the standard 5-hour (`5h`) bar on Argon Pro when healthy, and surfaces `5h` as a secondary warning bar if `gemini-5h` drops below 25%.
- **Live Wall-Clock Quota Reset Countdowns**:
  - `resolveResetSeconds()` and `quotaPct()` in `src/quota.js` now compute remaining time dynamically from `reset_time` ISO timestamps rather than static `reset_in_seconds` snapshots, and reset the gauge to `100%` once `reset_time` passes in wall-clock time.
- **Full `Shift+Tab` Cycle Mode Support & Media-Player Glyph Aesthetic**:
  - Reads live `cycle_mode` from the Antigravity CLI statusline payload across all four `Shift+Tab` states:
    - `auto`: `⏩ auto mode on` (orange)
    - `accept-edits`: `⏵⏵ accept edits on` (light purple `#C4A7FF`)
    - `plan`: `⏸ plan mode on` (teal `#2DD4BF`)
    - Default / `settings.json` fallback: `⏩ bypass permissions (YOLO)` (hot pink `#FF3B8A`), `⏸ review mode on` (amber `#FFD166`), and `■ strict mode on` (icy blue-grey `#8EA2FF` with media-player stop glyph `■`).
- **`claude-hud` Parity Telemetry**:
  - **Context Bar Color Gradient**: Context window progress bar shifts from green (`<50%`) to yellow (`>=50%`), orange (`>=70%`), and red (`>=85%`).
  - **Git Ahead / Behind Counters**: Parses `[ahead N, behind M]` from `git status --porcelain -b` and renders `↑N` and `↓M` inside `git:(branch* ↑N ↓M)`.
  - **Subagent Runtimes, Plan Checklists, Skills/MCP Counters & Session Duration**: Line 4 renders active subagent role and elapsed runtime (`1 agents (Codebase Researcher 42s)`), markdown checklist progress (`3/5 plan`), active skills (`2 skills`), MCP servers (`1 mcp`), tool confirmation alerts (`⚠ confirm` on Line 1), sandbox badge (`sandbox`), and total session duration (`14m 20s`).

### Fixed & Changed
- **Conversation-Scoped Transcript & Speed Caches (`src/transcript.js`)**:
  - Fixed a bug in `resolveTranscript()` where `antigravity-hud-state.json` remained pinned to an older conversation's `transcript.jsonl` across new CLI sessions.
  - Added path resolution for Antigravity CLI v1.5+ payloads where `transcript_path` points to `.gemini/antigravity/brain/<id>` while the CLI writes logs to `.gemini/antigravity-cli/brain/<id>`.
  - Scoped `speed-cache.json` by `conversationId` so switching conversations resets `tok/s` velocity without cross-session delta spikes.
- **Git Status & Remote TTL Caching (`src/git.js`)**:
  - Combined branch, dirty state, and ahead/behind detection into a single `git status --porcelain -b` call cached with a 5-second TTL (and 60-second TTL for `git remote get-url origin`), eliminating 3 synchronous `git` spawns per render tick.
- **Unified Modular Architecture & Config Hygiene**:
  - Unified `bin/antigravity-hud.js` and `src/` (`src/render/lines.js`, `src/transcript.js`, `src/quota.js`, `src/hyperlinks.js`, `src/git.js`) so the CLI and unit tests exercise the same production renderer.
  - Removed RAM percentage polling and `showMemory` from the HUD and configuration wizard.
  - Updated `antigravity-hud configure` to preserve all config keys and added a toggle for OSC 8 terminal hyperlinks.
  - Capped `settings.json` backup files to the 5 most recent backups.

## [0.4.1] - 2026-08-03

### Fixed & Enhanced
- 🔗 Default Terminal Hyperlinks & Git Branch Links:
  - Enabled OSC 8 terminal hyperlinks out-of-the-box by default (`config.enableLinks`).
  - Added clickable OSC 8 hyperlink to the git branch name (`git:(master*)`) linking directly to the remote GitHub tree (`https://github.com/owner/repo/tree/branch`) or local folder.

## [0.4.0] - 2026-08-03

### Added
- 🚀 Claude HUD Parity & Telemetry Upgrade:
  - Active Subagent Runtimes & Jump Links: Live tracking of running subagents, active roles, elapsed runtime (`42s`), and clickable OSC 8 links directly to transcript logs.
  - Quota Reset Timers: 5-hour and 7-day rate limit gauges with `resets in Xh Ym` countdown timers.
  - Interactive Terminal Hyperlinks: OSC 8 links enabled for project paths (`file://`), remote git branch trees (`https://github.com/...`), subagent transcript logs, and settings.
  - Plan / Todo Checklist Tracker: Automatically parses transcript checklists to display `📋 Plan: 3/5 tasks done`.
  - Dynamic Multi-Model Context Windows: Scales context gauges automatically for 200k (Claude), 1.0M (Gemini Flash), and 2.0M (Gemini Pro) tokens.
  - Zero-Dependency Modular Architecture: Extracted modular core (`src/config.js`, `src/hyperlinks.js`, `src/quota.js`, `src/transcript.js`, `src/render/lines.js`).

## [0.3.2] - 2026-06-28

### Added
- 🔒 Dynamic Tool Permission Management:
  - Added CLI `mode` commands to inspect, cycle (`mode next`), and set (`mode review|auto|yolo|strict`) Antigravity's tool permission confirmation modes.
  - Added CLI `bind-shift-tab` to explain keybinding constraints for external commands.
  - Render dynamic color-coded and layout-dependent permission labels on the HUD: `review` (amber `#FFD166`), `auto mode`/`auto` (orange), `bypass permissions (YOLO)`/`YOLO` (hot pink `#FF3B8A`), and `strict` (icy blue-grey `#8EA2FF`).
  - Added `doctor` diagnostic output for active permission key and mode.
  - Integrated settings backups and robust error recovery to prevent settings corruption on parse failures.

## [0.3.1] - 2026-06-28

### Added
- 🎨 Custom Default Colours:
  - Default colour overrides closer to Claude HUD (`quotaHigh`, `quotaMid`, `quotaLow`, `quotaCritical`, `auto`, `git`)
  - Quotas now transition to purple/blue (`#8EA2FF`) when >50% healthy, and render percentage in the same colour
  - Orange styling unified across the auto mode Line 4 segment
- 📊 Metrics Polish:
  - Cost metrics marked clearly as approximate (`~$0.041` / `~cost`)
  - Relocated model rates into a `MODEL_PRICING` object with stale-warning comments
- 🛠️ Robust Tool Categorisation:
  - Remapped tool triggers (browser, read, search, write, edit, bash, agent, task, ask, image)
  - Map unknown tool calls to `tool` instead of dropping them
- 🏎️ Performance Optimisation:
  - Cache resolved transcript path in `antigravity-hud-state.json` to skip recursive folder scans
  - Bounded transcript reads to the last 256KB of the log file
- 🔗 Terminal Hyperlinks:
  - Added experimental OSC 8 hyperlink support (`AGY_HUD_LINKS=1`) for project directory and transcript path

## [0.3.0] - 2026-06-28

### Added
- ⚙️ Interactive Configuration Wizard:
  - Run `antigravity-hud configure` (or `setup`) to adjust layout presets, toggle features, and save custom preferences
- 📊 Metrics & Performance Toggles:
  - **Preset Layouts:** `full` (4 lines), `essential` (2 lines), or `minimal` (1 line) layouts
  - **Session Cost Tracking:** Live USD calculation based on active model input/output tokens
  - **Generation Speed:** Real-time token streaming rate estimation (`tok/s`)
  - **System Memory:** Dynamic, zero-latency RAM monitoring (`RAM %`)
- 🎨 Custom Colors Support:
  - Customizable ANSI color codes, 8-bit color codes, and 24-bit Truecolor hex codes (#rrggbb) resolved from config file
  - Support for custom separator, model, project, git branch, label, active, and success color overrides

## [0.2.1] - 2026-06-28

### Added
- Added an image preview `img/antigravity-hud.png` to the repository and embedded it in `README.md`
- Added a GitHub license shield badge to the top of `README.md`

## [0.2.0] - 2026-06-28

### Added
- 🎉 Proper one-shot CLI setup flow with subcommands:
  - `antigravity-hud install` - Patches settings.json and creates a timestamped backup of the previous configuration
  - `antigravity-hud doctor` - Diagnostics tool that prints OS, Node version, settings status, and runs a sample payload render test
  - `antigravity-hud uninstall` - Disables the statusLine configuration without destroying other user settings
  - `antigravity-hud --help` / `-h` - Displays subcommand usage instructions
- Support for `AGY_HUD_TRANSCRIPT` env var to point to a specific transcript JSONL file for local tests
- Added `quotaPct` helper so missing or empty quotas default to 100% remaining
- Fixed activeAgents logic so if transcript reports 0 active subagents, it shows 0 agents and does not fall back to invoked counts
- Robust `basenameAny` helper to support Windows and Unix paths on any host OS
- Robust subprocess git calls via `execFileSync` instead of `execSync` to prevent quote/shell issues

## [0.1.0] - 2026-06-28

### Added
- 🎉 Initial release
- Cross-platform Node.js CLI (`bin/antigravity-hud.js`), zero npm dependencies
- Legacy PowerShell prototype preserved in `legacy/`
- 4-line HUD output:
  - **Line 1**: model, repo, git branch + dirty marker, agent state with spinner
  - **Line 2**: context window bar, 5-hour quota bar, weekly quota bar
  - **Line 3**: tool category tallies (read, search, write, edit, bash, agent, task, ask, image)
  - **Line 4**: auto mode, shell count, task count, agent count
- Adaptive layouts: `normal`, `compact`, `tiny`
- Quota colour coding: green, amber, orange, red, ⚠ limit reached
- Transcript JSONL parsing for tool usage stats
- Environment variable overrides:
  - `AGY_HUD_LAYOUT` - force layout mode
  - `AGY_HUD_NO_COLOR` - disable ANSI colours
  - `AGY_HUD_NO_UNICODE` - ASCII-only glyphs
  - `AGY_HUD_NO_SPINNER` - disable spinner animation
  - `AGY_HUD_TOOL_MAX` - cap tool categories shown
  - `AGY_HUD_TRANSCRIPT` - point at a specific transcript file (for testing)
- Install scripts for Windows (`scripts/install.ps1`) and Unix (`scripts/install.sh`)
- Example payloads in `docs/payload-examples/`
