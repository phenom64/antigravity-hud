# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
