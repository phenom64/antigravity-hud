#!/usr/bin/env node
'use strict';

// ─── antigravity-hud.js ────────────────────────────────────────────────────────
// Cross-platform Node.js CLI - reads JSON from stdin, outputs a 4-line ANSI HUD
// (or a single-line plain-text window title via `antigravity-hud title`).
// Zero npm dependencies. Only Node.js built-ins.
// ────────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execFileSync } = require('child_process');

// ─── MODULAR SRC IMPORTS ───────────────────────────────────────────────────────
const { loadConfig, DEFAULT_CONFIG } = require('../src/config');
const { getVcsInfo } = require('../src/git');
const { resolveTranscript, parseTranscript, getSpeed } = require('../src/transcript');
const { renderHUD } = require('../src/render/lines');
const { renderTitle } = require('../src/title');

// ─── CONFIGURATION LOADING ─────────────────────────────────────────────────────
const config = loadConfig();

// ─── ENV FLAGS & CLI COLORS ────────────────────────────────────────────────────
const NO_COLOR = process.env.AGY_HUD_NO_COLOR === '1' || config.colorMode === false;

let R = '\x1b[0m', B = '\x1b[1m';
let Green = '\x1b[92m', Yellow = '\x1b[93m', Cyan = '\x1b[96m';
let Gray = '\x1b[90m', White = '\x1b[97m', Red = '\x1b[91m';

if (NO_COLOR) {
  R = B = Green = Yellow = Cyan = Gray = White = Red = '';
}

// ─── SETTINGS HELPERS ──────────────────────────────────────────────────────────

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

const SETTINGS_DIR = path.join(os.homedir(), '.gemini', 'antigravity-cli');
const SETTINGS_FILE = path.join(SETTINGS_DIR, 'settings.json');
const STANDALONE_DIR = path.join(SETTINGS_DIR, 'antigravity-hud');
const STANDALONE_BIN = path.join(STANDALONE_DIR, 'bin', 'antigravity-hud.js');

