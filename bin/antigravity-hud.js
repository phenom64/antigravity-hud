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
const ENABLE_LINKS = process.env.AGY_HUD_LINKS   === '1';

// ─── UNICODE / ASCII GLYPHS ───────────────────────────────────────────────────
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
  if (pct >= 50) return colorQuotaHigh;
  if (pct >= 25) return colorQuotaMid;
  if (pct >= 15) return colorQuotaLow;
  return colorQuotaCritical;
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
  const val = value || fallback;
  if (!val) return '';
  if (typeof val === 'number') {
    return `\x1b[38;5;${val}m`;
  }
  if (typeof val === 'string') {
    if (val.startsWith('#') && val.length === 7) {
      const r = parseInt(val.slice(1, 3), 16);
      const g = parseInt(val.slice(3, 5), 16);
      const b = parseInt(val.slice(5, 7), 16);
      return `\x1b[38;2;${r};${g};${b}m`;
    }
    const nameColor = ANSI_BY_NAME[val.toLowerCase()];
    if (nameColor) return nameColor;
  }
  return fallback;
}

// ─── RESOLVED COLOURS ──────────────────────────────────────────────────────────
const colorModel   = resolveColor(config.colors.model, `${Cyan}`);
const colorRepo    = resolveColor(config.colors.project, `${Yellow}`);
const colorGit     = resolveColor(config.colors.git, '#9D7AFF');
const colorLabel   = resolveColor(config.colors.label, `${Gray}`);
const colorSep     = resolveColor(config.colors.separator, `${Yellow}`);
const colorActive  = resolveColor(config.colors.active, `${Cyan}`);
const colorSuccess = resolveColor(config.colors.success, `${Green}`);
const colorQuotaHigh = resolveColor(config.colors.quotaHigh, '#8EA2FF');
const colorQuotaMid  = resolveColor(config.colors.quotaMid, `${Yellow}`);
const colorQuotaLow  = resolveColor(config.colors.quotaLow, `${Orange}`);
const colorQuotaCritical = resolveColor(config.colors.quotaCritical, `${Red}`);
const colorAuto      = resolveColor(config.colors.auto, `${Orange}`);
const colorPermReview = resolveColor(config.colors.permissionReview, '#FFD166');
const colorPermAuto   = resolveColor(config.colors.permissionAuto,   `${Orange}`);
const colorPermBypass = resolveColor(config.colors.permissionBypass, '#FF3B8A');
const colorPermStrict = resolveColor(config.colors.permissionStrict, '#8EA2FF');

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

/**
 * Model pricing rates in USD per million tokens.
 * NOTE: This is an API-equivalent estimate only and may be stale.
 * These are conservative rates for cost approximation, not exact Antigravity billing.
 */
const MODEL_PRICING = {
  'opus': { input: 15.0, output: 75.0 },
  'sonnet': { input: 3.0, output: 15.0 },
  'haiku': { input: 0.8, output: 4.0 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-3.5-flash': { input: 0.075, output: 0.3 },
  'default': { input: 3.0, output: 15.0 } // conservative fallback
};

function estimateCost(modelName, inTokens, outTokens) {
  const modelLower = modelName.toLowerCase();
  let pricing = MODEL_PRICING['default'];

  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (key !== 'default' && modelLower.includes(key)) {
      pricing = val;
      break;
    }
  }

  const inputUsd = (inTokens / 1000000) * pricing.input;
  const outputUsd = (outTokens / 1000000) * pricing.output;
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

function saveTranscriptCache(statePath, tPath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      transcriptPath: tPath,
      transcriptMtime: Date.now()
    }, null, 2), 'utf8');
  } catch (_) {}
}

/** Locate the best transcript.jsonl to parse. */
function resolveTranscript(j) {
  // 0. AGY_HUD_TRANSCRIPT env override (handy for local testing)
  if (process.env.AGY_HUD_TRANSCRIPT) {
    try { if (fs.existsSync(process.env.AGY_HUD_TRANSCRIPT)) return process.env.AGY_HUD_TRANSCRIPT; } catch (_) {}
  }

  const statePath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-state.json');
  let cachedPath = null;

  // 1. Try reading state cache
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      cachedPath = state.transcriptPath;
    }
  } catch (_) {}

  // Check if cache is still valid
  if (cachedPath) {
    try {
      if (fs.existsSync(cachedPath)) {
        return cachedPath;
      }
    } catch (_) {
      cachedPath = null;
    }
  }

  // 2. Explicit path from payload
  if (j && j.transcript_path) {
    try {
      if (fs.existsSync(j.transcript_path)) {
        saveTranscriptCache(statePath, j.transcript_path);
        return j.transcript_path;
      }
    } catch (_) {}
  }

  // 3. Search common brain directories for newest transcript.jsonl
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
  const foundPath = all[0].path;

  saveTranscriptCache(statePath, foundPath);
  return foundPath;
}

