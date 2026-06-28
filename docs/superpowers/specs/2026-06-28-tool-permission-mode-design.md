# Design Spec: Antigravity Tool Permission Mode Reader and Switcher

## Goal
Enable `antigravity-hud` to read the active Antigravity Tool Permission mode from `~/.gemini/antigravity-cli/settings.json`, display it with distinct colors/symbols on the HUD, and switch it via new CLI subcommands.

## Key Detection & Settings Logic
1. **Settings Path**: Resolved cross-platform using Node's `os.homedir()`:
   `~/.gemini/antigravity-cli/settings.json`
2. **Key Search Order**:
   - `toolPermission`
   - `tool_permission`
   - `toolPermissionMode`
   - `tool_permission_mode`
   - `permissionMode`
   - `permissionsMode`
   - `approvalMode`
   - `approval_mode`
3. **Backup Mechanism**:
   - Before writing any changes to `settings.json`, create a timestamped backup:
     `settings.json.backup-antigravity-hud-YYYYMMDD-HHMMSS`
4. **Default Setting**:
   - If no key is found in `settings.json` during write operations, default to writing the `toolPermission` key.
   - If reading fails or the file is missing/malformed, default to `request-review`.

## CLI Subcommands
- `antigravity-hud mode`
  Prints current raw permission mode value and its HUD label mapping.
- `antigravity-hud mode next`
  Cycles through the modes:
  `request-review` -> `proceed-in-sandbox` -> `always-proceed` -> `strict` -> `request-review`
- `antigravity-hud mode review`
  Sets key to `request-review`.
- `antigravity-hud mode auto`
  Sets key to `proceed-in-sandbox`.
- `antigravity-hud mode yolo`
  Sets key to `always-proceed`.
- `antigravity-hud mode strict`
  Sets key to `strict`.
- `antigravity-hud bind-shift-tab`
  Document that custom keybindings cannot trigger external commands, and recommend `antigravity-hud mode next`.

## HUD Visuals (Line 4)
We will dynamically query the current permission mode and display:

- **`request-review`**:
  - Symbol: `⏸` (Pause symbol `\u23F8`, ASCII: `||`)
  - Label: `review`
  - Color: Orange (`colorAuto`)
- **`proceed-in-sandbox`**:
  - Symbol: `⏩` (Fast forward symbol `\u23E9`, ASCII: `>>`)
  - Label: `auto mode`
  - Color: Amber (`colorQuotaMid` / Yellow)
- **`always-proceed`**:
  - Symbol: `⏩` (Fast forward symbol `\u23E9`, ASCII: `>>`)
  - Label: `bypass permissions (YOLO)`
  - Color: Cyan (`colorActive`)
- **`strict`**:
  - Symbol: `🔒` (Lock symbol `\uD83D\uDD12`, ASCII: `L`)
  - Label: `strict`
  - Color: Red (`colorQuotaCritical` / Red)
