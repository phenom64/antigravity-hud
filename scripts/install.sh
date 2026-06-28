#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────
# antigravity-hud installer (macOS / Linux)
#
# 1. Checks that antigravity-hud is on PATH (via npm install -g)
# 2. Patches ~/.gemini/antigravity-cli/settings.json to use the HUD
# 3. Backs up existing settings before patching
# ────────────────────────────────────────────────────────────────────────

set -euo pipefail

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
  BACKUP="$SETTINGS_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS_FILE" "$BACKUP"
  echo "  [OK] Backed up settings to: $(basename "$BACKUP")"
fi

# ── Patch settings.json ─────────────────────────────────────────────────
# We use a simple approach: if jq is available, use it. Otherwise, python3.
# Fallback: write a minimal settings file.

patch_with_jq() {
  if [ -f "$SETTINGS_FILE" ]; then
    jq '.statusLine = {"type":"command","command":"antigravity-hud","enabled":true}' \
      "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
  else
    echo '{"statusLine":{"type":"command","command":"antigravity-hud","enabled":true}}' > "$SETTINGS_FILE"
  fi
}

patch_with_python() {
  python3 -c "
import json, os, sys
path = '$SETTINGS_FILE'
if os.path.exists(path):
    with open(path) as f:
        data = json.load(f)
else:
    data = {}
data['statusLine'] = {'type': 'command', 'command': 'antigravity-hud', 'enabled': True}
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
"
}

patch_fallback() {
  if [ -f "$SETTINGS_FILE" ]; then
    # Crude but functional: just warn the user
    echo "  [!] Neither jq nor python3 found."
    echo "      Add this to your settings.json manually:"
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
echo ""
echo "  Done! Restart your Antigravity CLI session to see the HUD."
echo ""