function findOnPath() {
  try {
    const isWin = os.platform() === 'win32';
    const checkCmd = isWin ? 'where' : 'which';
    const checkArgs = isWin ? ['antigravity-hud'] : ['-a', 'antigravity-hud'];
    const out = execFileSync(checkCmd, checkArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const matches = out
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(p => !p.includes(`${path.sep}_npx${path.sep}`) && !p.includes('/_npx/'));
    return matches[0] || null;
  } catch (_) {
    return null;
  }
}

function formatStandaloneCommand(binPath) {
  let resolved = binPath;
  if (os.platform() === 'win32' && /\s/.test(resolved)) {
    try {
      const shortPath = execFileSync(
        'cmd.exe',
        ['/c', `for %I in ("${resolved}") do @echo %~sI`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim();
      if (shortPath && !/\s/.test(shortPath)) resolved = shortPath;
    } catch (_) {}
  }
  return /\s/.test(resolved) ? `node "${resolved}"` : `node ${resolved}`;
}

/** True if `command` runs antigravity-hud (global or standalone), optionally with a subcommand suffix like ` title`. */
function isHudCommand(command, suffix = '') {
  if (typeof command !== 'string') return false;
  let trimmed = command.trim();
  if (suffix) {
    if (!trimmed.endsWith(suffix)) return false;
    trimmed = trimmed.slice(0, -suffix.length).trim();
  }
  if (trimmed === 'antigravity-hud') return true;
  const normalized = trimmed.replace(/\\/g, '/');
  const standaloneNorm = STANDALONE_BIN.replace(/\\/g, '/');
  return (
    normalized.includes(standaloneNorm) ||
    normalized.endsWith('/antigravity-hud/bin/antigravity-hud.js') ||
    normalized.endsWith('/antigravity-hud/bin/antigravity-hud.js"')
  );
}

function installStandaloneRuntime() {
  const pkgRoot = path.resolve(__dirname, '..');
  if (path.resolve(STANDALONE_DIR) === pkgRoot) return;

  fs.mkdirSync(STANDALONE_DIR, { recursive: true });
  for (const rel of ['bin', 'src', 'package.json']) {
    const srcPath = path.join(pkgRoot, rel);
    const dstPath = path.join(STANDALONE_DIR, rel);
    if (fs.existsSync(srcPath)) {
      fs.cpSync(srcPath, dstPath, { recursive: true, force: true });
    }
  }
  const sampleSrc = path.join(pkgRoot, 'docs', 'payload-examples', 'statusline-last.example.json');
  if (fs.existsSync(sampleSrc)) {
    const sampleDst = path.join(STANDALONE_DIR, 'docs', 'payload-examples', 'statusline-last.example.json');
    fs.mkdirSync(path.dirname(sampleDst), { recursive: true });
    fs.copyFileSync(sampleSrc, sampleDst);
  }
  if (os.platform() !== 'win32' && fs.existsSync(STANDALONE_BIN)) {
    try { fs.chmodSync(STANDALONE_BIN, 0o755); } catch (_) {}
  }
}

function getExistingPermissionKey(settings) {
  if (!settings || typeof settings !== 'object') return null;
  for (const key of LIKELY_KEYS) {
    if (key in settings) return key;
  }
  return null;
}

function readSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}

function readSettingsSafe() {
  try {
    return readSettings();
  } catch (_) {
    return {};
  }
}

function extractPermissionMode(settings) {
  const key = getExistingPermissionKey(settings);
  if (key && settings[key]) return settings[key];
  if (settings && typeof settings.agentMode === 'string' && settings.agentMode) {
    return settings.agentMode;
  }
  return 'request-review';
}

function writeSettings(settings) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

function backupSettings(maxBackups = 5) {
  if (!fs.existsSync(SETTINGS_FILE)) return;
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const backupName = `settings.json.backup-antigravity-hud-${ts}`;
  const backupPath = path.join(SETTINGS_DIR, backupName);
  fs.copyFileSync(SETTINGS_FILE, backupPath);
  console.log(`  ${Green}[OK] Backed up settings to: ${backupName}${R}`);

  // Prune older backups beyond maxBackups
  try {
    const files = fs.readdirSync(SETTINGS_DIR)
      .filter(f => f.startsWith('settings.json.backup-antigravity-hud-'))
      .sort();
    while (files.length > maxBackups) {
      const oldest = files.shift();
      try { fs.unlinkSync(path.join(SETTINGS_DIR, oldest)); } catch (_) {}
    }
  } catch (_) {}
}

function dig(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function readStdinSafe() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

// ─── SUBCOMMAND ROUTING ────────────────────────────────────────────────────────
const arg = process.argv[2];

if (arg === 'install') {
  runInstall(process.argv.slice(3));
} else if (arg === 'doctor') {
  runDoctor();
} else if (arg === 'uninstall') {
  runUninstall();
} else if (arg === 'configure' || arg === 'setup') {
  runConfigure();
} else if (arg === 'title') {
  runTitleCommand(readStdinSafe());
} else if (arg === '--help' || arg === '-h') {
  runHelp();
} else if (arg === 'mode') {
  runMode(process.argv[3]);
} else if (arg === 'bind-shift-tab') {
  console.log(`\n  ${Green}[OK] Shift+Tab is now natively supported by Antigravity CLI!${R}`);
  console.log(`  Press ${Cyan}Shift+Tab${R} inside the prompt box to cycle execution modes live:`);
  console.log(`    ${White}default${R} -> ${White}accept-edits${R} -> ${White}auto${R} -> ${White}plan${R}`);
  console.log(`  antigravity-hud automatically reads the live ${Cyan}cycle_mode${R} from the CLI payload.`);
  console.log(`  To change your persisted defaults in settings.json, use:`);
  console.log(`    ${Cyan}antigravity-hud mode <default|accept-edits|plan|review|auto|yolo|strict>${R}\n`);
  process.exit(0);
} else {
  // Read stdin and render HUD (the default behavior)
  const raw = readStdinSafe();

  // Optional debug dump (gated to avoid synchronous disk writes on every 300ms tick)
  if (process.env.AGY_HUD_DEBUG === '1' || config.debugDump === true) {
    try {
      fs.mkdirSync(SETTINGS_DIR, { recursive: true });
      fs.writeFileSync(path.join(SETTINGS_DIR, 'statusline-last.json'), raw || '{}');
    } catch (_) { /* don't crash */ }
  }

  runHud(raw);
}

// ─── SUBCOMMANDS ────────────────────────────────────────────────────────────────

function runMode(sub) {
  let settings;
  try {
    settings = readSettings();
  } catch (err) {
    console.error(`  ${Red}[!] Failed to read settings.json:${R}`, err.message);
    process.exit(1);
  }
  const key = getExistingPermissionKey(settings) || 'toolPermission';
  const val = settings[key] || 'request-review';
  const agentMode = typeof settings.agentMode === 'string' ? settings.agentMode : '(default: auto)';

  const toolMap = {
    review: 'request-review',
    auto: 'proceed-in-sandbox',
    yolo: 'always-proceed',
    strict: 'strict'
  };

  const agentModeMap = {
    default: '',
    'accept-edits': 'accept-edits',
    edits: 'accept-edits',
    plan: 'plan'
  };

  const getHUDLabel = (modeVal) => {
    if (modeVal === 'request-review') return '⏸ review mode on';
    if (modeVal === 'proceed-in-sandbox') return '⏩ auto mode on';
    if (modeVal === 'accept-edits') return '⏵⏵ accept edits on';
    if (modeVal === 'plan') return '⏸ plan mode on';
    if (modeVal === 'always-proceed') return '⏩ bypass permissions (YOLO)';
    if (modeVal === 'strict') return '■ strict mode on';
    return modeVal;
  };

  if (!sub) {
    console.log(`\n  ${B}${Cyan}antigravity-hud mode${R}`);
    console.log(`  ${Gray}====================${R}\n`);
    console.log(`  ${White}Agent Mode (Shift+Tab default):${R} ${agentMode === '' ? 'default (ask before edits)' : agentMode}`);
    console.log(`  ${White}Tool Permission Key:${R} ${key}`);
    console.log(`  ${White}Tool Permission Value:${R} ${val}`);
    console.log(`  ${White}Fallback HUD Label:${R} ${getHUDLabel(extractPermissionMode(settings))}\n`);
    process.exit(0);
  } else if (sub === 'next') {
    const cycle = ['request-review', 'proceed-in-sandbox', 'always-proceed', 'strict'];
    const curIdx = cycle.indexOf(val);
    const nextVal = cycle[(curIdx + 1) % cycle.length];

    try {
      backupSettings();
      settings[key] = nextVal;
      writeSettings(settings);
    } catch (err) {
      console.error(`  ${Red}[!] Failed to cycle mode: ${err.message}${R}`);
      process.exit(1);
    }
    console.log(`  ${Green}[OK] Cycled tool permission mode from '${val}' to '${nextVal}'.${R}`);
    process.exit(0);
  } else if (sub in agentModeMap) {
    const targetVal = agentModeMap[sub];
    try {
      backupSettings();
      settings.agentMode = targetVal;
      writeSettings(settings);
    } catch (err) {
      console.error(`  ${Red}[!] Failed to set agentMode: ${err.message}${R}`);
      process.exit(1);
    }
    console.log(`  ${Green}[OK] Set startup agentMode to '${targetVal || 'default'}'.${R}`);
    process.exit(0);
  } else if (sub in toolMap) {
    const targetVal = toolMap[sub];
    if (val === targetVal && (sub !== 'auto' || settings.agentMode === 'auto')) {
      console.log(`  ${Green}[OK] Permission mode is already set to '${targetVal}'.${R}`);
      process.exit(0);
    }
    try {
      backupSettings();
      settings[key] = targetVal;
      if (sub === 'auto') {
        settings.agentMode = 'auto';
      }
      writeSettings(settings);
    } catch (err) {
      console.error(`  ${Red}[!] Failed to set mode: ${err.message}${R}`);
      process.exit(1);
    }
    console.log(`  ${Green}[OK] Changed permission mode from '${val}' to '${targetVal}'.${R}`);
    process.exit(0);
  } else {
    console.error(`  ${Red}[!] Unknown mode command: ${sub}${R}`);
    console.log(`  Valid mode commands:`);
    console.log(`    antigravity-hud mode`);
    console.log(`    antigravity-hud mode next`);
    console.log(`    antigravity-hud mode <default|accept-edits|plan>  (sets agentMode)`);
    console.log(`    antigravity-hud mode <review|auto|yolo|strict>    (sets toolPermission)`);
    process.exit(1);
  }
}

function runInstall(flags = []) {
  const withTitle = flags.includes('--with-title');
  const setStackTrue = flags.includes('--stack');
  const setStackFalse = flags.includes('--no-stack');
  let paddingOpt = null;
  const padIdx = flags.indexOf('--padding');
  if (padIdx !== -1 && flags[padIdx + 1] != null) {
    const parsedPad = parseInt(flags[padIdx + 1], 10);
    if (Number.isInteger(parsedPad) && parsedPad >= 0) {
      paddingOpt = parsedPad;
    }
  }

  console.log(`\n  ${B}${Cyan}antigravity-hud install${R}`);
  console.log(`  ${Gray}=======================${R}\n`);

  try {
    fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  } catch (err) {
    console.error(`  ${Red}[!] Failed to create settings directory:${R}`, err.message);
    process.exit(1);
  }

  // Use the global binary if on PATH; otherwise (e.g. `npx antigravity-hud install`) copy a standalone runtime
  const globalBin = findOnPath();
  let targetCommand = 'antigravity-hud';
  let usedStandalone = false;

  if (!globalBin) {
    try {
      installStandaloneRuntime();
      usedStandalone = true;
      targetCommand = formatStandaloneCommand(STANDALONE_BIN);
      console.log(`  ${Green}[OK] Installed standalone runtime to: ${STANDALONE_DIR}${R}`);
    } catch (err) {
      console.error(`  ${Red}[!] Failed to install standalone runtime:${R}`, err.message);
      process.exit(1);
    }
  }
  const targetTitleCommand = `${targetCommand} title`;

  let settings = {};
  let exists = false;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      exists = true;
      const rawSettings = fs.readFileSync(SETTINGS_FILE, 'utf8');
      settings = JSON.parse(rawSettings);
    }
  } catch (err) {
    console.warn(`  ${Yellow}[!] Failed to read/parse existing settings.json, starting fresh:${R}`, err.message);
  }

  const prevStatusLine = settings.statusLine;
  const prevIsObj = prevStatusLine && typeof prevStatusLine === 'object' && !Array.isArray(prevStatusLine);

  const nextStatusLine = {
    type: 'command',
    command: targetCommand,
    enabled: true
  };

  // Preserve existing official statusLine properties (`padding`, `stack_with_default`)
  if (prevIsObj && typeof prevStatusLine.padding === 'number' && prevStatusLine.padding >= 0) {
    nextStatusLine.padding = prevStatusLine.padding;
  }
  if (prevIsObj && typeof prevStatusLine.stack_with_default === 'boolean') {
    nextStatusLine.stack_with_default = prevStatusLine.stack_with_default;
  }
  if (paddingOpt != null) {
    nextStatusLine.padding = paddingOpt;
  }
  if (setStackTrue) {
    nextStatusLine.stack_with_default = true;
  } else if (setStackFalse) {
    nextStatusLine.stack_with_default = false;
  }

  const statusLineSame = prevIsObj &&
    prevStatusLine.type === nextStatusLine.type &&
    prevStatusLine.command === nextStatusLine.command &&
    prevStatusLine.enabled === nextStatusLine.enabled &&
    prevStatusLine.padding === nextStatusLine.padding &&
    prevStatusLine.stack_with_default === nextStatusLine.stack_with_default;

  const prevTitle = settings.title;
  const titleAlreadyConfigured = !withTitle || (
    prevTitle && typeof prevTitle === 'object' &&
    prevTitle.type === 'command' &&
    prevTitle.command === targetTitleCommand &&
    prevTitle.enabled === true
  );

  if (statusLineSame && titleAlreadyConfigured) {
    if (usedStandalone) {
      console.log(`  ${Green}[OK] Runtime updated. statusLine is already configured.${R}\n`);
    } else {
      console.log(`  ${Green}[OK] Already configured. statusLine command is already set to '${targetCommand}'.${R}\n`);
    }
    process.exit(0);
  }

  if (exists) {
    try {
      backupSettings();
    } catch (err) {
      console.error(`  ${Red}[!] Failed to backup settings.json:${R}`, err.message);
      process.exit(1);
    }
  }

  settings.statusLine = nextStatusLine;
  if (withTitle) {
    settings.title = {
      type: 'command',
      command: targetTitleCommand,
      enabled: true
    };
  }

  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`  ${Green}[OK] Patched settings.json successfully.${R}`);
  } catch (err) {
    console.error(`  ${Red}[!] Failed to write settings.json:${R}`, err.message);
    process.exit(1);
  }

  console.log(`\n  ${White}Previous statusLine:${R}`);
  console.log(prevStatusLine !== undefined ? JSON.stringify(prevStatusLine, null, 2) : '  (None)');
  console.log(`\n  ${White}New statusLine:${R}`);
  console.log(JSON.stringify(settings.statusLine, null, 2));
  if (withTitle) {
    console.log(`\n  ${White}New title:${R}`);
    console.log(JSON.stringify(settings.title, null, 2));
  }

  console.log(`\n  ${Cyan}Done! Restart your Antigravity session (or run /statusline enable) to see the HUD.${R}`);
  if (!withTitle) {
    console.log(`  ${Gray}Tip: Run 'antigravity-hud install --with-title' to also enable live terminal window titles.${R}`);
  }
  console.log('');
}

