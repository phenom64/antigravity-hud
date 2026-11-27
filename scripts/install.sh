#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────
# antigravity-hud installer (macOS / Linux)
#
# 1. Checks that antigravity-hud is on PATH (via npm install -g antigravity-hud)
# 2. Patches ~/.gemini/antigravity-cli/settings.json to use the HUD
#    (preserving statusLine.padding and statusLine.stack_with_default)
# 3. Pass --with-title to also configure dynamic terminal window titles
# 4. Backs up existing settings before patching
# ────────────────────────────────────────────────────────────────────────

set -euo pipefail

WITH_TITLE=0
for arg in "$@"; do
  if [ "$arg" = "--with-title" ]; then
    WITH_TITLE=1
  fi
done

SETTINGS_DIR="$HOME/.gemini/antigravity-cli"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"

echo ""
echo "  antigravity-hud installer"
echo "  ========================="
echo ""

# ── Check that antigravity-hud is on PATH ──────────────────────────────
if ! command -v antigravity-hud &>/dev/null; then
  echo "  [!] antigravity-hud not found on PATH."
  echo "      Run: npm install -g antigravity-hud"
  echo ""
  exit 1
fi
echo "  [OK] Found antigravity-hud at: $(command -v antigravity-hud)"

# ── Ensure settings directory exists ────────────────────────────────────
mkdir -p "$SETTINGS_DIR"

# ── Backup existing settings ────────────────────────────────────────────
if [ -f "$SETTINGS_FILE" ]; then
  BACKUP="$SETTINGS_DIR/settings.json.backup-antigravity-hud-$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS_FILE" "$BACKUP"
  echo "  [OK] Backed up settings to: $(basename "$BACKUP")"
fi

# ── Patch settings.json ─────────────────────────────────────────────────
patch_with_jq() {
  local jq_expr='.statusLine = ((if (.statusLine | type) == "object" then .statusLine else {} end) + {"type":"command","command":"antigravity-hud","enabled":true})'
  if [ "$WITH_TITLE" -eq 1 ]; then
    jq_expr="$jq_expr | .title = {\"type\":\"command\",\"command\":\"antigravity-hud title\",\"enabled\":true}"
  fi
  if [ -f "$SETTINGS_FILE" ]; then
    jq "$jq_expr" "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
  else
    echo '{}' | jq "$jq_expr" > "$SETTINGS_FILE"
  fi
}

patch_with_python() {
  python3 - "$SETTINGS_FILE" "$WITH_TITLE" <<'PY'
import json, os, sys
path = sys.argv[1]
with_title = sys.argv[2] == '1'
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
else:
    data = {}
prev = data.get('statusLine')
sl = prev if isinstance(prev, dict) else {}
sl.update({'type': 'command', 'command': 'antigravity-hud', 'enabled': True})
data['statusLine'] = sl
if with_title:
    data['title'] = {'type': 'command', 'command': 'antigravity-hud title', 'enabled': True}
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
PY
}

patch_fallback() {
  if [ -f "$SETTINGS_FILE" ]; then
    echo "  [!] Neither jq nor python3 found."
    echo "      Run 'antigravity-hud install' instead, or add this to settings.json manually:"
    echo ""
    echo '    "statusLine": {'
    echo '      "type": "command",'
    echo '      "command": "antigravity-hud",'
    echo '      "enabled": true'
    echo '    }'
    echo ""
    exit 1
  else
    echo '{"statusLine":{"type":"command","command":"antigravity-hud","enabled":true}}' > "$SETTINGS_FILE"
  fi
}

if command -v jq &>/dev/null; then
  patch_with_jq
elif command -v python3 &>/dev/null; then
  patch_with_python
else
  patch_fallback
fi

echo "  [OK] Patched statusLine in settings.json"
if [ "$WITH_TITLE" -eq 1 ]; then
  echo "  [OK] Patched title in settings.json"
fi
echo ""
echo "  Done! Restart your Antigravity CLI session (or run /statusline enable) to see the HUD."
echo ""
