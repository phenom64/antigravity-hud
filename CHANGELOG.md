# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
