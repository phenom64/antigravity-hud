# Plan 005: Fix config wizard key preservation, cap settings backups, and sync docs/installers with v0.5.0+

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C "C:/Users/Kavish Krishnakumar/Developer/antigravity-hud" diff --stat 00c6adc..HEAD -- README.md scripts/install.ps1 scripts/install.sh`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/004-unify-src-and-bin-architecture.md
- **Category**: docs
- **Planned at**: commit `00c6adc`, 2026-11-22

## Why this matters

Three developer-experience and documentation regressions accumulated across v0.3.2–v0.5.0:
1. Running `antigravity-hud configure` overwrites `antigravity-hud-config.json` with a hard-coded 6-key object, wiping `enableLinks` and other settings from `DEFAULT_CONFIG` (`src/config.js`), and doesn't allow configuring `enableLinks`.
2. Running `antigravity-hud mode next` creates a new `settings.json.backup-antigravity-hud-YYYYMMDD-HHMMSS` file on every keystroke with no rotation cap, cluttering `~/.gemini/antigravity-cli/`.
3. `README.md`, `scripts/install.ps1`, and `scripts/install.sh` still reference removed RAM metrics (`showMemory`, `RAM 54%`), omit Gemini 4 Argon (`argon-wk`) quota documentation, use the un-scoped package name `antigravity-hud` instead of `@phenom64/antigravity-hud` in the legacy scripts, and omit `src/` and `tests/` from the README project structure tree.

## Current state

Relevant files:
- `bin/antigravity-hud.js` — `backupSettings()` (lines 101–110) and `runConfigure()` (lines 768–828).
- `README.md` — Configuration schema (lines 82–97), environment variables (lines 199–210), output lines explained (lines 213–231), project structure (lines 244–261).
- `scripts/install.ps1` — line 30 (`npm install -g antigravity-hud`) and line 44 (`.bak.`).
- `scripts/install.sh` — line 23 (`npm install -g antigravity-hud`) and line 34 (`.bak.`).

Current excerpt from `bin/antigravity-hud.js:101-110`:
```js
function backupSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupName = `settings.json.backup-antigravity-hud-${ts}`;
  const backupPath = path.join(SETTINGS_DIR, backupName);
  fs.copyFileSync(SETTINGS_FILE, backupPath);
  console.log(`  ${Green}[OK] Backed up settings to: ${backupName}${R}`);
}
```

Current excerpt from `bin/antigravity-hud.js:812-820`:
```js
  const newConfig = {
    preset,
    showCost,
    showSpeed,
    colorMode,
    unicodeMode,
    colors: current.colors || {}
  };
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run all tests | `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` | all 4 print `✔ ... passed` (exit 0) |

## Scope

**In scope**:
- `bin/antigravity-hud.js`
- `src/config.js`
- `README.md`
- `scripts/install.ps1`
- `scripts/install.sh`
- `tests/test-hyperlinks.js`

**Out of scope**:
- `legacy/statusline-syn.ps1`

## Git workflow

- Branch: `advisor/005-docs-wizard-and-backup-rotation`
- Commit message style: Conventional Commits (e.g. `docs: update README and installers for v0.5.0+ and cap settings backups`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Preserve config keys in `runConfigure()` and add backup pruning in `backupSettings()`

In `bin/antigravity-hud.js`:
1. In `backupSettings(maxBackups = 5)`:
   - After copying `SETTINGS_FILE` to `backupPath`, list `settings.json.backup-antigravity-hud-*` files in `SETTINGS_DIR`, sort ascending, and if there are more than `maxBackups` (5), delete the oldest excess backup files with `fs.unlinkSync`.
2. In `runConfigure()`:
   - Add prompt 6 for OSC 8 terminal hyperlinks:
     `const curLinks = current.enableLinks !== false ? 'y' : 'n';`
     `const linksAns = await askQuestion(\`  Enable clickable OSC 8 terminal hyperlinks? (y/n) [current: \${curLinks}]: \`);`
     `const enableLinks = linksAns ? (linksAns.toLowerCase() === 'y') : (current.enableLinks !== false);`
   - Construct `newConfig` by merging `Object.assign({}, DEFAULT_CONFIG, current, { preset, showCost, showSpeed, enableLinks, colorMode, unicodeMode, colors: current.colors || {} })` and `delete newConfig.showMemory;` so legacy `showMemory` is cleaned up while all valid `DEFAULT_CONFIG` keys are preserved.

**Verify**: `node bin/antigravity-hud.js --help` → exits 0

### Step 2: Update `README.md`, `scripts/install.ps1`, and `scripts/install.sh`

1. In `README.md`:
   - Remove `"showMemory": true` and references to RAM usage (`RAM 54%`, `or RAM usage`) from the Configuration and Output sections; add `"enableLinks": true` to the example config JSON.
   - Document Gemini 4 Argon (`Gemini 4 Argon`, `argon-wk` weekly quota bar on Google AI Pro) in the "When to use what" and "Output lines explained" tables.
   - Update `AGY_HUD_LINKS` in the Environment Variables table to state `0` or `1` ("Override clickable OSC 8 terminal hyperlinks (enabled by default; set to `0` to disable)").
   - Update the "Project structure" tree to include `src/` (`config.js`, `git.js`, `hyperlinks.js`, `quota.js`, `transcript.js`, `render/lines.js`) and `tests/` (`test-hyperlinks.js`, `test-integration.js`, `test-parser.js`, `test-render.js`).
2. In `scripts/install.ps1` and `scripts/install.sh`:
   - Change `npm install -g antigravity-hud` to `npm install -g @phenom64/antigravity-hud`.
   - Change backup filename pattern from `$settingsFile.bak.<timestamp>` to `$settingsDir/settings.json.backup-antigravity-hud-<timestamp>` so `antigravity-hud uninstall` discovers backups created by the legacy scripts.

**Verify**: `node -e "const fs = require('fs'); const r = fs.readFileSync('README.md', 'utf8'); if (r.includes('showMemory')) process.exit(1); console.log('README clean');"` → `README clean`

## Test plan

- Add a test in `tests/test-hyperlinks.js` verifying `DEFAULT_CONFIG` does not contain `showMemory` and contains `enableLinks: true`.
- Verification: `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` → all 4 pass.

## Done criteria

- [ ] `README.md` contains no stale `showMemory` or `RAM 54%` references and documents `argon-wk` and `src/`/`tests/`
- [ ] `scripts/install.ps1` and `scripts/install.sh` reference `@phenom64/antigravity-hud` and `settings.json.backup-antigravity-hud-`
- [ ] `backupSettings()` prunes backups beyond the 5 most recent files
- [ ] `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:
- Any test in `tests/` fails after two fix attempts.

## Maintenance notes

- If new top-level options are added to `DEFAULT_CONFIG` in `src/config.js`, `runConfigure()` will now automatically preserve them via `Object.assign({}, DEFAULT_CONFIG, current, ...)`.
