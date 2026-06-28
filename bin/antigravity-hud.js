#!/usr/bin/env node
'use strict';

// ─── antigravity-hud.js ────────────────────────────────────────────────────────
// Cross-platform Node.js CLI – reads JSON from stdin, outputs a 4-line ANSI HUD.
// Zero npm dependencies.  Only Node.js built-ins.
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

// ─── READ STDIN ────────────────────────────────────────────────────────────────
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { /* empty stdin */ }

let j = {};
try { j = JSON.parse(raw); } catch (_) { /* bad JSON, proceed with defaults */ }

// ─── SAVE RAW JSON (best-effort) ──────────────────────────────────────────────
try {
  const saveDir = path.join(os.homedir(), '.gemini', 'antigravity-cli');
  fs.mkdirSync(saveDir, { recursive: true });
  fs.writeFileSync(path.join(saveDir, 'statusline-last.json'), raw || '{}');
} catch (_) { /* don't crash */ }

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
const q5hPct = Math.round((q5h.remaining_fraction || 0) * 100);
const qWkPct = Math.round((qWk.remaining_fraction || 0) * 100);

// ─── TRANSCRIPT PARSING ───────────────────────────────────────────────────────

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
function resolveTranscript() {
  // 0. AGY_HUD_TRANSCRIPT env override (handy for local testing)
  if (process.env.AGY_HUD_TRANSCRIPT) {
    try { if (fs.existsSync(process.env.AGY_HUD_TRANSCRIPT)) return process.env.AGY_HUD_TRANSCRIPT; } catch (_) {}
  }
  // 1. Explicit path from payload
  if (j.transcript_path) {
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

// Parse transcript for tool usage
const toolCounts   = {};  // category → count
const toolLastSeen = {};  // category → sequence number
let shellCount   = 0;
let taskCount    = j.task_count || 0;
let agentInvoked = 0;
let activeAgents = 0;
let seqNum       = 0;

try {
  const tPath = resolveTranscript();
  if (tPath) {
    const content = fs.readFileSync(tPath, 'utf8');
    const lines   = content.split('\n');
    // Take last 320 lines
    const slice   = lines.slice(Math.max(0, lines.length - 320));

    for (const line of slice) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      seqNum++;

      // Check for active subagent count in content
      if (entry.content && typeof entry.content === 'string') {
        const m = entry.content.match(/You have\s+(\d+)\s+active subagent/);
        if (m) activeAgents = parseInt(m[1], 10) || 0;
      }

      // Process tool_calls
      if (Array.isArray(entry.tool_calls)) {
        for (const tc of entry.tool_calls) {
          const toolName = tc.name || tc.tool_name || tc.function?.name || '';
          const cat = TOOL_CATEGORIES[toolName];
          if (!cat) continue;

          toolCounts[cat]   = (toolCounts[cat] || 0) + 1;
          toolLastSeen[cat] = seqNum;

          if (toolName === 'run_command') shellCount++;
          if (toolName === 'manage_task' || toolName === 'schedule') taskCount++;

          if (toolName === 'define_subagent') agentInvoked++;
          if (toolName === 'invoke_subagent') {
            // Count Subagents array length if present
            const args = tc.arguments || tc.args || {};
            const subs = args.Subagents || args.subagents;
            agentInvoked += Array.isArray(subs) ? subs.length : 1;
          }
        }
      }
    }
  }
} catch (_) { /* transcript parsing is best-effort */ }

// Cap counts
shellCount   = Math.min(shellCount, 99);
taskCount    = Math.min(taskCount, 99);
agentInvoked = Math.min(agentInvoked, 99);
activeAgents = Math.min(activeAgents, 99);

// Agent count priority: j.subagents?.length > activeAgents > agentInvoked > 0
let agentCount = 0;
if (Array.isArray(j.subagents) && j.subagents.length > 0) {
  agentCount = j.subagents.length;
} else if (activeAgents > 0) {
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

const quotaStyle = layout === 'tiny' ? 'tiny' : 'bar';
const seg5h = quotaSegment('5h', q5hPct, q5h.reset_in_seconds, barLen);
const segWk = quotaSegment('wk', qWkPct, qWk.reset_in_seconds, barLen);

const line2 = `${ctxLabel}${SEP_PAD}${seg5h}${SEP_PAD}${segWk}`;

// ─── LINE 3: Tool usage ───────────────────────────────────────────────────────
const toolEntries = Object.keys(toolCounts).map(cat => ({
  cat,
  count: toolCounts[cat],
  last:  toolLastSeen[cat] || 0,
}));

// Sort by last-seen descending, take top toolMax, then re-sort ascending
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
