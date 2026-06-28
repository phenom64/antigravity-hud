# 🚀 antigravity-hud

> A 4-line statusline HUD for the [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli). Because flying blind through your quota is no way to code.

```
Claude Opus 4.6 (Thinking) │ my-app git:(main*) │ ⠹ tool_use
ctx ████████░░░░ 21% (48.2k ↑ / 3.9k ↓ / 250.0k) │ 5h ███████░░░░░ 72% 3h0m │ wk ███████████░ 91% 6d12h
✔ read ×3 │ ✔ search ×1 │ ✔ edit ×2 │ ✔ bash ×2 │
⏩ auto mode auto │ ● 2 shell │ ● 0 agents
```

## The backstory

Whilst building SynCloudOS I burned through my entire [Claude Code](https://claude.ai) and [ChatGPT Codex](https://chat.openai.com) weekly usage limits in about 48 hours. Classic. Then I rediscovered **Google Antigravity**, Google's agentic coding CLI that ships with Gemini models *and* lets you use third-party models like Claude Opus/Sonnet 4.6 through the same interface. More importantly I realised I have been paying for this and really should use it at least once.

The problem? Antigravity's built-in statusline is... minimal. I wanted something that showed me *everything* at a glance: which model I'm burning tokens on, how much quota I have left, what tools the agent is using, and whether I should maybe switch to Gemini 3.5 Flash for that docs task instead of torching premium Claude tokens.
I also wanted a *gamified* interface, one that is addictive, almost slot (slop?) machine like and encourages me to waste my 20s vibe coding, à la Claude.

So I built this. First as a [chaotic PowerShell script](legacy/statusline-syn.ps1), then as a proper cross-platform Node.js CLI.

### When to use what

| Model | Good for |
|---|---|
| **Gemini 3.5 Flash** | Docs, summaries, lighter refactors, brainstorming |
| **Claude Opus 4.6** | Complex bug fixes, architecture, multi-file refactors |
| **Claude Sonnet 4.6** | Feature tests, codebase exploration, code review |

The HUD helps you keep an eye on quota so you can switch models before you hit the wall. 🧱

## Features

- **📊 Quota health bars** - 5-hour and weekly quota with colour-coded bars (green, amber, orange, red, ⚠ limit reached)
- **🔄 Live spinner** - braille-dot animation when the agent is thinking/working/tooling
- **🧰 Tool tallies** - see what the agent has been doing: `✔ read ×5 │ ✔ edit ×2 │ ✔ bash ×3`
- **📐 Adaptive layouts** - automatically adjusts for wide, medium, and narrow terminals
- **🪟 Cross-platform** - Windows, macOS, Linux. One `npm install` and you're done.
- **🎨 Addictive, eyecandy Terminal output** - bold, colour, Unicode glyphs. Degrades gracefully with `AGY_HUD_NO_COLOR` and `AGY_HUD_NO_UNICODE`.
- **📜 Transcript parsing** - reads Antigravity's JSONL transcripts to count tool usage per category
- **🔌 Zero dependencies** - pure Node.js built-ins, no npm packages needed at runtime

## Installation

### Quick start

```bash
npm install -g antigravity-hud
```

Then run the install script to patch your Antigravity CLI settings:

**Windows (PowerShell):**
```powershell
& "$(npm root -g)/antigravity-hud/scripts/install.ps1"
```

**macOS / Linux:**
```bash
bash "$(npm root -g)/antigravity-hud/scripts/install.sh"
```

### Manual setup

If you prefer to configure manually, edit `~/.gemini/antigravity-cli/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "antigravity-hud",
    "enabled": true
  }
}
```

Then restart your Antigravity CLI session. The HUD will appear automatically.

## How it works

Antigravity pipes a JSON payload to your statusline command via stdin on every render tick. The payload includes:

- Current model info
- Workspace and project paths
- Context window usage (tokens in/out, window size, percentage used)
- Quota remaining (5-hour and weekly, for both Gemini and third-party models)
- Agent state (idle, thinking, tool_use, etc.)
- Terminal width

The HUD reads this JSON, optionally parses the conversation transcript for tool usage stats, and renders a 4-line ANSI display to stdout.

See [`docs/payload-examples/`](docs/payload-examples/) for example payloads.

## Layout modes

The HUD adapts to your terminal width:

| Layout | Terminal width | Bar length | Tool categories |
|--------|---------------|------------|-----------------|
| `normal` | >= 118 cols | 10-16 blocks | up to 6 |
| `compact` | 92-117 cols | 8 blocks | up to 5 |
| `tiny` | < 92 cols | no bars (% only) | up to 4 |

Override with:
```bash
export AGY_HUD_LAYOUT=compact
```

## Environment variables

| Variable | Values | Description |
|---|---|---|
| `AGY_HUD_LAYOUT` | `normal`, `compact`, `tiny` | Force a specific layout mode |
| `AGY_HUD_NO_COLOR` | `1` | Disable all ANSI colour codes |
| `AGY_HUD_NO_UNICODE` | `1` | Replace Unicode glyphs with ASCII equivalents |
| `AGY_HUD_NO_SPINNER` | `1` | Disable spinner animation (always show ●) |
| `AGY_HUD_TOOL_MAX` | `1`-`10` | Max number of tool categories to display |
| `AGY_HUD_TRANSCRIPT` | path | Point at a specific transcript JSONL (useful for testing) |

## Output lines explained

```
Line 1:  Model │ repo git:(branch*) │ ● state
Line 2:  ctx [████░░░░] 21% (48k ↑ / 4k ↓ / 250k) │ 5h [████░░] 72% 3h │ wk [█████░] 91% 6d
Line 3:  ✔ read ×5 │ ✔ search ×1 │ ✔ edit ×2 │ ✔ bash ×3 │
Line 4:  ⏩ auto mode auto │ ● 3 shell │ ● 1 tasks │ ● 0 agents
```

| Element | Source |
|---|---|
| Model name | `model.display_name` from stdin JSON |
| Repo | basename of `workspace.project_dir` |
| Branch + dirty | `git branch --show-current` + `git status --porcelain` |
| State + spinner | `agent_state`, spinner animates during active states |
| Context bar | `context_window.used_percentage` with token counts |
| 5h / wk quota | `quota.3p-5h` or `quota.gemini-5h` depending on model |
| Tool tallies | Parsed from conversation transcript JSONL |
| Shell / tasks / agents | Counted from `run_command`, `manage_task`/`schedule`, subagent calls |

### Quota colour thresholds

| Remaining | Colour |
|---|---|
| 50-100% | 🟢 Green |
| 25-49% | 🟡 Amber |
| 15-24% | 🟠 Orange |
| 1-14% | 🔴 Red |
| 0% | ⚠ Limit reached |

## Project structure

```
antigravity-hud/
├── bin/
│   └── antigravity-hud.js    # Cross-platform Node CLI (the main thing)
├── legacy/
│   └── statusline-syn.ps1    # Original PowerShell prototype
├── scripts/
│   ├── install.ps1            # Windows installer
│   └── install.sh             # macOS/Linux installer
├── docs/
│   └── payload-examples/
│       ├── statusline-last.example.json
│       └── transcript.example.jsonl
├── package.json
├── LICENSE                    # MIT
├── CHANGELOG.md
└── README.md                 # You are here
```

## Development

```bash
# Test with a sample payload
cat docs/payload-examples/statusline-last.example.json | node bin/antigravity-hud.js

# Test with the example transcript (skips live transcript search)
cat docs/payload-examples/statusline-last.example.json | AGY_HUD_TRANSCRIPT=docs/payload-examples/transcript.example.jsonl node bin/antigravity-hud.js

# Test with no colour
cat docs/payload-examples/statusline-last.example.json | AGY_HUD_NO_COLOR=1 node bin/antigravity-hud.js

# Test tiny layout
cat docs/payload-examples/statusline-last.example.json | AGY_HUD_LAYOUT=tiny node bin/antigravity-hud.js
```

On Windows PowerShell:
```powershell
# Basic test
Get-Content docs\payload-examples\statusline-last.example.json -Raw | node bin\antigravity-hud.js

# With example transcript
$env:AGY_HUD_TRANSCRIPT="docs\payload-examples\transcript.example.jsonl"
Get-Content docs\payload-examples\statusline-last.example.json -Raw | node bin\antigravity-hud.js
$env:AGY_HUD_TRANSCRIPT=$null
```

## License

[MIT](LICENSE). Go wild.

## Credits
Designed by Kavish Krishnakumar in Manchester - this project is not a part of Syndromatic Limited, it's personal.

Built with ☕, vibes, and mild quota anxiety. Inspired by [Claude HUD](https://github.com/jarrodwatts/claude-hud)'s statusline, but for the Antigravity CLI ecosystem.

If you're reading this, you probably also care about your token budget. Welcome to the club.
