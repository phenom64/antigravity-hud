---
name: antigravity-hud
description: Configure, customize, troubleshoot, and preview antigravity-hud statusline and window title settings in natural language inside Antigravity CLI (like claude-hud's /hud command). Use when the user asks to change HUD layout, presets, colors, context display mode, path depth, or toggle HUD elements.
---

# Antigravity HUD Configuration Skill (`/hud`)

Use this skill when the user wants to customize or troubleshoot `antigravity-hud` in plain English (for example: *"switch to essential preset"*, *"show remaining context instead of used"*, *"show 2 path levels"*, *"add a separator line"*, *"hide cost"*, or *"why isn't my statusline showing?"*).

## Available Commands

Prefer the built-in CLI commands over editing JSON by hand so configuration stays valid and atomic:

- **View current config**:
  ```bash
  antigravity-hud config get
  ```
- **Set a config option**:
  ```bash
  antigravity-hud config set <key> <value>
  ```
- **Reset config to defaults**:
  ```bash
  antigravity-hud config reset
  ```
- **Preview live HUD & window title output / check health**:
  ```bash
  antigravity-hud doctor
  ```

## Supported Config Keys

| Key | Values | Description |
| --- | --- | --- |
| `preset` | `full`, `essential`, `minimal` | 4-line full HUD, 2-line essential, or 1-line minimal |
| `layoutStyle` | `default`, `separators` | Add a horizontal divider between telemetry and activity lines |
| `contextValue` | `both`, `percent`, `remaining`, `tokens` | How context usage is formatted (`9% (88k↑/6k↓/1m)`, `9%`, `91% left`, `88k/1.0m`) |
| `pathLevels` | `1`, `2`, `3` | Trailing path segments shown for the project directory |
| `showCost` | `true`, `false` | Show USD session cost (native or estimated) |
| `showSpeed` | `true`, `false` | Show token generation speed (`tok/s`) |
| `showCacheHit` | `true`, `false` | Show prompt cache hit ratio (`⚡N%`) |
| `showQuotaPace` | `true`, `false` | Show quota burn pace delta (`⇡N%` / `⇣N%`) |
| `showActiveTool` | `true`, `false` | Show live in-flight tool + target filename/command on Line 3 |
| `showConfigCounts` | `true`, `false` | Show loaded `GEMINI.md`/rules/hooks counts on Line 4 |
| `showSkills` | `true`, `false` | Show loaded skills count on Line 4 |
| `showMcp` | `true`, `false` | Show MCP server count on Line 4 |
| `showSubagents` | `true`, `false` | Show active subagent role & elapsed time |
| `showTodos` | `true`, `false` | Show live `update_steps` / markdown checklist progress |
| `showArtifacts` | `true`, `false` | Show artifact count with brain directory link |
| `showConversationId` | `true`, `false` | Show short `#<id>` and conversation title on Line 1 |
| `enableLinks` | `true`, `false` | Enable OSC 8 clickable terminal hyperlinks |
| `colorMode` | `true`, `false` | Enable ANSI colors |
| `unicodeMode` | `true`, `false` | Use Unicode glyphs (false = pure ASCII) |

## Workflow

1. Translate the user's natural-language request into one or more `antigravity-hud config set <key> <value>` commands.
2. Run `antigravity-hud doctor` to verify the updated settings and show the rendered preview.
3. Report the exact changes made in 1–2 concise lines.