/** Read only the last maxBytes of a file. */
function readLastBytes(filePath, maxBytes) {
  let fd;
  try {
    const stats = fs.statSync(filePath);
    const size = stats.size;
    if (size === 0) return '';

    fd = fs.openSync(filePath, 'r');
    const bytesToRead = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const position = size - bytesToRead;

    fs.readSync(fd, buffer, 0, bytesToRead, position);
    return buffer.toString('utf8');
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/** Map tool calls to structured categories. */
function categoriseTool(toolName) {
  if (!toolName) return 'tool';
  if (toolName.startsWith('mcp__')) return 'mcp';

  const name = toolName.toLowerCase();
  
  if (name.includes('browser') || name.includes('chrome') || name.includes('computer')) {
    return 'browser';
  }
  if (name.includes('read') || name.includes('view') || name.includes('list')) {
    return 'read';
  }
  if (name.includes('grep') || name.includes('search')) {
    return 'search';
  }
  if (name.includes('write') || name.includes('create')) {
    return 'write';
  }
  if (name.includes('edit') || name.includes('replace') || name.includes('patch')) {
    return 'edit';
  }
  if (name.includes('command') || name.includes('shell') || name.includes('bash') || name === 'run_command') {
    return 'bash';
  }
  if (['define_subagent', 'invoke_subagent', 'manage_subagents', 'send_message'].includes(name)) {
    return 'agent';
  }
  if (['manage_task', 'schedule'].includes(name)) {
    return 'task';
  }
  if (['ask_question', 'ask_permission'].includes(name)) {
    return 'ask';
  }
  if (name === 'generate_image') {
    return 'image';
  }
  return 'tool';
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
    try {
      backupSettings();
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
    ${White}antigravity-hud mode${R}        Show current Antigravity tool permission mode
    ${White}antigravity-hud mode next${R}   Cycle permission modes
    ${White}antigravity-hud mode <mode>${R}  Set mode to review, auto, yolo, or strict
    ${White}antigravity-hud bind-shift-tab${R} Bind Shift+Tab keyboard shortcut

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
  let resolvedTPath = null;

  try {
    const tPath = resolveTranscript(j);
    if (tPath) {
      resolvedTPath = tPath;
      const content = readLastBytes(tPath, 262144);
      const lines   = content.split('\n');
      if (lines.length > 1 && content.length >= 262144) {
        lines.shift();
      }

      for (const line of lines) {
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
            const cat = categoriseTool(toolName);

            toolCounts[cat]   = (toolCounts[cat] || 0) + 1;
            toolLastSeen[cat] = seqNum;

            const name = toolName.toLowerCase();
            if (name === 'run_command') shellCount++;
            if (name === 'manage_task' || name === 'schedule') taskCount++;

            if (name === 'invoke_subagent') {
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

  let repoText = repo;
  if (ENABLE_LINKS && project) {
    let projectUrl = project.replace(/\\/g, '/');
    if (!projectUrl.startsWith('/')) {
      projectUrl = '/' + projectUrl;
    }
    repoText = `\u001b]8;;file://${projectUrl}\u0007${repo}\u001b]8;;\u0007`;
  }

  const SEP_PAD = ` ${colorSep}${SEP}${R} `;
  const line1Parts = [
    `${colorModel}${B}${displayModel}${R}`,
    `${colorRepo}${repoText}${R}${branchStr}`,
    `${stateColor}${B}${stateGlyph}${R} ${stateColor}${B}${state}${R}`
  ];

  // Append Cost, Speed, RAM if minimal or essential
  if (config.preset === 'minimal' || config.preset === 'essential') {
    const extras = [];
    if (config.showCost && totalCost > 0) extras.push(`${colorSuccess}~$${totalCost.toFixed(3)}${R}`);
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

    return `${colorLabel}${label}${R} ${col}${bar(pct, bLen)}${R} ${col}${pct}%${R}${rStr}`;
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
    if (config.showCost && totalCost > 0) extras.push(`${colorSuccess}~$${totalCost.toFixed(3)}${R}`);
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
  let shellText = `${shellCount} shell`;
  if (ENABLE_LINKS && resolvedTPath) {
    let tUrl = resolvedTPath.replace(/\\/g, '/');
    if (!tUrl.startsWith('/')) {
      tUrl = '/' + tUrl;
    }
    shellText = `\u001b]8;;file://${tUrl}\u0007${shellCount} shell\u001b]8;;\u0007`;
  }

  const permMode = readPermissionMode();

  let permColor = colorPermReview;
  let permIcon = PAUSE;
  let permText = 'review';

  if (permMode === 'request-review') {
    permColor = colorPermReview;
    permIcon = PAUSE;
    permText = 'review';
  } else if (permMode === 'proceed-in-sandbox') {
    permColor = colorPermAuto;
    permIcon = FAST;
    permText = (layout === 'tiny') ? 'auto' : (layout === 'compact') ? 'auto' : 'auto mode';
  } else if (permMode === 'always-proceed') {
    permColor = colorPermBypass;
    permIcon = FAST;
    permText = (layout === 'tiny' || layout === 'compact') ? 'YOLO' : 'bypass permissions (YOLO)';
  } else if (permMode === 'strict') {
    permColor = colorPermStrict;
    permIcon = LOCK;
    permText = 'strict';
  }

  // Determine prefix: in tiny layout, we don't display icons or leading spaces
  const permSection = (layout === 'tiny') 
    ? `${permColor}${permText}${R}`
    : `${permColor}${permIcon} ${permText}${R}`;

  let line4 = `${permSection}`
    + ` ${colorSuccess}${DOT}${R} ${White}${shellText}${R}`;

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
