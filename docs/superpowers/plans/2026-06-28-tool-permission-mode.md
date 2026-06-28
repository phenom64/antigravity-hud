# Tool Permission Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable `antigravity-hud` to read the active Antigravity Tool Permission mode from `settings.json`, display it with distinct colors/symbols, and switch it via new CLI subcommands.

**Architecture:** We will implement robust key detection on `settings.json`, write timestamped backups before updating, add CLI routers for mode cycling and manual override, print a helpful explanation for `bind-shift-tab` showing it is not natively supported, and parse the active configuration on HUD render to display dynamic color-coded labels matching the current layout size.

**Tech Stack:** Native Node.js (filesystem, path, os, child_process)

## Global Constraints
- Node version >= 18.0.0
- Zero external NPM dependencies
- Safe settings parsing (try/catch wraps) to avoid crashing the HUD
- Keep ANSI styling clean and support NO_UNICODE flag

---

### Task 1: Key Detection & Settings Helpers

**Files:**
- Modify: `bin/antigravity-hud.js`

**Interfaces:**
- Consumes: `fs`, `path`, `os` modules
- Produces: `readSettings()`, `writeSettings(settings)`, `getExistingPermissionKey(settings)`, `backupSettings()`

- [ ] **Step 1: Define key list and helpers in `bin/antigravity-hud.js`**

Add these helper functions:
```javascript
const LIKELY_KEYS = [
  'toolPermission',
  'tool_permission',
  'toolPermissionMode',
  'tool_permission_mode',
  'permissionMode',
  'permissionsMode',
  'approvalMode',
  'approval_mode'
];

function getExistingPermissionKey(settings) {
  for (const key of LIKELY_KEYS) {
    if (key in settings) return key;
  }
  return null;
}

function readSettings() {
  const settingsFile = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
  if (!fs.existsSync(settingsFile)) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSettings(settings) {
  const settingsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');
  try {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error(`  ${Red}[!] Failed to write settings.json:${R}`, err.message);
    process.exit(1);
  }
}

function backupSettings() {
  const settingsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');
  if (!fs.existsSync(settingsFile)) return;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupName = `settings.json.backup-antigravity-hud-${ts}`;
  const backupPath = path.join(settingsDir, backupName);
  try {
    fs.copyFileSync(settingsFile, backupPath);
    console.log(`  ${Green}[OK] Backed up settings to: ${backupName}${R}`);
  } catch (err) {
    console.error(`  ${Red}[!] Failed to backup settings.json:${R}`, err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Verify helpers by running syntax check**

Run: `node --check bin/antigravity-hud.js`
Expected: Successful check (exit code 0)

- [ ] **Step 3: Commit**

```bash
git add bin/antigravity-hud.js
git commit -m "feat: add settings helper and key detection logic"
```

---

### Task 2: CLI Commands Routing

**Files:**
- Modify: `bin/antigravity-hud.js`

**Interfaces:**
- Consumes: `readSettings()`, `backupSettings()`, `writeSettings()`, `getExistingPermissionKey()`
- Produces: Subcommand handlers for `mode` and `bind-shift-tab`

- [ ] **Step 1: Implement commands parsing**

Insert routing handlers in the subcommand routing section of `bin/antigravity-hud.js` (around line 407):
```javascript
} else if (arg === 'mode') {
  const sub = process.argv[3];
  const settings = readSettings();
  const key = getExistingPermissionKey(settings) || 'toolPermission';
  const val = settings[key] || 'request-review';

  const map = {
    review: 'request-review',
    auto: 'proceed-in-sandbox',
    yolo: 'always-proceed',
    strict: 'strict'
  };

  const getHUDLabel = (modeVal) => {
    if (modeVal === 'request-review') return 'review';
    if (modeVal === 'proceed-in-sandbox') return 'auto mode';
    if (modeVal === 'always-proceed') return 'bypass permissions (YOLO)';
    if (modeVal === 'strict') return 'strict';
    return modeVal;
  };

  if (!sub) {
    console.log(`\n  ${B}${Cyan}antigravity-hud mode${R}`);
    console.log(`  ${Gray}====================${R}\n`);
    console.log(`  ${White}Active Key:${R} ${key}`);
    console.log(`  ${White}Raw Value:${R} ${val}`);
    console.log(`  ${White}HUD Label:${R} ${getHUDLabel(val)}`);
    process.exit(0);
  } else if (sub === 'next') {
    const cycle = ['request-review', 'proceed-in-sandbox', 'always-proceed', 'strict'];
    const curIdx = cycle.indexOf(val);
    const nextVal = cycle[(curIdx + 1) % cycle.length];
    
    backupSettings();
    settings[key] = nextVal;
    writeSettings(settings);
    console.log(`  ${Green}[OK] Cycled permission mode from '${val}' to '${nextVal}'.${R}`);
    process.exit(0);
  } else if (['review', 'auto', 'yolo', 'strict'].includes(sub)) {
    const targetVal = map[sub];
    if (val === targetVal) {
      console.log(`  [OK] Permission mode is already set to '${targetVal}'.`);
      process.exit(0);
    }
    backupSettings();
    settings[key] = targetVal;
    writeSettings(settings);
    console.log(`  ${Green}[OK] Changed permission mode from '${val}' to '${targetVal}'.${R}`);
    process.exit(0);
  } else {
    console.error(`  ${Red}[!] Unknown mode command: ${sub}${R}`);
    console.log(`  Valid mode commands:`);
    console.log(`    antigravity-hud mode`);
    console.log(`    antigravity-hud mode next`);
    console.log(`    antigravity-hud mode review`);
    console.log(`    antigravity-hud mode auto`);
    console.log(`    antigravity-hud mode yolo`);
    console.log(`    antigravity-hud mode strict`);
    process.exit(1);
  }
} else if (arg === 'bind-shift-tab') {
  console.log(`\n  ${Yellow}[!] Shift+Tab is not supported by Antigravity yet.${R}`);
  console.log(`  Antigravity's keybindings only support mapping key combinations to internal TUI commands.`);
  console.log(`  They cannot trigger external shell commands or slash commands.`);
  console.log(`  Please cycle your permission modes using:`);
  console.log(`    ${Cyan}antigravity-hud mode next${R}\n`);
  process.exit(0);
}
```

Add these subcommands to `runHelp` list of commands:
```javascript
  console.log(`    ${White}antigravity-hud mode${R}        Show current Antigravity tool permission mode`);
  console.log(`    ${White}antigravity-hud mode next${R}   Cycle permission modes`);
  console.log(`    ${White}antigravity-hud mode <mode>${R}  Set mode to review, auto, yolo, or strict`);
  console.log(`    ${White}antigravity-hud bind-shift-tab${R} Bind Shift+Tab keyboard shortcut`);
