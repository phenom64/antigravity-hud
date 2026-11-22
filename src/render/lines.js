'use strict';
const { makeLink, toFileUrl } = require('../hyperlinks');
const { formatResetTime, formatDuration, getContextCapacity, resolveQuotaSegments, estimateCost } = require('../quota');

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

function resolveColor(value, fallback, noColor = false) {
  if (noColor) return '';
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

/** Format large numbers: 1.2m, 29.5k, or integer string. */
function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(Math.round(n));
}

/** Render a progress bar: filled + empty blocks, percentage clamped 0-100. */
function bar(pct, len, fullChar = '\u2588', emptyChar = '\u2591') {
  if (len <= 0) return '';
  pct = Math.max(0, Math.min(100, pct));
  let filled = Math.round((pct / 100) * len);
  if (pct > 0 && filled < 1) filled = 1;
  return fullChar.repeat(filled) + emptyChar.repeat(len - filled);
}

/**
 * Cross-platform basename that handles both Windows backslash and Unix forward
 * slash separators regardless of the host OS.
 */
function basenameAny(p) {
  if (!p) return '';
  const last = String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return last || String(p);
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
 * Map payload cycle_mode or settings permission mode value to canonical mode value.
 * Supports all 4 Antigravity Shift+Tab cycle states:
 * - "auto" -> "proceed-in-sandbox"
 * - "accept-edits" -> "accept-edits"
 * - "plan" -> "plan"
 * - "" (omitted) -> fallbackMode from settings.json ("request-review", "always-proceed", "strict", etc.)
 */
function resolvePermissionMode(payload, fallbackMode = 'request-review') {
  const normalize = (val) => {
    const s = String(val || '').toLowerCase().trim();
    if (s === 'auto' || s === 'proceed-in-sandbox') return 'proceed-in-sandbox';
    if (s === 'accept-edits' || s === 'accept_edits' || s === 'acceptedits' || s === 'edits') return 'accept-edits';
    if (s === 'plan' || s === 'plan-mode' || s === 'plan_mode') return 'plan';
    if (s === 'review' || s === 'request-review') return 'request-review';
    if (s === 'yolo' || s === 'bypass' || s === 'always-proceed') return 'always-proceed';
    if (s === 'strict') return 'strict';
    return '';
  };

  if (payload && payload.cycle_mode) {
    const fromCycle = normalize(payload.cycle_mode);
    if (fromCycle) return fromCycle;
  }

  return normalize(fallbackMode) || fallbackMode || 'request-review';
}

/**
 * Render the 1-, 2-, or 4-line ANSI HUD for the Antigravity CLI.
 */
function renderHUD(payload = {}, config = {}, transcriptData = {}, options = {}) {
  const j = payload || {};
  const cfg = config || {};
  const tData = transcriptData || {};

  const noColor = Boolean(options.noColor || process.env.AGY_HUD_NO_COLOR === '1' || cfg.colorMode === false);
  const noUnicode = Boolean(options.noUnicode || process.env.AGY_HUD_NO_UNICODE === '1' || cfg.unicodeMode === false);
  const noSpinner = Boolean(options.noSpinner || process.env.AGY_HUD_NO_SPINNER === '1');
  const enableLinks = options.enableLinks != null
    ? Boolean(options.enableLinks)
    : (process.env.AGY_HUD_LINKS === '1' || (process.env.AGY_HUD_LINKS !== '0' && cfg.enableLinks !== false));

  let SEP = '\u2502', DOT = '\u25CF', UP = '\u2191', DOWN = '\u2193';
  let FAST = '\u23E9', PLAY_DOUBLE = '\u23F5\u23F5', WARN = '\u26A0', CHECK = '\u2714', TIMES = '\u00D7';
  let FULL = '\u2588', EMPTY = '\u2591';
  let PAUSE = '\u23F8', LOCK = '\uD83D\uDD12';
  let SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

  if (noUnicode) {
    SEP = '|'; DOT = '*'; UP = '^'; DOWN = 'v';
    FAST = '>>'; PLAY_DOUBLE = '>>'; WARN = '!'; CHECK = '+'; TIMES = 'x';
    FULL = '#'; EMPTY = '.';
    PAUSE = '||'; LOCK = '[lock]';
    SPINNER_FRAMES = ['|', '/', '-', '\\'];
  }

  let R = '\x1b[0m', B = '\x1b[1m';
  let Green = '\x1b[92m', Yellow = '\x1b[93m', Cyan = '\x1b[96m';
  let Gray = '\x1b[90m', White = '\x1b[97m', Red = '\x1b[91m';
  let Amber = '\x1b[93m', Orange = '\x1b[38;5;208m';

  if (noColor) {
    R = B = Green = Yellow = Cyan = Gray = White = Red = Amber = Orange = '';
  }

  const colors = cfg.colors || {};
  const colorModel = resolveColor(colors.model, Cyan, noColor);
  const colorRepo = resolveColor(colors.project, Yellow, noColor);
  const colorGit = resolveColor(colors.git, '#9D7AFF', noColor);
  const colorLabel = resolveColor(colors.label, Gray, noColor);
  const colorSep = resolveColor(colors.separator, Yellow, noColor);
  const colorActive = resolveColor(colors.active, Cyan, noColor);
  const colorSuccess = resolveColor(colors.success, Green, noColor);
  const colorQuotaHigh = resolveColor(colors.quotaHigh, '#8EA2FF', noColor);
  const colorQuotaMid = resolveColor(colors.quotaMid, Yellow, noColor);
  const colorQuotaLow = resolveColor(colors.quotaLow, Orange, noColor);
  const colorQuotaCritical = resolveColor(colors.quotaCritical, Red, noColor);
  const colorPermReview = resolveColor(colors.permissionReview, '#FFD166', noColor);
  const colorPermAuto = resolveColor(colors.permissionAuto, Orange, noColor);
  const colorPermAcceptEdits = resolveColor(colors.permissionAcceptEdits, '#C4A7FF', noColor);
  const colorPermPlan = resolveColor(colors.permissionPlan, '#2DD4BF', noColor);
  const colorPermBypass = resolveColor(colors.permissionBypass, '#FF3B8A', noColor);
  const colorPermStrict = resolveColor(colors.permissionStrict, '#8EA2FF', noColor);

  function quotaColor(pct) {
    if (pct >= 50) return colorQuotaHigh;
    if (pct >= 25) return colorQuotaMid;
    if (pct >= 15) return colorQuotaLow;
    return colorQuotaCritical;
  }

  /** Context usage shifts Green -> Yellow (>=50%) -> Orange (>=70%) -> Red (>=85%) as it fills up. */
  function contextColor(usedPct) {
    if (usedPct >= 85) return colorQuotaCritical;
    if (usedPct >= 70) return colorQuotaLow;
    if (usedPct >= 50) return colorQuotaMid;
    return colorSuccess;
  }

  // ─── DATA EXTRACTION ──────────────────────────────────────────────────────────
  const model = (typeof j.model === 'object' && j.model !== null)
    ? (j.model.display_name || j.model.id || 'unknown model')
    : (j.model || j.model_name || 'unknown model');
  const project = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || process.cwd();
  const repo = basenameAny(project);
  const cols = j.terminal_width || 120;
  const state = j.agent_state || 'idle';

  const ctxIn = dig(j, 'context_window', 'total_input_tokens') ?? j.context_used ?? j.tokens_used ?? 0;
  const ctxOut = dig(j, 'context_window', 'total_output_tokens') ?? 0;
  const ctxSize = dig(j, 'context_window', 'context_window_size') || j.context_capacity || getContextCapacity(model);
  const rawPct = dig(j, 'context_window', 'used_percentage');
  const ctxPct = rawPct != null ? rawPct : Math.min(100, ((ctxIn + ctxOut) / Math.max(1, ctxSize)) * 100);
  const cacheReadTokens = dig(j, 'context_window', 'current_usage', 'cache_read_input_tokens') || 0;

  const totalCost = options.cost != null ? options.cost : estimateCost(model, ctxIn, ctxOut, cacheReadTokens);
  const streamSpeed = options.speed != null ? options.speed : 0;

  // ─── LAYOUT ───────────────────────────────────────────────────────────────────
  let layout = cols >= 118 ? 'normal' : cols >= 92 ? 'compact' : 'tiny';
  const envLayout = options.layout || process.env.AGY_HUD_LAYOUT;
  if (envLayout && /^(normal|compact|tiny)$/.test(envLayout)) {
    layout = envLayout;
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

  const rawToolMax = options.toolMax || process.env.AGY_HUD_TOOL_MAX;
  if (rawToolMax) {
    const parsed = parseInt(rawToolMax, 10);
    if (parsed > 0) toolMax = parsed;
  }

  // ─── MODEL NAME SHORTENING (tiny layout) ──────────────────────────────────────
  let displayModel = String(model);
  if (layout === 'tiny') {
    displayModel = displayModel
      .replace(/^Gemini\s*/i, 'G')
      .replace(/^Claude\s+Opus/i, 'Opus')
      .replace(/^Claude\s+Sonnet/i, 'Sonnet')
      .replace(/^Claude\s+Haiku/i, 'Haiku')
      .replace(/\s*\((XHigh|High|Medium|Low|Thinking|Orchestrator|Max)\)/gi, (_, m) => {
        const u = m.toLowerCase();
        if (u === 'xhigh') return ' (XH)';
        if (u === 'orchestrator') return ' (Orch)';
        if (u === 'max') return ' (Max)';
        return ` (${m[0].toUpperCase()})`;
      });
  }

  // ─── GIT & HYPERLINKS ─────────────────────────────────────────────────────────
  const branch = options.gitBranch != null ? options.gitBranch : '';
  const dirty = options.gitDirty ? '*' : '';
  const ahead = Number(options.gitAhead) || 0;
  const behind = Number(options.gitBehind) || 0;
  const gitRepoUrl = options.gitRepoUrl || '';

  let abStr = '';
  if (ahead > 0) abStr += ` ${UP}${ahead}`;
  if (behind > 0) abStr += ` ${DOWN}${behind}`;

  let branchText = branch ? `${branch}${dirty}${abStr}` : '';
  if (enableLinks && branch) {
    const linkUrl = gitRepoUrl || toFileUrl(project);
    branchText = makeLink(branchText, linkUrl, true);
  }

  const branchStr = branch
    ? (layout === 'tiny'
        ? ` ${colorLabel}(${colorGit}${branchText}${colorLabel})${R}`
        : ` ${colorLabel}git:(${colorGit}${branchText}${colorLabel})${R}`)
    : '';

  const repoText = (enableLinks && project) ? makeLink(repo, toFileUrl(project), true) : repo;

  // ─── SPINNER & STATE ──────────────────────────────────────────────────────────
  const isActive = /working|tool|running|thinking|busy/i.test(state);
  let stateGlyph;
  if (!noSpinner && isActive) {
    const frame = Math.floor(Date.now() / 120) % SPINNER_FRAMES.length;
    stateGlyph = `${colorActive}${SPINNER_FRAMES[frame]}${R}`;
  } else {
    stateGlyph = isActive ? `${colorActive}${DOT}${R}` : `${colorSuccess}${DOT}${R}`;
  }

  const stateColor = isActive ? colorActive : colorSuccess;
  let stateSegment = `${stateColor}${B}${stateGlyph}${R} ${stateColor}${B}${state}${R}`;
  if (j.tool_confirmation_pending === true) {
    stateSegment += ` ${Amber}${WARN} confirm${R}`;
  }

  const SEP_PAD = ` ${colorSep}${SEP}${R} `;
  const line1Parts = [
    `${colorModel}${B}${displayModel}${R}`,
    `${colorRepo}${repoText}${R}${branchStr}`,
    stateSegment
  ];

  const showCost = cfg.showCost !== false;
  const showSpeed = cfg.showSpeed !== false;

  if (cfg.preset === 'minimal' || cfg.preset === 'essential') {
    const extras = [];
    if (showCost && totalCost > 0) extras.push(`${colorSuccess}~$${totalCost.toFixed(3)}${R}`);
    if (showSpeed && streamSpeed > 0) extras.push(`${colorActive}${streamSpeed.toFixed(1)} t/s${R}`);
    if (extras.length > 0) {
      line1Parts.push(extras.join(SEP_PAD));
    }
  }
  const line1 = line1Parts.join(SEP_PAD);

  // ─── LINE 2: ctx bar │ quota bars ─────────────────────────────────────────────
  function quotaSegment(label, pct, resetSec, bLen) {
    const col = quotaColor(pct);
    const reset = formatResetTime(resetSec);
    const rStr = reset ? ` ${colorLabel}${reset}${R}` : '';

    if (pct <= 0) {
      if (bLen <= 0) {
        return `${colorLabel}${label}${R} ${Red}${WARN} limit${R}${rStr}`;
      }
      return `${colorLabel}${label}${R} ${Red}${WARN} Limit reached${R}${rStr}`;
    }

    if (bLen <= 0) {
      return `${colorLabel}${label}${R} ${col}${pct}%${R}${rStr}`;
    }

    return `${colorLabel}${label}${R} ${col}${bar(pct, bLen, FULL, EMPTY)}${R} ${col}${pct}%${R}${rStr}`;
  }

  const ctxCol = contextColor(ctxPct);
  const ctxBarStr = barLen > 0 ? ` ${ctxCol}${bar(ctxPct, barLen, FULL, EMPTY)}${R}` : '';
  let ctxLabel;
  if (layout === 'tiny') {
    ctxLabel = `${colorLabel}ctx${R} ${ctxCol}${Math.round(ctxPct)}%${R} ${colorLabel}(${fmtNum(ctxIn)}${UP}/${fmtNum(ctxOut)}${DOWN})${R}`;
  } else {
    ctxLabel = `${colorLabel}ctx${R}${ctxBarStr} ${White}${B}${Math.round(ctxPct)}%${R}`
      + ` ${colorLabel}(${fmtNum(ctxIn)} ${UP} / ${fmtNum(ctxOut)} ${DOWN} / ${fmtNum(ctxSize)})${R}`;
  }

  const quotaSegments = resolveQuotaSegments(j);
  const quotaParts = quotaSegments.map(seg =>
    quotaSegment(seg.label, seg.pct, seg.resetSeconds, barLen)
  );

  const line2Parts = [ctxLabel, ...quotaParts];
  if (!cfg.preset || cfg.preset === 'full') {
    const extras = [];
    if (showCost && totalCost > 0) extras.push(`${colorSuccess}~$${totalCost.toFixed(3)}${R}`);
    if (showSpeed && streamSpeed > 0) extras.push(`${colorActive}${streamSpeed.toFixed(1)} t/s${R}`);
    if (extras.length > 0) {
      line2Parts.push(extras.join(SEP_PAD));
    }
  }
  const line2 = line2Parts.join(SEP_PAD);

  // ─── LINE 3: Tool usage ───────────────────────────────────────────────────────
  const toolCounts = tData.toolCounts || {};
  const toolLastSeen = tData.toolLastSeen || {};
  const toolEntries = Object.keys(toolCounts).map((cat, idx) => ({
    cat,
    count: toolCounts[cat],
    last: toolLastSeen[cat] != null ? toolLastSeen[cat] : (idx + 1),
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
    line3 = parts.join(SEP_PAD) + ` ${colorSep}${SEP}${R}`;
  } else {
    line3 = `${colorLabel}--${R} ${colorSep}${SEP}${R}`;
  }

  // ─── LINE 4: permission mode │ shell │ tasks │ agents [│ plan │ skills │ mcp │ duration] ─
  const shellCount = Math.min(tData.shellCount || 0, 99);
  const taskCount = Math.min(tData.taskCount != null ? tData.taskCount : (j.task_count || 0), 99);

  let agentCount = 0;
  if (Array.isArray(j.subagents) && j.subagents.length > 0) {
    agentCount = j.subagents.length;
  } else if (tData.activeAgents != null) {
    agentCount = tData.activeAgents;
  } else if (Array.isArray(tData.activeSubagents) && tData.activeSubagents.length > 0 && tData.agentInvoked == null) {
    agentCount = tData.activeSubagents.length;
  } else {
    agentCount = tData.agentInvoked || 0;
  }
  agentCount = Math.min(agentCount, 99);

  const resolvedTPath = options.transcriptPath || j.transcript_path || null;
  let shellText = `${shellCount} shell`;
  if (enableLinks && resolvedTPath) {
    shellText = makeLink(shellText, toFileUrl(resolvedTPath), true);
  }

  const permMode = resolvePermissionMode(j, options.permissionMode || 'request-review');

  let permColor = colorPermReview;
  let permIcon = PAUSE;
  let permText = 'review mode on';

  if (permMode === 'request-review') {
    permColor = colorPermReview;
    permIcon = PAUSE;
    permText = (layout === 'tiny' || layout === 'compact') ? 'review on' : 'review mode on';
  } else if (permMode === 'proceed-in-sandbox') {
    permColor = colorPermAuto;
    permIcon = FAST;
    permText = (layout === 'tiny' || layout === 'compact') ? 'auto on' : 'auto mode on';
  } else if (permMode === 'accept-edits') {
    permColor = colorPermAcceptEdits;
    permIcon = PLAY_DOUBLE;
    permText = (layout === 'tiny') ? 'edits on' : 'accept edits on';
  } else if (permMode === 'plan') {
    permColor = colorPermPlan;
    permIcon = PAUSE;
    permText = (layout === 'tiny') ? 'plan on' : 'plan mode on';
  } else if (permMode === 'always-proceed') {
    permColor = colorPermBypass;
    permIcon = FAST;
    permText = (layout === 'tiny' || layout === 'compact') ? 'YOLO' : 'bypass permissions (YOLO)';
  } else if (permMode === 'strict') {
    permColor = colorPermStrict;
    permIcon = LOCK;
    permText = (layout === 'tiny' || layout === 'compact') ? 'strict on' : 'strict mode on';
  }

  const permSection = (layout === 'tiny')
    ? `${permColor}${permText}${R}`
    : `${permColor}${permIcon} ${permText}${R}`;

  let line4 = `${permSection}`
    + ` ${colorSuccess}${DOT}${R} ${White}${shellText}${R}`;

  if (taskCount > 0) {
    line4 += ` ${colorSuccess}${DOT}${R} ${White}${taskCount} tasks${R}`;
  }

  let agentLabel = `${agentCount} agents`;
  if (
    agentCount > 0 &&
    cfg.showSubagents !== false &&
    layout === 'normal' &&
    Array.isArray(tData.activeSubagents) &&
    tData.activeSubagents.length > 0
  ) {
    const latestSub = tData.activeSubagents[tData.activeSubagents.length - 1];
    const subElapsed = latestSub.elapsedSeconds != null
      ? latestSub.elapsedSeconds
      : (latestSub.startTime ? Math.max(0, Math.floor((Date.now() - new Date(latestSub.startTime).getTime()) / 1000)) : 0);
    const subDur = formatDuration(subElapsed);
    const roleDetail = subDur ? `${latestSub.role} ${subDur}` : latestSub.role;
    agentLabel += ` ${colorLabel}(${roleDetail})${R}`;
  }
  line4 += ` ${colorSuccess}${DOT}${R} ${White}${agentLabel}${R}`;

  if (cfg.showTodos !== false && tData.planProgress && tData.planProgress.total > 0 && layout !== 'tiny') {
    line4 += ` ${colorSuccess}${DOT}${R} ${White}${tData.planProgress.done}/${tData.planProgress.total} plan${R}`;
  }

  if (cfg.showSkills !== false && Array.isArray(tData.skills) && tData.skills.length > 0 && layout !== 'tiny') {
    line4 += ` ${colorSuccess}${DOT}${R} ${White}${tData.skills.length} skills${R}`;
  }

  if (cfg.showMcp !== false && Array.isArray(tData.mcpServers) && tData.mcpServers.length > 0 && layout !== 'tiny') {
    line4 += ` ${colorSuccess}${DOT}${R} ${White}${tData.mcpServers.length} mcp${R}`;
  }

  if (dig(j, 'sandbox', 'enabled') === true) {
    line4 += ` ${colorSuccess}${DOT}${R} ${colorPermStrict}sandbox${R}`;
  }

  const sessionSec = options.sessionDurationSeconds != null
    ? options.sessionDurationSeconds
    : (tData.sessionDurationSeconds || 0);
  if (sessionSec > 0 && layout !== 'tiny') {
    const durStr = formatDuration(sessionSec);
    if (durStr) {
      line4 += ` ${colorSuccess}${DOT}${R} ${colorLabel}${durStr}${R}`;
    }
  }

  if (cfg.preset === 'minimal') return [line1];
  if (cfg.preset === 'essential') return [line1, line2];
  return [line1, line2, line3, line4];
}

module.exports = {
  renderHUD,
  bar,
  fmtNum,
  basenameAny,
  resolveColor,
  ANSI_BY_NAME,
  resolvePermissionMode
};
