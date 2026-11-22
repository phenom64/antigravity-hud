#!/usr/bin/env node
'use strict';

// ─── antigravity-hud.js ────────────────────────────────────────────────────────
// Cross-platform Node.js CLI - reads JSON from stdin, outputs a 4-line ANSI HUD.
// Zero npm dependencies. Only Node.js built-ins.
// ────────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execFileSync } = require('child_process');

// ─── MODULAR SRC IMPORTS ───────────────────────────────────────────────────────
const { loadConfig, DEFAULT_CONFIG } = require('../src/config');
const { getGitInfo } = require('../src/git');
const { resolveTranscript, parseTranscript, getSpeed } = require('../src/transcript');
const { renderHUD } = require('../src/render/lines');

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

function readPermissionMode() {
  try {
    const settings = readSettings();
    const key = getExistingPermissionKey(settings) || 'toolPermission';
    return settings[key] || 'request-review';
  } catch (_) {
    return 'request-review';
  }
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

// ─── SUBCOMMAND ROUTING ────────────────────────────────────────────────────────
const arg = process.argv[2];

if (arg === 'install') {
  runInstall();
} else if (arg === 'doctor') {
  runDoctor();
} else if (arg === 'uninstall') {
  runUninstall();
} else if (arg === 'configure' || arg === 'setup') {
  runConfigure();
} else if (arg === '--help' || arg === '-h') {
  runHelp();
} else if (arg === 'mode') {
  const sub = process.argv[3];
  let settings;
  try {
    settings = readSettings();
  } catch (err) {
    console.error(`  ${Red}[!] Failed to read settings.json:${R}`, err.message);
    process.exit(1);
  }
  const key = getExistingPermissionKey(settings) || 'toolPermission';
  const val = settings[key] || 'request-review';

  const map = {
    review: 'request-review',
    auto: 'proceed-in-sandbox',
    yolo: 'always-proceed',
    strict: 'strict'
  };

  const getHUDLabel = (modeVal) => {
    if (modeVal === 'request-review') return '⏸ review mode on';
    if (modeVal === 'proceed-in-sandbox') return '⏩ auto mode on';
    if (modeVal === 'accept-edits') return '⏵⏵ accept edits on';
    if (modeVal === 'plan') return '⏸ plan mode on';
    if (modeVal === 'always-proceed') return '⏩ bypass permissions (YOLO)';
    if (modeVal === 'strict') return '🔒 strict mode on';
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

    try {
      backupSettings();
      settings[key] = nextVal;
      writeSettings(settings);
    } catch (err) {
      console.error(`  ${Red}[!] Failed to cycle mode: ${err.message}${R}`);
      process.exit(1);
    }
    console.log(`  ${Green}[OK] Cycled permission mode from '${val}' to '${nextVal}'.${R}`);
    process.exit(0);
  } else if (['review', 'auto', 'yolo', 'strict'].includes(sub)) {
    const targetVal = map[sub];
    if (val === targetVal) {
      console.log(`  ${Green}[OK] Permission mode is already set to '${targetVal}'.${R}`);
      process.exit(0);
    }
    try {
      backupSettings();
      settings[key] = targetVal;
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
} else {
  // Read stdin and render HUD (the default behavior)
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { /* empty stdin */ }

  // Save raw JSON (best-effort, only in live stdin mode)
  try {
    const saveDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, 'statusline-last.json'), raw || '{}');
  } catch (_) { /* don't crash */ }

  runHud(raw);
}

// ─── SUBCOMMANDS ────────────────────────────────────────────────────────────────

function runInstall() {
  const settingsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');

  console.log(`\n  ${B}${Cyan}antigravity-hud install${R}`);
  console.log(`  ${Gray}=======================${R}\n`);

  try {
    fs.mkdirSync(settingsDir, { recursive: true });
  } catch (err) {
    console.error(`  ${Red}[!] Failed to create settings directory:${R}`, err.message);
    process.exit(1);
  }

  let settings = {};
  let exists = false;
  try {
    if (fs.existsSync(settingsFile)) {
      exists = true;
      const rawSettings = fs.readFileSync(settingsFile, 'utf8');
      settings = JSON.parse(rawSettings);
    }
  } catch (err) {
    console.warn(`  ${Yellow}[!] Failed to read/parse existing settings.json, starting fresh:${R}`, err.message);
  }

  const prevStatusLine = settings.statusLine;

  const alreadyConfigured = prevStatusLine &&
    prevStatusLine.type === 'command' &&
    prevStatusLine.command === 'antigravity-hud' &&
    prevStatusLine.enabled === true;

  if (alreadyConfigured) {
    console.log(`  ${Green}[OK] Already configured. statusLine command is already set to 'antigravity-hud'.${R}\n`);
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

  settings.statusLine = {
    type: 'command',
    command: 'antigravity-hud',
    enabled: true
  };

  try {
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
    console.log(`  ${Green}[OK] Patched settings.json successfully.${R}`);
  } catch (err) {
    console.error(`  ${Red}[!] Failed to write settings.json:${R}`, err.message);
    process.exit(1);
  }

  console.log(`\n  ${White}Previous statusLine:${R}`);
  console.log(prevStatusLine ? JSON.stringify(prevStatusLine, null, 2) : '  (None)');
  console.log(`\n  ${White}New statusLine:${R}`);
  console.log(JSON.stringify(settings.statusLine, null, 2));

  console.log(`\n  ${Cyan}Done! Restart your Antigravity session to see the HUD.${R}\n`);
}

function runDoctor() {
  console.log(`\n  ${B}${Cyan}Antigravity HUD Diagnostics (Doctor)${R}`);
  console.log(`  ${Gray}===================================${R}\n`);

  const settingsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');

  console.log(`  ${White}OS:${R} ${os.type()} (${os.platform()} ${os.arch()})`);
  console.log(`  ${White}Node.js:${R} ${process.version}`);
  console.log(`  ${White}Settings Path:${R} ${settingsFile}`);

  let onPath = false;
  let binLocation = '';
  try {
    const checkCmd = os.platform() === 'win32' ? 'where' : 'which';
    binLocation = execFileSync(checkCmd, ['antigravity-hud'], { encoding: 'utf8' }).trim();
    onPath = true;
  } catch (_) {}

  if (onPath) {
    console.log(`  ${White}PATH Check:${R} ${Green}[OK] Found on PATH: ${binLocation}${R}`);
  } else {
    console.log(`  ${White}PATH Check:${R} ${Yellow}[!] 'antigravity-hud' not found on PATH. Run: npm install -g @phenom64/antigravity-hud${R}`);
  }

  let settings = {};
  try {
    if (fs.existsSync(settingsFile)) {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch (_) {}

  const permKey = getExistingPermissionKey(settings) || 'toolPermission';
  const permVal = settings[permKey] || 'request-review';
  console.log(`  ${White}Tool Permission Key:${R} ${permKey}`);
  console.log(`  ${White}Tool Permission Mode:${R} ${permVal}`);

  const currentStatusLine = settings.statusLine;
  console.log(`\n  ${White}Current statusLine configuration:${R}`);
  if (currentStatusLine) {
    console.log(JSON.stringify(currentStatusLine, null, 2));
    const command = currentStatusLine.command;
    const enabled = currentStatusLine.enabled;
    if (command === 'antigravity-hud' && enabled === true) {
      console.log(`  ${Green}[✓] Antigravity is currently configured to use antigravity-hud!${R}`);
    } else {
      console.log(`  ${Yellow}[!] Antigravity statusLine is configured to run something else: '${command}' (enabled: ${enabled})${R}`);
    }
  } else {
    console.log(`  ${Gray}(None)${R}`);
    console.log(`  ${Yellow}[!] Antigravity is NOT currently configured to use antigravity-hud.${R}`);
  }

  const samplePath = path.join(__dirname, '..', 'docs', 'payload-examples', 'statusline-last.example.json');
  console.log(`\n  ${White}Running sample render test...${R}`);
  if (fs.existsSync(samplePath)) {
    try {
      const sampleRaw = fs.readFileSync(samplePath, 'utf8');
      console.log(`  ${Gray}--- Sample HUD Render Output ---${R}`);
      runHud(sampleRaw);
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

  const settingsDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');

  let settings = {};
  let exists = false;
  try {
    if (fs.existsSync(settingsFile)) {
      exists = true;
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    }
  } catch (err) {
    console.error(`  ${Red}[!] Failed to read settings.json:${R}`, err.message);
    process.exit(1);
  }

  if (!exists) {
    console.log(`  ${Yellow}[!] No settings.json found. Nothing to uninstall.${R}\n`);
    process.exit(0);
  }

  const currentStatusLine = settings.statusLine;
  const isTarget = currentStatusLine && currentStatusLine.command === 'antigravity-hud';

  if (!isTarget) {
    console.log(`  ${Yellow}[!] The statusLine command is not currently configured to use 'antigravity-hud'.${R}`);
    console.log(`  No changes made to settings.json.`);
  } else {
    settings.statusLine.enabled = false;
    try {
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf8');
      console.log(`  ${Green}[OK] Disabled statusLine in settings.json.${R}`);
    } catch (err) {
      console.error(`  ${Red}[!] Failed to update settings.json:${R}`, err.message);
      process.exit(1);
    }
  }

  try {
    const files = fs.readdirSync(settingsDir);
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
        console.log(`    ${Cyan}Copy-Item "${path.join(settingsDir, newestBackup)}" "${settingsFile}" -Force${R}`);
      } else {
        console.log(`    ${Cyan}cp "${path.join(settingsDir, newestBackup)}" "${settingsFile}"${R}`);
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

  const confPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-config.json');
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

  // 4. Colors
  const curColor = current.colorMode !== false ? 'y' : 'n';
  const colorAns = await askQuestion(`  Enable ANSI colors? (y/n) [current: ${curColor}]: `);
  const colorMode = colorAns ? (colorAns.toLowerCase() === 'y') : (current.colorMode !== false);

  // 5. Unicode
  const curUnicode = current.unicodeMode !== false ? 'y' : 'n';
  const unicodeAns = await askQuestion(`  Use Unicode glyphs (reverts to ASCII if disabled)? (y/n) [current: ${curUnicode}]: `);
  const unicodeMode = unicodeAns ? (unicodeAns.toLowerCase() === 'y') : (current.unicodeMode !== false);

  // 6. Hyperlinks
  const curLinks = current.enableLinks !== false ? 'y' : 'n';
  const linksAns = await askQuestion(`  Enable clickable OSC 8 terminal hyperlinks? (y/n) [current: ${curLinks}]: `);
  const enableLinks = linksAns ? (linksAns.toLowerCase() === 'y') : (current.enableLinks !== false);

  const newConfig = Object.assign({}, DEFAULT_CONFIG, current, {
    preset,
    showCost,
    showSpeed,
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
    ${White}antigravity-hud install${R}        Configure Antigravity CLI settings to use this HUD
    ${White}antigravity-hud configure${R}      Open the interactive configuration wizard
    ${White}antigravity-hud doctor${R}         Check install status and run a sample render test
    ${White}antigravity-hud uninstall${R}      Remove or disable the HUD configuration
    ${White}antigravity-hud mode${R}           Show current Antigravity tool permission mode
    ${White}antigravity-hud mode next${R}      Cycle permission modes
    ${White}antigravity-hud mode <mode>${R}    Set mode to review, auto, yolo, or strict
    ${White}antigravity-hud bind-shift-tab${R} Explain Shift+Tab keybinding limitation

  Options:
    -h, --help                     Show this help screen
`);
}

// ─── HUD RENDER CORE ───────────────────────────────────────────────────────────

function runHud(raw) {
  let j = {};
  try { j = JSON.parse(raw); } catch (_) { /* bad JSON, proceed with defaults */ }

  const project = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || process.cwd();
  const ctxOut = dig(j, 'context_window', 'total_output_tokens') || 0;
  const convId = j.conversation_id || j.session_id || null;

  const cachePath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'speed-cache.json');
  const streamSpeed = getSpeed(ctxOut, cachePath, convId);

  const { branch, dirty, ahead, behind, gitRepoUrl } = getGitInfo(project);
  const tPath = resolveTranscript(j);
  const transcriptData = parseTranscript(tPath, j.task_count || 0);
  const permMode = readPermissionMode();

  const lines = renderHUD(j, config, transcriptData, {
    gitBranch: branch,
    gitDirty: Boolean(dirty),
    gitAhead: ahead,
    gitBehind: behind,
    gitRepoUrl,
    speed: streamSpeed,
    permissionMode: permMode,
    transcriptPath: tPath
  });

  process.stdout.write(lines.join('\n') + '\n');
}
