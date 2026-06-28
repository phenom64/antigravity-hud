#!/usr/bin/env node
'use strict';

// ─── antigravity-hud.js ────────────────────────────────────────────────────────
// Cross-platform Node.js CLI - reads JSON from stdin, outputs a 4-line ANSI HUD.
// Zero npm dependencies. Only Node.js built-ins.
// ────────────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execFileSync } = require('child_process');

// ─── ENV FLAGS ─────────────────────────────────────────────────────────────────
const NO_COLOR   = process.env.AGY_HUD_NO_COLOR   === '1';
const NO_UNICODE = process.env.AGY_HUD_NO_UNICODE === '1';
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

function runHelp() {
  console.log(`
  ${B}${Cyan}antigravity-hud${R}

  Usage:
    ${White}antigravity-hud${R}           Read statusline JSON from stdin and render the HUD (default)
    ${White}antigravity-hud install${R}   Configure Antigravity CLI settings to use this HUD
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
    stateGlyph  = `${Cyan}${SPINNER_FRAMES[frame]}${R}`;
  } else {
    stateGlyph = isActive ? `${Cyan}${DOT}${R}` : `${Green}${DOT}${R}`;
  }

  // ─── LINE 1: Model │ repo git:(branch*) │ ● state ─────────────────────────────
  const stateColor = isActive ? Cyan : Green;
  const branchStr = branch
    ? (layout === 'tiny'
        ? ` ${Gray}(${Blue}${branch}${dirty}${Gray})${R}`
        : ` ${Gray}git:(${Blue}${branch}${dirty}${Gray})${R}`)
    : '';

  const SEP_PAD = ` ${SEP} `;
  const line1 = `${Cyan}${B}${displayModel}${R}${SEP_PAD}${Yellow}${repo}${R}${branchStr}`
    + `${SEP_PAD}${stateColor}${B}${stateGlyph}${R} ${stateColor}${B}${state}${R}`;

  // ─── LINE 2: ctx bar │ 5h bar │ wk bar ────────────────────────────────────────
  function quotaSegment(label, pct, resetSec, bLen) {
    const col   = quotaColor(pct);
    const reset = fmtReset(resetSec);
    const rStr  = reset ? ` ${Gray}${reset}${R}` : '';

    if (pct <= 0) {
      if (bLen <= 0) {
        return `${Gray}${label}${R} ${Red}${WARN} limit${R}${rStr}`;
      }
      return `${Gray}${label}${R} ${Red}${WARN} Limit reached${R}${rStr}`;
    }

    if (bLen <= 0) {
      return `${Gray}${label}${R} ${col}${pct}%${R}${rStr}`;
    }

    return `${Gray}${label}${R} ${col}${bar(pct, bLen)}${R} ${White}${pct}%${R}${rStr}`;
  }

  const ctxBarStr = barLen > 0 ? ` ${Green}${bar(ctxPct, barLen)}${R}` : '';
  let ctxLabel;
  if (layout === 'tiny') {
    ctxLabel = `${Gray}ctx${R} ${Green}${Math.round(ctxPct)}%${R} ${Gray}(${fmtNum(ctxIn)}${UP}/${fmtNum(ctxOut)}${DOWN})${R}`;
  } else {
    ctxLabel = `${Gray}ctx${R}${ctxBarStr} ${White}${B}${Math.round(ctxPct)}%${R}`
      + ` ${Gray}(${fmtNum(ctxIn)} ${UP} / ${fmtNum(ctxOut)} ${DOWN} / ${fmtNum(ctxSize)})${R}`;
  }

  const seg5h = quotaSegment('5h', q5hPct, q5h.reset_in_seconds, barLen);
  const segWk = quotaSegment('wk', qWkPct, qWk.reset_in_seconds, barLen);

  const line2 = `${ctxLabel}${SEP_PAD}${seg5h}${SEP_PAD}${segWk}`;

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
        return `${Green}${CHECK}${R}${White}${t.cat}${R}${Gray}${TIMES}${Math.min(t.count, 99)}${R}`;
      }
      return `${Green}${CHECK}${R} ${White}${t.cat}${R} ${Gray}${TIMES}${Math.min(t.count, 99)}${R}`;
    });
    line3 = parts.join(` ${Yellow}${SEP}${R} `) + ` ${Yellow}${SEP}${R}`;
  } else {
    line3 = `${Gray}--${R} ${Yellow}${SEP}${R}`;
  }

  // ─── LINE 4: auto mode │ shell │ tasks │ agents ───────────────────────────────
  const mode = j.auto_mode || j.planning_mode || j.automation_mode
    || j.approval_mode || j.mode || '--';

  let line4 = `${Mag}${FAST}${R} ${Gray}auto mode${R} ${White}${mode}${R}`
    + ` ${Green}${DOT}${R} ${White}${shellCount} shell${R}`;

  if (taskCount > 0) {
    line4 += ` ${Green}${DOT}${R} ${White}${taskCount} tasks${R}`;
  }

  line4 += ` ${Green}${DOT}${R} ${White}${agentCount} agents${R}`;

  // ─── OUTPUT ────────────────────────────────────────────────────────────────────
  process.stdout.write(line1 + '\n');
  process.stdout.write(line2 + '\n');
  process.stdout.write(line3 + '\n');
  process.stdout.write(line4 + '\n');
}
