#!/usr/bin/env node
'use strict';

// ─── antigravity-hud.js ────────────────────────────────────────────────────────
// Cross-platform Node.js CLI - reads JSON from stdin, outputs a 4-line ANSI HUD.
// Zero npm dependencies. Only Node.js built-ins.
// ────────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const readline = require('readline');
const { execFileSync } = require('child_process');

// ─── CONFIGURATION LOADING ─────────────────────────────────────────────────────
const configPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-config.json');
let config = {
  preset: 'full',
  showCost: true,
  showSpeed: true,
  showMemory: false,
  colorMode: true,
  unicodeMode: true,
  colors: {}
};
try {
  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = Object.assign(config, parsed);
  }
} catch (_) {}

// ─── ENV FLAGS ─────────────────────────────────────────────────────────────────
const NO_COLOR   = process.env.AGY_HUD_NO_COLOR   === '1' || config.colorMode === false;
const NO_UNICODE = process.env.AGY_HUD_NO_UNICODE === '1' || config.unicodeMode === false;
const NO_SPINNER = process.env.AGY_HUD_NO_SPINNER === '1';

// ─── UNICODE / ASCII GLYPHS ───────────────────────────────────────────────────
let SEP = '\u2502', DOT = '\u25CF', UP = '\u2191', DOWN = '\u2193';
let FAST = '\u23E9', WARN = '\u26A0', CHECK = '\u2714', TIMES = '\u00D7';
let FULL = '\u2588', EMPTY = '\u2591';
let SPINNER_FRAMES = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F'];

if (NO_UNICODE) {
  SEP = '|'; DOT = '*'; UP = '^'; DOWN = 'v';
  FAST = '>>'; WARN = '!'; CHECK = '+'; TIMES = 'x';
  FULL = '#'; EMPTY = '.';
  SPINNER_FRAMES = ['|','/','-','\\'];
}

// ─── ANSI COLORS ───────────────────────────────────────────────────────────────
let R = '\x1b[0m', B = '\x1b[1m';
let Green = '\x1b[92m', Yellow = '\x1b[93m', Blue = '\x1b[94m';
let Mag = '\x1b[95m', Cyan = '\x1b[96m', Gray = '\x1b[90m';
let White = '\x1b[97m', Red = '\x1b[91m';
let Amber = '\x1b[93m', Orange = '\x1b[38;5;208m';