function runDoctor() {
  console.log(`\n  ${B}${Cyan}Antigravity HUD Diagnostics (Doctor)${R}`);
  console.log(`  ${Gray}===================================${R}\n`);

  console.log(`  ${White}OS:${R} ${os.type()} (${os.platform()} ${os.arch()})`);
  console.log(`  ${White}Node.js:${R} ${process.version}`);
  console.log(`  ${White}Settings Path:${R} ${SETTINGS_FILE}`);

  const binLocation = findOnPath();
  const hasStandalone = fs.existsSync(STANDALONE_BIN);

  if (binLocation) {
    console.log(`  ${White}PATH Check:${R} ${Green}[OK] Found on PATH: ${binLocation}${R}`);
  } else if (hasStandalone) {
    console.log(`  ${White}PATH Check:${R} ${Green}[OK] Standalone runtime installed: ${STANDALONE_BIN}${R}`);
  } else {
    console.log(`  ${White}PATH Check:${R} ${Yellow}[!] 'antigravity-hud' not found on PATH. Run: npx antigravity-hud install (or npm install -g antigravity-hud)${R}`);
  }

  const settings = readSettingsSafe();
  const permKey = getExistingPermissionKey(settings) || 'toolPermission';
  const permVal = settings[permKey] || 'request-review';
  const agentModeVal = typeof settings.agentMode === 'string'
    ? (settings.agentMode || 'default')
    : 'auto (CLI default)';

  console.log(`  ${White}Agent Mode (Shift+Tab):${R} ${agentModeVal}`);
  console.log(`  ${White}Tool Permission Key:${R} ${permKey}`);
  console.log(`  ${White}Tool Permission Mode:${R} ${permVal}`);

  const currentStatusLine = settings.statusLine;
  console.log(`\n  ${White}Current statusLine configuration:${R}`);
  if (typeof currentStatusLine === 'boolean') {
    console.log(`  ${Yellow}[!] statusLine is set to a boolean (${currentStatusLine}). Antigravity CLI requires an object; run 'antigravity-hud install' to fix.${R}`);
  } else if (currentStatusLine && typeof currentStatusLine === 'object') {
    console.log(JSON.stringify(currentStatusLine, null, 2));
    const command = currentStatusLine.command;
    const enabled = currentStatusLine.enabled !== false;
    if (isHudCommand(command) && enabled) {
      console.log(`  ${Green}[✓] Antigravity is currently configured to use antigravity-hud!${R}`);
    } else if (isHudCommand(command) && !enabled) {
      console.log(`  ${Yellow}[!] antigravity-hud is configured but disabled. Run '/statusline enable' in the TUI or 'antigravity-hud install'.${R}`);
    } else {
      console.log(`  ${Yellow}[!] Antigravity statusLine is configured to run something else: '${command}' (enabled: ${enabled})${R}`);
    }
  } else {
    console.log(`  ${Gray}(None)${R}`);
    console.log(`  ${Yellow}[!] Antigravity is NOT currently configured to use antigravity-hud.${R}`);
    console.log(`  ${Gray}Run 'antigravity-hud install' or '/statusline antigravity-hud' inside the TUI.${R}`);
  }

  const currentTitle = settings.title;
  console.log(`\n  ${White}Current title configuration:${R}`);
  if (currentTitle && typeof currentTitle === 'object') {
    console.log(JSON.stringify(currentTitle, null, 2));
  } else {
    console.log(`  ${Gray}(None - optional: run 'antigravity-hud install --with-title' to enable dynamic window titles)${R}`);
  }

  const samplePath = path.join(__dirname, '..', 'docs', 'payload-examples', 'statusline-last.example.json');
  console.log(`\n  ${White}Running sample render test...${R}`);
  if (fs.existsSync(samplePath)) {
    try {
      const sampleRaw = fs.readFileSync(samplePath, 'utf8');
      console.log(`  ${Gray}--- Sample HUD Render Output ---${R}`);
      runHud(sampleRaw);
      console.log(`  ${Gray}--- Sample Window Title Output ---${R}`);
      runTitleCommand(sampleRaw);
      console.log(`  ${Gray}--------------------------------${R}`);
      console.log(`  ${Green}[OK] Sample render complete.${R}\n`);
    } catch (err) {
      console.error(`  ${Red}[!] Sample render test failed:${R}`, err.message);
    }
  } else {
    console.log(`  ${Yellow}[!] Sample payload file not found at: ${samplePath}${R}\n`);
  }
}