```

- [ ] **Step 2: Verify syntax**

Run: `node --check bin/antigravity-hud.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add bin/antigravity-hud.js
git commit -m "feat: add CLI routing for mode and bind-shift-tab commands"
```

---

### Task 3: HUD Visuals & Colors Integration

**Files:**
- Modify: `bin/antigravity-hud.js`

**Interfaces:**
- Consumes: `readSettings()`, `getExistingPermissionKey()`, `NO_UNICODE`
- Produces: Dynamic status rendering in `runHud()`

- [ ] **Step 1: Define extra symbols at the top of `bin/antigravity-hud.js`**

Find existing symbol lines (around line 40-50):
```javascript
let SEP = '\u2502', DOT = '\u25CF', UP = '\u2191', DOWN = '\u2193';
let FAST = '\u23E9', WARN = '\u26A0', CHECK = '\u2714', TIMES = '\u00D7';
let FULL = '\u2588', EMPTY = '\u2591';
let SPINNER_FRAMES = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F'];
```

Update to define `PAUSE` and `LOCK`:
```javascript
let SEP = '\u2502', DOT = '\u25CF', UP = '\u2191', DOWN = '\u2193';
let FAST = '\u23E9', WARN = '\u26A0', CHECK = '\u2714', TIMES = '\u00D7';
let FULL = '\u2588', EMPTY = '\u2591';
let PAUSE = '\u23F8', LOCK = '\uD83D\uDD12';
let SPINNER_FRAMES = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F'];

if (NO_UNICODE) {
  SEP = '|'; DOT = '*'; UP = '^'; DOWN = 'v';
  FAST = '>>'; WARN = '!'; CHECK = '+'; TIMES = 'x';
  FULL = '#'; EMPTY = '.';
  PAUSE = '||'; LOCK = '[lock]';
  SPINNER_FRAMES = ['|','/','-','\\'];
}
```

- [ ] **Step 2: Add color keys to resolved color variables**

Find resolved color definitions (around line 145-156) and append new dynamic mode colors resolved from config:
```javascript
const colorPermReview = resolveColor(config.colors.permissionReview, '#FFD166');
const colorPermAuto   = resolveColor(config.colors.permissionAuto,   `${Orange}`);
const colorPermBypass = resolveColor(config.colors.permissionBypass, '#FF3B8A');
const colorPermStrict = resolveColor(config.colors.permissionStrict, '#8EA2FF');
```

- [ ] **Step 3: Modify line 4 rendering logic in `runHud(raw)`**

Find current rendering of `line4` in `runHud`:
```javascript
  const mode = j.auto_mode || j.planning_mode || j.automation_mode
    || j.approval_mode || j.mode || '--';
  // ...
  let line4 = `${colorAuto}${FAST} auto mode ${mode}${R}`
    + ` ${colorSuccess}${DOT}${R} ${White}${shellText}${R}`;