if (NO_COLOR) {
  R = B = Green = Yellow = Blue = Mag = Cyan = Gray = White = Red = Amber = Orange = '';
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────

/** Format large numbers: 1.2m, 29.5k, or integer string. */
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

/** Render a progress bar: filled + empty blocks, percentage clamped 0-100. */
function bar(pct, len) {
  if (len <= 0) return '';
  pct = Math.max(0, Math.min(100, pct));
  let filled = Math.round((pct / 100) * len);
  if (pct > 0 && filled < 1) filled = 1;
  return FULL.repeat(filled) + EMPTY.repeat(len - filled);
}

/** Format seconds into human-readable reset time: Xd Yh, Xh Ym, Xm. */
function fmtReset(seconds) {
  if (seconds == null || seconds <= 0) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Pick ANSI color for a remaining-percentage value. */
function quotaColor(pct) {
  if (pct >= 50) return Green;
  if (pct >= 25) return Amber;
  if (pct >= 15) return Orange;
  return Red;
}

/** Get remaining quota percentage, defaulting to 100 if missing or null. */
function quotaPct(q) {
  if (!q || q.remaining_fraction == null) return 100;

  const pct = Math.round(Number(q.remaining_fraction) * 100);
  if (!Number.isFinite(pct)) return 100;

  return Math.max(0, Math.min(100, pct));
}

const ANSI_BY_NAME = {
  dim: '\x1b[2m',
  red: '\x1b[91m',
  green: '\x1b[92m',
  yellow: '\x1b[93m',
  magenta: '\x1b[95m',
  cyan: '\x1b[96m',
  brightblue: '\x1b[94m',
  brightmagenta: '\x1b[95m',
  white: '\x1b[97m',
  gray: '\x1b[90m',
  orange: '\x1b[38;5;208m',
};

function resolveColor(value, fallback) {
  if (NO_COLOR) return '';
  if (!value) return fallback;
  if (typeof value === 'number') {
    return `\x1b[38;5;${value}m`;
  }
  if (typeof value === 'string') {
    if (value.startsWith('#') && value.length === 7) {
      const r = parseInt(value.slice(1, 3), 16);
      const g = parseInt(value.slice(3, 5), 16);
      const b = parseInt(value.slice(5, 7), 16);
      return `\x1b[38;2;${r};${g};${b}m`;
    }
    const nameColor = ANSI_BY_NAME[value.toLowerCase()];
    if (nameColor) return nameColor;
  }
  return fallback;
}

function getRamUsage() {
  try {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const pct = Math.round((used / total) * 100);
    const gb = bytes => (bytes / (1024 * 1024 * 1024)).toFixed(1);
    return { pct, used: gb(used), total: gb(total) };
  } catch (_) {
    return { pct: 0, used: '0.0', total: '0.0' };
  }
}

function estimateCost(modelName, inTokens, outTokens) {
  let inPrice = 3.0; // fallback pricing ($/M tokens)
  let outPrice = 15.0;

  const modelLower = modelName.toLowerCase();
  if (modelLower.includes('opus')) {
    inPrice = 15.0;
    outPrice = 75.0;
  } else if (modelLower.includes('sonnet')) {
    inPrice = 3.0;
    outPrice = 15.0;
  } else if (modelLower.includes('haiku')) {
    inPrice = 0.8;
    outPrice = 4.0;
  } else if (modelLower.includes('gemini-1.5-pro') || modelLower.includes('gemini 1.5 pro')) {
    inPrice = 1.25;
    outPrice = 5.0;
  } else if (modelLower.includes('gemini-1.5-flash') || modelLower.includes('gemini 1.5 flash') ||
             modelLower.includes('gemini-2.0-flash') || modelLower.includes('gemini 2.0 flash') ||
             modelLower.includes('gemini-3.5-flash') || modelLower.includes('gemini 3.5 flash')) {
    inPrice = 0.075;
    outPrice = 0.3;
  }

  const inputUsd = (inTokens / 1000000) * inPrice;
  const outputUsd = (outTokens / 1000000) * outPrice;
  return inputUsd + outputUsd;
}

function getSpeed(currentTokens, cachePath) {
  let cache = { lastTokens: 0, lastTimestamp: 0, lastSpeed: 0 };
  try {
    if (fs.existsSync(cachePath)) {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (_) {}

  const now = Date.now();
  const dt = (now - cache.lastTimestamp) / 1000;
  let speed = cache.lastSpeed || 0;

  if (dt >= 0.5) {
    const dTokens = currentTokens - cache.lastTokens;
    if (dTokens > 0) {
      speed = dTokens / dt;
    } else if (dTokens < 0) {
      speed = 0; // reset
    } else {
      if (dt > 3) speed = 0; // idle decay
    }
    try {
      fs.writeFileSync(cachePath, JSON.stringify({
        lastTokens: currentTokens,
        lastTimestamp: now,
        lastSpeed: speed
      }), 'utf8');
    } catch (_) {}
  }
  return speed;
}

/** Safely get a nested property. */
function dig(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Cross-platform basename that handles both Windows backslash and Unix forward
 * slash separators regardless of the host OS. path.basename() only splits on
 * the host separator, so a Linux host given "C:\\Users\\dev\\project" would
 * return the whole string.
 */
function basenameAny(p) {
  if (!p) return '';
  // Split on whichever slash comes last
  const last = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return last || p;
}

/** Recursively find all files matching a name under a directory. */
function findFiles(dir, target) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          results.push(...findFiles(full, target));
        } else if (e.name === target) {
          const stat = fs.statSync(full);
          results.push({ path: full, mtime: stat.mtimeMs });
        }
      } catch (_) { /* permission errors, symlink issues */ }
    }
  } catch (_) { /* can't read dir */ }
  return results;
}