function runUninstall() {
  console.log(`\n  ${B}${Cyan}antigravity-hud uninstall${R}`);
  console.log(`  ${Gray}=========================${R}\n`);

  let settings = {};
  let exists = false;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      exists = true;
      settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error(`  ${Red}[!] Failed to read settings.json:${R}`, err.message);
    process.exit(1);
  }

  if (!exists) {
    console.log(`  ${Yellow}[!] No settings.json found. Nothing to uninstall.${R}\n`);
    process.exit(0);
  }

  let modified = false;
  const currentStatusLine = settings.statusLine;
  if (currentStatusLine && typeof currentStatusLine === 'object' && isHudCommand(currentStatusLine.command)) {
    settings.statusLine.enabled = false;
    modified = true;
    console.log(`  ${Green}[OK] Disabled statusLine in settings.json.${R}`);
  } else {
    console.log(`  ${Yellow}[!] The statusLine command is not currently configured to use 'antigravity-hud'.${R}`);
  }

  const currentTitle = settings.title;
  if (currentTitle && typeof currentTitle === 'object' && isHudCommand(currentTitle.command, ' title')) {
    settings.title.enabled = false;
    modified = true;
    console.log(`  ${Green}[OK] Disabled title in settings.json.${R}`);
  }

  if (modified) {
    try {
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
      console.error(`  ${Red}[!] Failed to update settings.json:${R}`, err.message);
      process.exit(1);
    }
  } else {
    console.log(`  No changes made to settings.json.`);
  }

  if (fs.existsSync(STANDALONE_DIR)) {
    try {
      fs.rmSync(STANDALONE_DIR, { recursive: true, force: true });
      console.log(`  ${Green}[OK] Removed standalone runtime: ${STANDALONE_DIR}${R}`);
    } catch (err) {
      console.warn(`  ${Yellow}[!] Could not remove standalone runtime (${STANDALONE_DIR}): ${err.message}${R}`);
    }
  }

  try {
    const files = fs.readdirSync(SETTINGS_DIR);
    const backups = files.filter(f => f.startsWith('settings.json.backup-antigravity-hud-'));
    if (backups.length > 0) {
      backups.sort();
      const newestBackup = backups[backups.length - 1];
      console.log(`\n  ${White}Found existing backup file(s):${R}`);
      for (const b of backups) {
        console.log(`    - ${b}`);
      }
      console.log(`\n  To restore your settings from the newest backup, run:`);
      if (os.platform() === 'win32') {
        console.log(`    ${Cyan}Copy-Item "${path.join(SETTINGS_DIR, newestBackup)}" "${SETTINGS_FILE}" -Force${R}`);
      } else {
        console.log(`    ${Cyan}cp "${path.join(SETTINGS_DIR, newestBackup)}" "${SETTINGS_FILE}"${R}`);
      }
    }
  } catch (_) {}

  console.log(`\n  Uninstall process complete.${R}\n`);
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans.trim());
  }));
}

