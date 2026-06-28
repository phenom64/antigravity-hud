# Design Spec: Antigravity Tool Permission Mode Reader and Switcher

## Goal
Enable `antigravity-hud` to read the active Antigravity Tool Permission mode from `~/.gemini/antigravity-cli/settings.json`, display it with distinct layout-dependent formats and colors on the HUD, and switch it via new CLI subcommands.

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
  Prints current raw permission mode value and its HUD label representation.
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
  Document that Shift+Tab is not supported by Antigravity yet because Antigravity keybindings cannot run external commands, and recommend `antigravity-hud mode next`.

## HUD Visuals (Line 4)
We will dynamically query the current permission mode and apply the following layout and color mappings.

### Layout Mappings
- **Normal/Full layout mapping**:
  - `request-review` -> `[symbol] review` (e.g. `⏸ review`)
  - `proceed-in-sandbox` -> `[symbol] auto mode` (e.g. `⏩ auto mode`)
  - `always-proceed` -> `[symbol] bypass permissions (YOLO)` (e.g. `⏩ bypass permissions (YOLO)`)
  - `strict` -> `[symbol] strict` (e.g. `🔒 strict`)
- **Compact layout mapping**:
  - `request-review` -> `[symbol] review` (e.g. `⏸ review`)
  - `proceed-in-sandbox` -> `[symbol] auto` (e.g. `⏩ auto`)
  - `always-proceed` -> `[symbol] YOLO` (e.g. `⏩ YOLO`)
  - `strict` -> `[symbol] strict` (e.g. `🔒 strict`)
- **Tiny layout mapping (No symbols)**:
  - `request-review` -> `review`
  - `proceed-in-sandbox` -> `auto`
  - `always-proceed` -> `YOLO`
  - `strict` -> `strict`

### Unicode / NO_UNICODE Symbols
- **Unicode Enabled**:
  - Pause symbol: `\u23F8`
  - Fast forward symbol: `\u23E9` (already defined as `FAST`)
  - Lock symbol: `\uD83D\uDD12`
- **NO_UNICODE=1 Fallbacks**:
  - `request-review` -> `|| review`
  - `proceed-in-sandbox` -> `>> auto mode` (normal) or `>> auto` (compact)
  - `always-proceed` -> `>> bypass permissions (YOLO)` (normal) or `>> YOLO` (compact)
  - `strict` -> `[lock] strict`

### Colors & Config Keys
We will add support for the following colors in `config.colors` (resolving hex colors dynamic-ready):
- `permissionReview`: default `#FFD166` (amber/soft yellow)
- `permissionAuto`: default `#FF8700` (current orange)
- `permissionBypass`: default `#FF3B8A` (hot pink/danger mode)
- `permissionStrict`: default `#8EA2FF` (icy blue-grey)