/** Locate the best transcript.jsonl to parse. */
function resolveTranscript(j) {
  // 0. AGY_HUD_TRANSCRIPT env override (handy for local testing)
  if (process.env.AGY_HUD_TRANSCRIPT) {
    try { if (fs.existsSync(process.env.AGY_HUD_TRANSCRIPT)) return process.env.AGY_HUD_TRANSCRIPT; } catch (_) {}
  }
  // 1. Explicit path from payload
  if (j && j.transcript_path) {
    try { if (fs.existsSync(j.transcript_path)) return j.transcript_path; } catch (_) {}
  }
  // 2. Search common brain directories for newest transcript.jsonl
  const home = os.homedir();
  const searchDirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'brain'),
    path.join(home, '.gemini', 'antigravity', 'brain'),
  ];
  let all = [];
  for (const d of searchDirs) {
    try { if (fs.existsSync(d)) all.push(...findFiles(d, 'transcript.jsonl')); } catch (_) {}
  }
  if (all.length === 0) return null;
  all.sort((a, b) => b.mtime - a.mtime);
  return all[0].path;
}

// Tool category mapping
const TOOL_CATEGORIES = {
  list_permissions: 'read', list_dir: 'read', view_file: 'read',
  grep_search: 'search', search_web: 'search', read_url_content: 'search',
  write_to_file: 'write',
  replace_file_content: 'edit', multi_replace_file_content: 'edit',
  run_command: 'bash',
  define_subagent: 'agent', invoke_subagent: 'agent', manage_subagents: 'agent', send_message: 'agent',
  manage_task: 'task', schedule: 'task',
  ask_question: 'ask', ask_permission: 'ask',
  generate_image: 'image',
};

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

  // Check if already configured
  const alreadyConfigured = prevStatusLine &&
    prevStatusLine.type === 'command' &&
    prevStatusLine.command === 'antigravity-hud' &&
    prevStatusLine.enabled === true;

  if (alreadyConfigured) {
    console.log(`  ${Green}[OK] Already configured. statusLine command is already set to 'antigravity-hud'.${R}\n`);
    process.exit(0);
  }

  // Backup if it exists
  if (exists) {
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

  // Update settings
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
  console.log(`\n  ${B}${Cyan}antigravity-hud doctor${R}`);
  console.log(`  ${Gray}======================${R}\n`);

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
    // Disable it
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

  // 4. Memory
  const curMemory = current.showMemory === true ? 'y' : 'n';
  const memoryAns = await askQuestion(`  Enable system RAM monitoring? (y/n) [current: ${curMemory}]: `);
  const showMemory = memoryAns ? (memoryAns.toLowerCase() === 'y') : (current.showMemory === true);

  // 5. Colors
  const curColor = current.colorMode !== false ? 'y' : 'n';
  const colorAns = await askQuestion(`  Enable ANSI colors? (y/n) [current: ${curColor}]: `);
  const colorMode = colorAns ? (colorAns.toLowerCase() === 'y') : (current.colorMode !== false);

  // 6. Unicode
  const curUnicode = current.unicodeMode !== false ? 'y' : 'n';
  const unicodeAns = await askQuestion(`  Use Unicode glyphs (reverts to ASCII if disabled)? (y/n) [current: ${curUnicode}]: `);
  const unicodeMode = unicodeAns ? (unicodeAns.toLowerCase() === 'y') : (current.unicodeMode !== false);

  const newConfig = {
    preset,
    showCost,
    showSpeed,
    showMemory,
    colorMode,
    unicodeMode,
    colors: current.colors || {}
  };

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
    ${White}antigravity-hud${R}           Read statusline JSON from stdin and render the HUD (default)
    ${White}antigravity-hud install${R}   Configure Antigravity CLI settings to use this HUD
    ${White}antigravity-hud configure${R} Open the interactive configuration wizard
    ${White}antigravity-hud doctor${R}    Check install status and run a sample render test
    ${White}antigravity-hud uninstall${R} Remove or disable the HUD configuration

  Options:
    -h, --help                Show this help screen
`);
}

// ─── HUD RENDER CORE ───────────────────────────────────────────────────────────

function runHud(raw) {
  let j = {};
  try { j = JSON.parse(raw); } catch (_) { /* bad JSON, proceed with defaults */ }

  // ─── DATA EXTRACTION ──────────────────────────────────────────────────────────
  const model    = dig(j, 'model', 'display_name') || dig(j, 'model', 'id') || 'unknown model';
  const project  = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || process.cwd();
  const repo     = basenameAny(project);
  const cols     = j.terminal_width || 120;
  const state    = j.agent_state || 'idle';

  const ctxIn    = dig(j, 'context_window', 'total_input_tokens')  || 0;
  const ctxOut   = dig(j, 'context_window', 'total_output_tokens') || 0;
  const ctxSize  = dig(j, 'context_window', 'context_window_size') || 1;
  const ctxPct   = dig(j, 'context_window', 'used_percentage')     || 0;

  // ─── RESOLVE COLORS ────────────────────────────────────────────────────────────
  const colorModel   = resolveColor(config.colors.model, `${Cyan}`);
  const colorRepo    = resolveColor(config.colors.project, `${Yellow}`);
  const colorGit     = resolveColor(config.colors.git, `${Blue}`);
  const colorLabel   = resolveColor(config.colors.label, `${Gray}`);
  const colorSep     = resolveColor(config.colors.separator, `${Yellow}`);
  const colorActive  = resolveColor(config.colors.active, `${Cyan}`);
  const colorSuccess = resolveColor(config.colors.success, `${Green}`);

  // ─── CALCULATE COST, SPEED, RAM ────────────────────────────────────────────────
  const totalCost   = estimateCost(model, ctxIn, ctxOut);
  const cachePath   = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'speed-cache.json');
  const streamSpeed = getSpeed(ctxOut, cachePath);
  const ram         = getRamUsage();

  // ─── LAYOUT ────────────────────────────────────────────────────────────────────
  let layout = cols >= 118 ? 'normal' : cols >= 92 ? 'compact' : 'tiny';
  if (process.env.AGY_HUD_LAYOUT && /^(normal|compact|tiny)$/.test(process.env.AGY_HUD_LAYOUT)) {
    layout = process.env.AGY_HUD_LAYOUT;
  }

  let barLen, toolMax;
  if (layout === 'normal') {
    barLen = cols >= 180 ? 16 : cols >= 145 ? 12 : 10;
    toolMax = 6;
  } else if (layout === 'compact') {
    barLen = 8;
    toolMax = 5;
  } else {
    barLen = 0;
    toolMax = 4;
  }

  if (process.env.AGY_HUD_TOOL_MAX) {
    const parsed = parseInt(process.env.AGY_HUD_TOOL_MAX, 10);
    if (parsed > 0) toolMax = parsed;
  }

  // ─── MODEL NAME SHORTENING (tiny layout) ──────────────────────────────────────
  let displayModel = model;
  if (layout === 'tiny') {
    displayModel = displayModel
      .replace(/^Gemini\s*/i, 'G')
      .replace(/^Claude\s+Opus/i, 'Opus')
      .replace(/^Claude\s+Sonnet/i, 'Sonnet');
  }

  // ─── GIT BRANCH ────────────────────────────────────────────────────────────────
  let branch = '';
  let dirty  = '';
  try {
    branch = execFileSync('git', ['-C', project, 'branch', '--show-current'], {
      timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (_) { /* not a git repo or git unavailable */ }

  if (branch) {
    try {
      const status = execFileSync('git', ['-C', project, 'status', '--porcelain'], {
        timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (status.length > 0) dirty = '*';
    } catch (_) { /* ignore */ }
  }

  // ─── QUOTA LOGIC ───────────────────────────────────────────────────────────────
  const is3p   = /claude|opus|sonnet/i.test(model);
  const q5hKey = is3p ? '3p-5h'     : 'gemini-5h';
  const qWkKey = is3p ? '3p-weekly' : 'gemini-weekly';
  const q5h    = dig(j, 'quota', q5hKey) || {};
  const qWk    = dig(j, 'quota', qWkKey) || {};
  const q5hPct = quotaPct(q5h);
  const qWkPct = quotaPct(qWk);

  // ─── TRANSCRIPT PARSING ───────────────────────────────────────────────────────
  const toolCounts   = {};  // category → count
  const toolLastSeen = {};  // category → sequence number
  let shellCount   = 0;
  let taskCount    = j.task_count || 0;
  let agentInvoked = 0;
  let activeAgents = null;
  let seqNum       = 0;

  try {
    const tPath = resolveTranscript(j);
    if (tPath) {
      const content = fs.readFileSync(tPath, 'utf8');
      const lines   = content.split('\n');
      const slice   = lines.slice(Math.max(0, lines.length - 320));

      for (const line of slice) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch (_) { continue; }
        seqNum++;

        if (entry.content && typeof entry.content === 'string') {
          const m = entry.content.match(/You have\s+(\d+)\s+active subagent/);
          if (m) activeAgents = parseInt(m[1], 10) || 0;
        }

        if (Array.isArray(entry.tool_calls)) {
          for (const tc of entry.tool_calls) {
            const toolName = tc.name || tc.tool_name || tc.function?.name || '';
            const cat = TOOL_CATEGORIES[toolName];
            if (!cat) continue;

            toolCounts[cat]   = (toolCounts[cat] || 0) + 1;
            toolLastSeen[cat] = seqNum;

            if (toolName === 'run_command') shellCount++;
            if (toolName === 'manage_task' || toolName === 'schedule') taskCount++;

            if (toolName === 'invoke_subagent') {
              const args = tc.arguments || tc.args || {};
              const subs = args.Subagents || args.subagents;
              agentInvoked += Array.isArray(subs) ? subs.length : 1;
            }
          }
        }
      }
    }
  } catch (_) { /* transcript parsing is best-effort */ }

  shellCount   = Math.min(shellCount, 99);
  taskCount    = Math.min(taskCount, 99);
  agentInvoked = Math.min(agentInvoked, 99);
  if (activeAgents !== null) {
    activeAgents = Math.min(activeAgents, 99);
  }

  let agentCount = 0;
  if (Array.isArray(j.subagents) && j.subagents.length > 0) {
    agentCount = j.subagents.length;
  } else if (activeAgents !== null) {
    agentCount = activeAgents;
  } else {
    agentCount = agentInvoked;
  }
  agentCount = Math.min(agentCount, 99);

  // ─── SPINNER ───────────────────────────────────────────────────────────────────
  const isActive  = /working|tool|running|thinking|busy/i.test(state);
  let stateGlyph;
  if (!NO_SPINNER && isActive) {
    const frame = Math.floor(Date.now() / 120) % SPINNER_FRAMES.length;
    stateGlyph  = `${colorActive}${SPINNER_FRAMES[frame]}${R}`;
  } else {
    stateGlyph = isActive ? `${colorActive}${DOT}${R}` : `${colorSuccess}${DOT}${R}`;
  }

  // ─── LINE 1: Model │ repo git:(branch*) │ ● state ─────────────────────────────
  const stateColor = isActive ? colorActive : colorSuccess;
  const branchStr = branch
    ? (layout === 'tiny'
        ? ` ${colorLabel}(${colorGit}${branch}${dirty}${colorLabel})${R}`
        : ` ${colorLabel}git:(${colorGit}${branch}${dirty}${colorLabel})${R}`)
    : '';

  const SEP_PAD = ` ${colorSep}${SEP}${R} `;
  const line1Parts = [
    `${colorModel}${B}${displayModel}${R}`,
    `${colorRepo}${repo}${R}${branchStr}`,
    `${stateColor}${B}${stateGlyph}${R} ${stateColor}${B}${state}${R}`
  ];

  // Append Cost, Speed, RAM if minimal or essential
  if (config.preset === 'minimal' || config.preset === 'essential') {
    const extras = [];
    if (config.showCost && totalCost > 0) extras.push(`${colorSuccess}$${totalCost.toFixed(3)}${R}`);
    if (config.showSpeed && streamSpeed > 0) extras.push(`${colorActive}${streamSpeed.toFixed(1)} t/s${R}`);
    if (config.showMemory) extras.push(`${colorModel}RAM ${ram.pct}%${R}`);
    if (extras.length > 0) {
      line1Parts.push(extras.join(` ${colorSep}${SEP}${R} `));
    }
  }
  const line1 = line1Parts.join(SEP_PAD);

  // ─── LINE 2: ctx bar │ 5h bar │ wk bar ────────────────────────────────────────
  function quotaSegment(label, pct, resetSec, bLen) {
    const col   = quotaColor(pct);
    const reset = fmtReset(resetSec);
    const rStr  = reset ? ` ${colorLabel}${reset}${R}` : '';

    if (pct <= 0) {
      if (bLen <= 0) {
        return `${colorLabel}${label}${R} ${Red}${WARN} limit${R}${rStr}`;
      }
      return `${colorLabel}${label}${R} ${Red}${WARN} Limit reached${R}${rStr}`;
    }

    if (bLen <= 0) {
      return `${colorLabel}${label}${R} ${col}${pct}%${R}${rStr}`;
    }

    return `${colorLabel}${label}${R} ${col}${bar(pct, bLen)}${R} ${White}${pct}%${R}${rStr}`;
  }

  const ctxBarStr = barLen > 0 ? ` ${colorSuccess}${bar(ctxPct, barLen)}${R}` : '';
  let ctxLabel;
  if (layout === 'tiny') {
    ctxLabel = `${colorLabel}ctx${R} ${colorSuccess}${Math.round(ctxPct)}%${R} ${colorLabel}(${fmtNum(ctxIn)}${UP}/${fmtNum(ctxOut)}${DOWN})${R}`;
  } else {
    ctxLabel = `${colorLabel}ctx${R}${ctxBarStr} ${White}${B}${Math.round(ctxPct)}%${R}`
      + ` ${colorLabel}(${fmtNum(ctxIn)} ${UP} / ${fmtNum(ctxOut)} ${DOWN} / ${fmtNum(ctxSize)})${R}`;
  }

  const seg5h = quotaSegment('5h', q5hPct, q5h.reset_in_seconds, barLen);
  const segWk = quotaSegment('wk', qWkPct, qWk.reset_in_seconds, barLen);

  const line2Parts = [ctxLabel, seg5h, segWk];
  // Append Cost, Speed, RAM if full preset
  if (config.preset === 'full') {
    const extras = [];
    if (config.showCost && totalCost > 0) extras.push(`${colorSuccess}$${totalCost.toFixed(3)}${R}`);
    if (config.showSpeed && streamSpeed > 0) extras.push(`${colorActive}${streamSpeed.toFixed(1)} t/s${R}`);
    if (config.showMemory) extras.push(`${colorModel}RAM ${ram.pct}%${R}`);
    if (extras.length > 0) {
      line2Parts.push(extras.join(` ${colorSep}${SEP}${R} `));
    }
  }
  const line2 = line2Parts.join(SEP_PAD);

  // ─── LINE 3: Tool usage ───────────────────────────────────────────────────────
  const toolEntries = Object.keys(toolCounts).map(cat => ({
    cat,
    count: toolCounts[cat],
    last:  toolLastSeen[cat] || 0,
  }));

  toolEntries.sort((a, b) => b.last - a.last);
  const topTools = toolEntries.slice(0, toolMax);
  topTools.sort((a, b) => a.last - b.last);

  let line3;
  if (topTools.length > 0) {
    const parts = topTools.map(t => {
      if (layout === 'tiny') {
        return `${colorSuccess}${CHECK}${R}${White}${t.cat}${R}${colorLabel}${TIMES}${Math.min(t.count, 99)}${R}`;
      }
      return `${colorSuccess}${CHECK}${R} ${White}${t.cat}${R} ${colorLabel}${TIMES}${Math.min(t.count, 99)}${R}`;
    });
    line3 = parts.join(` ${colorSep}${SEP}${R} `) + ` ${colorSep}${SEP}${R}`;
  } else {
    line3 = `${colorLabel}--${R} ${colorSep}${SEP}${R}`;
  }

  // ─── LINE 4: auto mode │ shell │ tasks │ agents ───────────────────────────────
  const mode = j.auto_mode || j.planning_mode || j.automation_mode
    || j.approval_mode || j.mode || '--';

  let line4 = `${Mag}${FAST}${R} ${colorLabel}auto mode${R} ${White}${mode}${R}`
    + ` ${colorSuccess}${DOT}${R} ${White}${shellCount} shell${R}`;

  if (taskCount > 0) {
    line4 += ` ${colorSuccess}${DOT}${R} ${White}${taskCount} tasks${R}`;
  }

  line4 += ` ${colorSuccess}${DOT}${R} ${White}${agentCount} agents${R}`;

  // ─── OUTPUT PRESET-BASED RENDERING ─────────────────────────────────────────────
  if (config.preset === 'minimal') {
    process.stdout.write(line1 + '\n');
  } else if (config.preset === 'essential') {
    process.stdout.write(line1 + '\n');
    process.stdout.write(line2 + '\n');
  } else {
    process.stdout.write(line1 + '\n');
    process.stdout.write(line2 + '\n');
    process.stdout.write(line3 + '\n');
    process.stdout.write(line4 + '\n');
  }
}