async function runConfigure() {
  console.log(`\n  ${B}${Cyan}antigravity-hud configuration wizard${R}`);
  console.log(`  ${Gray}====================================${R}\n`);

  const confPath = path.join(SETTINGS_DIR, 'antigravity-hud-config.json');
  let current = {};
  try {
    if (fs.existsSync(confPath)) {
      current = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    }
  } catch (_) {}

  // 1. Preset
  console.log(`  ${White}Choose a layout preset:${R}`);
  console.log(`    1) Full      - Show all details (4 lines)`);
  console.log(`    2) Essential - Show essentials (2 lines)`);
  console.log(`    3) Minimal   - Show compact summary (1 line)`);
  const curPreset = current.preset || 'full';
  const pChoice = await askQuestion(`  Select preset (1-3) [current: ${curPreset}]: `);
  let preset = curPreset;
  if (pChoice === '1') preset = 'full';
  else if (pChoice === '2') preset = 'essential';
  else if (pChoice === '3') preset = 'minimal';

  // 2. Cost
  const curCost = current.showCost !== false ? 'y' : 'n';
  const costAns = await askQuestion(`  Enable USD session cost tracking? (y/n) [current: ${curCost}]: `);
  const showCost = costAns ? (costAns.toLowerCase() === 'y') : (current.showCost !== false);

  // 3. Speed
  const curSpeed = current.showSpeed !== false ? 'y' : 'n';
  const speedAns = await askQuestion(`  Enable token generation speed (tok/s)? (y/n) [current: ${curSpeed}]: `);
  const showSpeed = speedAns ? (speedAns.toLowerCase() === 'y') : (current.showSpeed !== false);

  // 4. Cache hit ratio
  const curCache = current.showCacheHit !== false ? 'y' : 'n';
  const cacheAns = await askQuestion(`  Show prompt cache hit ratio (⚡N%) on Line 2? (y/n) [current: ${curCache}]: `);
  const showCacheHit = cacheAns ? (cacheAns.toLowerCase() === 'y') : (current.showCacheHit !== false);

  // 5. Quota pace delta
  const curPace = current.showQuotaPace === true ? 'y' : 'n';
  const paceAns = await askQuestion(`  Show quota burn pace delta (⇡N% / ⇣N%)? (y/n) [current: ${curPace}]: `);
  const showQuotaPace = paceAns ? (paceAns.toLowerCase() === 'y') : (current.showQuotaPace === true);

  // 6. Artifacts
  const curArt = current.showArtifacts !== false ? 'y' : 'n';
  const artAns = await askQuestion(`  Show artifact count on Line 4? (y/n) [current: ${curArt}]: `);
  const showArtifacts = artAns ? (artAns.toLowerCase() === 'y') : (current.showArtifacts !== false);

  // 7. Short conversation ID / title
  const curConv = current.showConversationId === true ? 'y' : 'n';
  const convAns = await askQuestion(`  Show short conversation ID / title on Line 1 (for agy -r)? (y/n) [current: ${curConv}]: `);
  const showConversationId = convAns ? (convAns.toLowerCase() === 'y') : (current.showConversationId === true);

  // 8. Colors
  const curColor = current.colorMode !== false ? 'y' : 'n';
  const colorAns = await askQuestion(`  Enable ANSI colors? (y/n) [current: ${curColor}]: `);
  const colorMode = colorAns ? (colorAns.toLowerCase() === 'y') : (current.colorMode !== false);

  // 9. Unicode
  const curUnicode = current.unicodeMode !== false ? 'y' : 'n';
  const unicodeAns = await askQuestion(`  Use Unicode glyphs (reverts to ASCII if disabled)? (y/n) [current: ${curUnicode}]: `);
  const unicodeMode = unicodeAns ? (unicodeAns.toLowerCase() === 'y') : (current.unicodeMode !== false);

  // 10. Hyperlinks
  const curLinks = current.enableLinks !== false ? 'y' : 'n';
  const linksAns = await askQuestion(`  Enable clickable OSC 8 terminal hyperlinks? (y/n) [current: ${curLinks}]: `);
  const enableLinks = linksAns ? (linksAns.toLowerCase() === 'y') : (current.enableLinks !== false);

  const newConfig = Object.assign({}, DEFAULT_CONFIG, current, {
    preset,
    showCost,
    showSpeed,
    showCacheHit,
    showQuotaPace,
    showArtifacts,
    showConversationId,
    enableLinks,
    colorMode,
    unicodeMode,
    colors: current.colors || {}
  });
  delete newConfig.showMemory;

  try {
    fs.mkdirSync(path.dirname(confPath), { recursive: true });
    fs.writeFileSync(confPath, JSON.stringify(newConfig, null, 2), 'utf8');
    console.log(`\n  ${Green}[OK] Configuration saved successfully to:${R}\n  ${confPath}\n`);
  } catch (err) {
    console.error(`\n  ${Red}[!] Failed to save configuration:${R}`, err.message);
  }
}

