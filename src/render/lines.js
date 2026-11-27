'use strict';
const path = require('path');
const os = require('os');
const { makeLink, toFileUrl } = require('../hyperlinks');
const {
  formatResetTime,
  formatDuration,
  getContextCapacity,
  parseAutoCompactOverride,
  resolveQuotaSegments,
  resolveCost
} = require('../quota');

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

function truncateText(text, maxLen) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, Math.max(1, maxLen - 1)).trimEnd() + '\u2026';
}

function shortModelElement(modelLabel) {
  if (!modelLabel) return '';
  const s = String(modelLabel).trim();
  const m = s.match(/gemini\s*4\s*([a-z]+)/i);
  if (m) return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  const claude = s.match(/claude\s+(opus|sonnet|haiku)(?:\s+[\d.]+)?/i);
  if (claude) return claude[0].replace(/^claude\s+/i, '');
  return s.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function formatEffortLabel(effort) {
  const e = String(effort || '').toLowerCase().trim();
  if (e === 'xhigh') return 'XHigh';
  if (e === 'high') return 'High';
  if (e === 'medium') return 'Medium';
  if (e === 'low') return 'Low';
  if (e === 'max') return 'Max';
  return effort ? String(effort) : '';
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
  let CROSS = '\u2716', FULL = '\u2588', EMPTY = '\u2591';
  let PAUSE = '\u23F8', STOP = '\u25A0', BOLT = '\u26A1', ARROW = '\u2192';
  let PACE_UP = '\u21E1', PACE_DOWN = '\u21E3', HOURGLASS = '\u23F3';
  let SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

  if (noUnicode) {
    SEP = '|'; DOT = '*'; UP = '^'; DOWN = 'v';
    FAST = '>>'; PLAY_DOUBLE = '>>'; WARN = '!'; CHECK = '+'; TIMES = 'x';
    CROSS = 'x'; FULL = '#'; EMPTY = '.';
    PAUSE = '||'; STOP = '[]'; BOLT = 'c:'; ARROW = '->';
    PACE_UP = '+'; PACE_DOWN = '-'; HOURGLASS = 'Q:';
    SPINNER_FRAMES = ['|', '/', '-', '\\'];
  }

  let R = '\x1b[0m', B = '\x1b[1m';
  let Green = '\x1b[92m', Yellow = '\x1b[93m', Cyan = '\x1b[96m';
  let Gray = '\x1b[90m', White = '\x1b[97m', Red = '\x1b[91m';
  let Amber = '\x1b[93m', Orange = '\x1b[38;5;208m', Magenta = '\x1b[95m';

  if (noColor) {
    R = B = Green = Yellow = Cyan = Gray = White = Red = Amber = Orange = Magenta = '';
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
  const modelEffort = (typeof j.model === 'object' && j.model !== null && j.model.effort)
    ? String(j.model.effort)
    : '';
  const project = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || process.cwd();
  const repo = basenameAny(project);
  const cols = j.terminal_width || 120;
  const state = j.agent_state || 'idle';
  const convId = j.conversation_id || j.session_id || '';

  const ctxIn = dig(j, 'context_window', 'total_input_tokens') ?? j.context_used ?? j.tokens_used ?? 0;
  const ctxOut = dig(j, 'context_window', 'total_output_tokens') ?? 0;
  const ctxSize = dig(j, 'context_window', 'context_window_size') || j.context_capacity || getContextCapacity(model);
  const rawPct = dig(j, 'context_window', 'used_percentage');
  const ctxPct = rawPct != null ? rawPct : Math.min(100, ((ctxIn + ctxOut) / Math.max(1, ctxSize)) * 100);
  const currentInTokens = dig(j, 'context_window', 'current_usage', 'input_tokens') || 0;
  const cacheCreateTokens = dig(j, 'context_window', 'current_usage', 'cache_creation_input_tokens') || 0;
  const cacheReadTokens = dig(j, 'context_window', 'current_usage', 'cache_read_input_tokens') || 0;

  // Auto-compaction override (CLI v1.5.15+ AGY_CLI_AUTO_COMPACT_OVERRIDE)
  const rawCompactOverride = options.autoCompactOverride !== undefined
    ? options.autoCompactOverride
    : process.env.AGY_CLI_AUTO_COMPACT_OVERRIDE;
  const compactThreshold = parseAutoCompactOverride(rawCompactOverride, ctxSize);
  const usedApproxTokens = rawPct != null ? Math.round((ctxPct / 100) * ctxSize) : (ctxIn + ctxOut);
  const compactPct = compactThreshold ? Math.min(100, (usedApproxTokens / compactThreshold) * 100) : null;

  // Native cost (CLI v1.4+) with fallback to estimateCost()
  const costInfo = options.cost != null
    ? { totalUsd: options.cost, subagentUsd: 0, estimated: true, fromPayload: false }
    : resolveCost(j, model, ctxIn, ctxOut, cacheReadTokens);
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

  // ─── MODEL NAME, EFFORT, ORCHESTRATOR & CUSTOM AGENT ──────────────────────────
  let displayModel = String(model);

  // Append effort badge when payload supplies model.effort and display_name doesn't already include it
  if (modelEffort) {
    const effortLabel = formatEffortLabel(modelEffort);
    if (effortLabel && !new RegExp(`\\b${effortLabel}\\b`, 'i').test(displayModel)) {
      displayModel = `${displayModel} (${effortLabel})`;
    }
  }

  // Orchestrator Planner -> Executor enrichment from settings.json (normal layout)
  if (
    layout === 'normal' &&
    options.orchestrator &&
    typeof options.orchestrator === 'object' &&
    /orchestrator/i.test(displayModel) &&
    !displayModel.includes(ARROW) &&
    !displayModel.includes('->')
  ) {
    const plannerRaw = options.orchestrator.planner || options.orchestrator.plannerModel || '';
    const executorRaw = options.orchestrator.executor || options.orchestrator.executorModel || '';
    const plannerShort = shortModelElement(plannerRaw);
    const executorShort = shortModelElement(executorRaw);
    if (plannerShort && executorShort && plannerShort.toLowerCase() !== executorShort.toLowerCase()) {
      displayModel = `Orchestrator (${plannerShort} ${ARROW} ${executorShort})`;
    }
  }

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

  const customAgentName = dig(j, 'agent', 'name');
  const modelSegment = customAgentName
    ? `${colorModel}${B}${displayModel}${R} ${colorGit}@${customAgentName}${R}`
    : `${colorModel}${B}${displayModel}${R}`;

  // ─── VCS (GIT / JJ / HG) & HYPERLINKS ─────────────────────────────────────────
  const vcsType = options.vcsType || dig(j, 'vcs', 'type') || 'git';
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
        : ` ${colorLabel}${vcsType}:(${colorGit}${branchText}${colorLabel})${R}`)
    : '';

  const repoText = (enableLinks && project) ? makeLink(repo, toFileUrl(project), true) : repo;

  // ─── SPINNER, AGENT STATE, QUEUED INPUT & VIM MODE ────────────────────────────
  const stateLower = String(state || 'idle').toLowerCase();
  const isError = stateLower === 'error';
  const isReviewing = stateLower === 'reviewing';
  const isActive = /working|tool|running|thinking|busy|initializing|authenticating/i.test(stateLower);

  let stateColor;
  let stateGlyph;
  if (isError) {
    stateColor = colorQuotaCritical;
    stateGlyph = `${stateColor}${CROSS}${R}`;
  } else if (isReviewing) {
    stateColor = Amber;
    stateGlyph = `${stateColor}${PAUSE}${R}`;
  } else if (isActive) {
    stateColor = colorActive;
    if (!noSpinner) {
      const frame = Math.floor(Date.now() / 120) % SPINNER_FRAMES.length;
      stateGlyph = `${stateColor}${SPINNER_FRAMES[frame]}${R}`;
    } else {
      stateGlyph = `${stateColor}${DOT}${R}`;
    }
  } else {
    stateColor = colorSuccess;
    stateGlyph = `${stateColor}${DOT}${R}`;
  }

  let stateSegment = `${stateColor}${B}${stateGlyph}${R} ${stateColor}${B}${state}${R}`;
  if (j.tool_confirmation_pending === true) {
    stateSegment += ` ${Amber}${WARN} confirm${R}`;
  }

  const pendingInputCount = Number(j.pending_input_count) || 0;
  if (pendingInputCount > 0) {
    const qText = layout === 'tiny'
      ? `${pendingInputCount}q`
      : `${HOURGLASS} ${pendingInputCount} queued`;
    stateSegment += ` ${colorPermAcceptEdits}${qText}${R}`;
  }

  // Vim editor mode badge (NORMAL / INSERT / VISUAL / VISUAL LINE)
  const rawVimMode = dig(j, 'vim', 'mode');
  let vimSegment = '';
  if (rawVimMode) {
    const vm = String(rawVimMode).toUpperCase().trim();
    const shortVm = vm === 'VISUAL LINE' ? 'V-LINE' : vm;
    let vmColor = colorActive;
    if (vm === 'INSERT') vmColor = colorSuccess;
    else if (vm.startsWith('VISUAL')) vmColor = Magenta;
    else if (vm === 'NORMAL') vmColor = colorActive;
    vimSegment = `${vmColor}${B}${shortVm}${R}`;
  }

  const SEP_PAD = ` ${colorSep}${SEP}${R} `;
  const line1Parts = [
    modelSegment,
    `${colorRepo}${repoText}${R}${branchStr}`,
    stateSegment
  ];
  if (vimSegment) {
    line1Parts.push(vimSegment);
  }

  // Optional conversation ID / title badge for `agy -r <prefix>`
  if (cfg.showConversationId === true && layout !== 'tiny') {
    const title = j.conversation_title ? truncateText(j.conversation_title, layout === 'normal' ? 28 : 16) : '';
    const shortId = convId ? String(convId).slice(0, 8) : '';
    if (title && shortId) {
      line1Parts.push(`${colorLabel}#${shortId} ${title}${R}`);
    } else if (shortId) {
      line1Parts.push(`${colorLabel}#${shortId}${R}`);
    } else if (title) {
      line1Parts.push(`${colorLabel}${title}${R}`);
    }
  }

  const showCost = cfg.showCost !== false;
  const showSpeed = cfg.showSpeed !== false;

  function formatCostPart() {
    if (!showCost || costInfo.totalUsd <= 0) return '';
    const prefix = costInfo.estimated ? '~' : '';
    let str = `${colorSuccess}${prefix}$${costInfo.totalUsd.toFixed(3)}${R}`;
    if (costInfo.subagentUsd > 0 && layout === 'normal') {
      str += ` ${colorLabel}(+$${costInfo.subagentUsd.toFixed(2)} sub)${R}`;
    }
    return str;
  }

  if (cfg.preset === 'minimal' || cfg.preset === 'essential') {
    const extras = [];
    const costStr = formatCostPart();
    if (costStr) extras.push(costStr);
    if (showSpeed && streamSpeed > 0) extras.push(`${colorActive}${streamSpeed.toFixed(1)} t/s${R}`);
    if (extras.length > 0) {
      line1Parts.push(extras.join(SEP_PAD));
    }
  }
  const line1 = line1Parts.join(SEP_PAD);

  // ─── LINE 2: ctx bar │ quota bars / credits │ cost │ speed ────────────────────
  function quotaSegment(seg, bLen) {
    if (seg.isAmount) {
      const amtCol = seg.amount < 20 ? colorQuotaLow : colorQuotaHigh;
      return `${colorLabel}${seg.label}${R} ${amtCol}${B}${seg.amount}${R}`;
    }

    const { label, pct, resetSeconds, paceDelta } = seg;
    const col = quotaColor(pct);
    const reset = formatResetTime(resetSeconds);
    const rStr = reset ? ` ${colorLabel}${reset}${R}` : '';

    let paceStr = '';
    if (cfg.showQuotaPace === true && paceDelta != null && Math.abs(paceDelta) >= 5 && layout !== 'tiny') {
      if (paceDelta > 0) {
        const pCol = paceDelta >= 15 ? colorQuotaCritical : colorQuotaLow;
        paceStr = ` ${pCol}${PACE_UP}${paceDelta}%${R}`;
      } else {
        paceStr = ` ${colorSuccess}${PACE_DOWN}${Math.abs(paceDelta)}%${R}`;
      }
    }

    if (pct <= 0) {
      if (bLen <= 0) {
        return `${colorLabel}${label}${R} ${Red}${WARN} limit${R}${rStr}`;
      }
      return `${colorLabel}${label}${R} ${Red}${WARN} Limit reached${R}${rStr}`;
    }

    if (bLen <= 0) {
      return `${colorLabel}${label}${R} ${col}${pct}%${R}${rStr}${paceStr}`;
    }

    return `${colorLabel}${label}${R} ${col}${bar(pct, bLen, FULL, EMPTY)}${R} ${col}${pct}%${R}${rStr}${paceStr}`;
  }

  const effectiveCtxPct = compactPct != null ? Math.max(ctxPct, compactPct) : ctxPct;
  const ctxCol = contextColor(effectiveCtxPct);
  const ctxBarStr = barLen > 0 ? ` ${ctxCol}${bar(ctxPct, barLen, FULL, EMPTY)}${R}` : '';

  // Prompt cache hit ratio badge (normal layout when cache reads occurred)
  let cacheStr = '';
  if (
    cfg.showCacheHit !== false &&
    layout === 'normal' &&
    cacheReadTokens > 0
  ) {
    const totalCurrentIn = currentInTokens + cacheCreateTokens + cacheReadTokens;
    const cachePct = totalCurrentIn > 0 ? Math.min(100, Math.round((cacheReadTokens / totalCurrentIn) * 100)) : 0;
    if (cachePct > 0) {
      cacheStr = ` ${colorSuccess}${BOLT}${cachePct}%${R}`;
    }
  }

  // Auto-compaction threshold hint (only when override is set and >= 70% toward compaction)
  let compactStr = '';
  if (compactThreshold && compactPct != null && compactPct >= 70 && layout !== 'tiny') {
    compactStr = ` ${ctxCol}cmp ${Math.round(compactPct)}%${R}`;
  } else if (j.exceeds_200k_tokens === true && ctxSize <= 200000 && layout !== 'tiny') {
    compactStr = ` ${Amber}${WARN}>200k${R}`;
  }

  let ctxLabel;
  if (layout === 'tiny') {
    ctxLabel = `${colorLabel}ctx${R} ${ctxCol}${Math.round(ctxPct)}%${R} ${colorLabel}(${fmtNum(ctxIn)}${UP}/${fmtNum(ctxOut)}${DOWN})${R}`;
  } else {
    ctxLabel = `${colorLabel}ctx${R}${ctxBarStr} ${White}${B}${Math.round(ctxPct)}%${R}`
      + ` ${colorLabel}(${fmtNum(ctxIn)} ${UP} / ${fmtNum(ctxOut)} ${DOWN} / ${fmtNum(ctxSize)})${R}`
      + `${cacheStr}${compactStr}`;
  }

  const quotaSegments = resolveQuotaSegments(j);
  const quotaParts = quotaSegments.map(seg => quotaSegment(seg, barLen));

  const line2Parts = [ctxLabel, ...quotaParts];
  if (!cfg.preset || cfg.preset === 'full') {
    const extras = [];
    const costStr = formatCostPart();
    if (costStr) extras.push(costStr);
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

  // ─── LINE 4: permission mode │ shell │ tasks │ artifacts │ agents │ steps/plan │ skills │ mcp │ sandbox │ duration ─
  const shellCount = Math.min(tData.shellCount || 0, 99);
  const taskCount = Math.min(tData.taskCount != null ? tData.taskCount : (j.task_count || 0), 99);

  // Structured subagents resolution (distinguish running vs completed when payload supplies status)
  let agentCount = 0;
  let runningPayloadSubs = [];
  let completedPayloadSubs = [];
  let hasStructuredPayloadSubs = false;

  if (Array.isArray(j.subagents) && j.subagents.length > 0) {
    hasStructuredPayloadSubs = j.subagents.some(s => s && typeof s === 'object' && s.status);
    if (hasStructuredPayloadSubs) {
      runningPayloadSubs = j.subagents.filter(s => s && String(s.status).toLowerCase() === 'running');
      completedPayloadSubs = j.subagents.filter(s => s && String(s.status).toLowerCase() !== 'running');
      agentCount = runningPayloadSubs.length;
    } else {
      agentCount = j.subagents.length;
    }
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
    permIcon = STOP;
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

  // Native artifact_count (with OSC 8 link to brain/<conversation_id> when available)
  const artifactCount = Math.min(Number(j.artifact_count) || 0, 99);
  if (cfg.showArtifacts !== false && artifactCount > 0 && layout !== 'tiny') {
    const rawArtLabel = layout === 'normal'
      ? `${artifactCount} ${artifactCount === 1 ? 'artifact' : 'artifacts'}`
      : `${artifactCount} art`;
    let artText = rawArtLabel;
    if (enableLinks && convId) {
      const brainDir = options.brainDir || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', String(convId));
      artText = makeLink(rawArtLabel, toFileUrl(brainDir), true);
    }
    line4 += ` ${colorSuccess}${DOT}${R} ${White}${artText}${R}`;
  }

  // Subagent badge
  let agentLabel;
  if (hasStructuredPayloadSubs) {
    if (runningPayloadSubs.length > 0) {
      agentLabel = completedPayloadSubs.length > 0
        ? `${runningPayloadSubs.length} active ${colorLabel}(${completedPayloadSubs.length} done)${R}`
        : `${runningPayloadSubs.length} agents`;
      if (cfg.showSubagents !== false && layout === 'normal') {
        const latestRunning = runningPayloadSubs[runningPayloadSubs.length - 1];
        const subRole = latestRunning.role || latestRunning.name || 'subagent';
        const matchedTranscriptSub = Array.isArray(tData.activeSubagents)
          ? tData.activeSubagents.find(s => s && s.role && s.role.toLowerCase() === String(subRole).toLowerCase())
          : null;
        const subDur = matchedTranscriptSub ? formatDuration(matchedTranscriptSub.elapsedSeconds) : '';
        const roleDetail = subDur ? `${subRole} ${subDur}` : subRole;
        agentLabel = `${runningPayloadSubs.length} agents ${colorLabel}(${roleDetail}${completedPayloadSubs.length > 0 ? `, +${completedPayloadSubs.length} done` : ''})${R}`;
      }
    } else {
      agentLabel = `${completedPayloadSubs.length} agents ${colorLabel}done${R}`;
    }
  } else {
    agentLabel = `${agentCount} agents`;
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
  }
  line4 += ` ${colorSuccess}${DOT}${R} ${White}${agentLabel}${R}`;

  // Live update_steps checklist (CLI v1.5.16+) or fallback markdown planProgress
  if (cfg.showTodos !== false && layout !== 'tiny') {
    const sp = tData.stepsProgress;
    if (sp && sp.total > 0) {
      let stepStr = `${sp.done}/${sp.total} steps`;
      if (sp.failed > 0) {
        stepStr += ` ${Red}${sp.failed}${CROSS}${R}`;
      }
      if (layout === 'normal' && sp.activeTitle && sp.done < sp.total) {
        stepStr += ` ${colorLabel}(${truncateText(sp.activeTitle, 24)})${R}`;
      }
      line4 += ` ${colorSuccess}${DOT}${R} ${White}${stepStr}${R}`;
    } else if (tData.planProgress && tData.planProgress.total > 0) {
      line4 += ` ${colorSuccess}${DOT}${R} ${White}${tData.planProgress.done}/${tData.planProgress.total} plan${R}`;
    }
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