```

Replace it with dynamic configuration read and mapping:
```javascript
  const permMode = (() => {
    const settings = readSettings();
    const key = getExistingPermissionKey(settings) || 'toolPermission';
    return settings[key] || 'request-review';
  })();

  let permColor = colorPermReview;
  let permIcon = PAUSE;
  let permText = 'review';

  if (permMode === 'request-review') {
    permColor = colorPermReview;
    permIcon = PAUSE;
    permText = (layout === 'tiny') ? 'review' : 'review';
  } else if (permMode === 'proceed-in-sandbox') {
    permColor = colorPermAuto;
    permIcon = FAST;
    permText = (layout === 'tiny') ? 'auto' : (layout === 'compact') ? 'auto' : 'auto mode';
  } else if (permMode === 'always-proceed') {
    permColor = colorPermBypass;
    permIcon = FAST;
    permText = (layout === 'tiny') ? 'auto' : (layout === 'compact') ? 'YOLO' : 'bypass permissions (YOLO)';
  } else if (permMode === 'strict') {
    permColor = colorPermStrict;
    permIcon = LOCK;
    permText = (layout === 'tiny') ? 'strict' : 'strict';
  }

  // Determine prefix: in tiny layout, we don't display icons or leading spaces
  const permSection = (layout === 'tiny') 
    ? `${permColor}${permText}${R}`
    : `${permColor}${permIcon} ${permText}${R}`;

  let line4 = `${permSection}`
    + ` ${colorSuccess}${DOT}${R} ${White}${shellText}${R}`;
```

- [ ] **Step 4: Verify syntax**

Run: `node --check bin/antigravity-hud.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add bin/antigravity-hud.js
git commit -m "feat: integrate dynamic colors, layouts, and icons for permission mode in HUD"
```

---

### Task 4: Diagnostic ("doctor") Update & Manual Testing

**Files:**
- Modify: `bin/antigravity-hud.js`

**Interfaces:**
- Consumes: `readSettings()`, `getExistingPermissionKey()`
- Produces: Diagnostics output print in `runDoctor()`

- [ ] **Step 1: Modify `runDoctor()` in `bin/antigravity-hud.js`**

Find the `runDoctor()` function and find where settings are parsed:
```javascript
  let settings = {};
  try {
    if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch (_) {}
```

Append information about tool permissions:
```javascript
  const permKey = getExistingPermissionKey(settings) || 'toolPermission';
  const permVal = settings[permKey] || 'request-review';
  console.log(`  ${White}Tool Permission Key:${R} ${permKey}`);
  console.log(`  ${White}Tool Permission Mode:${R} ${permVal}`);
```

- [ ] **Step 2: Run diagnostics test**

Run: `node bin/antigravity-hud.js doctor`
Expected: Displays "Tool Permission Key: toolPermission" and "Tool Permission Mode: always-proceed" (current value)

- [ ] **Step 3: Test permission switcher commands**

Run: `node bin/antigravity-hud.js mode`
Expected: Output showing key, value, and label.

Run: `node bin/antigravity-hud.js mode next`
Expected: Backup message + cycles from `always-proceed` to `strict`.

Run: `node bin/antigravity-hud.js mode`
Expected: Displays raw value: `strict`.

Run: `node bin/antigravity-hud.js mode auto`
Expected: Changes mode to `proceed-in-sandbox`.

Run: `node bin/antigravity-hud.js mode next`
Expected: Cycles from `proceed-in-sandbox` to `always-proceed`.

Run: `node bin/antigravity-hud.js bind-shift-tab`
Expected: Message saying Shift+Tab not supported, recommending cycle command.

- [ ] **Step 4: Run dry-run build check**

Run: `npm pack --dry-run`
Expected: PASS (No errors, packaging completes successfully)

- [ ] **Step 5: Commit**

```bash
git add bin/antigravity-hud.js
git commit -m "feat: add tool permission info to doctor diagnostics"
```

---

### Task 5: Documentation & Readme Update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document `mode` and `bind-shift-tab` in `README.md`**

Add documentation to `README.md` under the commands section, specifying:
- `antigravity-hud mode`
- `antigravity-hud mode next`
- `antigravity-hud mode <review|auto|yolo|strict>`
- Explain that Shift+Tab cannot be natively bound to command execution and recommend `mode next`.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document new mode switching subcommands and keybinding constraint"
```