function runHelp() {
  console.log(`
  ${B}${Cyan}antigravity-hud${R}

  Usage:
    ${White}antigravity-hud${R}                Read statusline JSON from stdin and render the HUD (default)
    ${White}antigravity-hud title${R}          Read statusline JSON from stdin and print a plain-text window title
    ${White}antigravity-hud install${R}        Configure Antigravity CLI settings to use this HUD
                                   Flags: --with-title, --stack, --no-stack, --padding <n>
    ${White}antigravity-hud configure${R}      Open the interactive configuration wizard
    ${White}antigravity-hud doctor${R}         Check install status and run sample HUD & title render tests
    ${White}antigravity-hud uninstall${R}      Disable HUD (and title) configuration in settings.json
    ${White}antigravity-hud mode${R}           Show current Antigravity agentMode & toolPermission
    ${White}antigravity-hud mode next${R}      Cycle toolPermission modes
    ${White}antigravity-hud mode <mode>${R}    Set agentMode (default|accept-edits|plan) or toolPermission (review|auto|yolo|strict)

  Options:
    -h, --help                     Show this help screen
`);
}

// ─── TITLE RENDER CORE ─────────────────────────────────────────────────────────

function runTitleCommand(raw) {
  let j = {};
  try { j = JSON.parse(raw); } catch (_) { /* empty/bad JSON */ }

  const project = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || '';
  const vcsInfo = project ? getVcsInfo(project, j) : { branch: '', dirty: '' };
  const title = renderTitle(j, {
    gitBranch: vcsInfo.branch,
    gitDirty: Boolean(vcsInfo.dirty),
    noUnicode: process.env.AGY_HUD_NO_UNICODE === '1' || config.unicodeMode === false
  });
  process.stdout.write(title + '\n');
}

// ─── HUD RENDER CORE ───────────────────────────────────────────────────────────

function runHud(raw) {
  let j = {};
  try { j = JSON.parse(raw); } catch (_) { /* bad JSON, proceed with defaults */ }

  const project = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || process.cwd();
  const ctxOut = dig(j, 'context_window', 'total_output_tokens') || 0;
  const convId = j.conversation_id || j.session_id || null;

  const cachePath = path.join(SETTINGS_DIR, 'speed-cache.json');
  const streamSpeed = getSpeed(ctxOut, cachePath, convId);

  const vcsInfo = getVcsInfo(project, j);
  const tPath = resolveTranscript(j);
  const transcriptData = parseTranscript(tPath, j.task_count || 0);
  const settings = readSettingsSafe();
  const permMode = extractPermissionMode(settings);
  const orchestrator = (settings && typeof settings.orchestrator === 'object') ? settings.orchestrator : null;

  const lines = renderHUD(j, config, transcriptData, {
    vcsType: vcsInfo.vcsType,
    gitBranch: vcsInfo.branch,
    gitDirty: Boolean(vcsInfo.dirty),
    gitAhead: vcsInfo.ahead,
    gitBehind: vcsInfo.behind,
    gitRepoUrl: vcsInfo.gitRepoUrl,
    speed: streamSpeed,
    permissionMode: permMode,
    orchestrator,
    transcriptPath: tPath
  });

  process.stdout.write(lines.join('\n') + '\n');
}
