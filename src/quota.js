'use strict';

const FIVE_HOUR_SECONDS = 5 * 3600;
const WEEKLY_SECONDS = 7 * 86400;

/** Format reset seconds into human-readable reset time string. */
function formatResetTime(seconds) {
  if (seconds == null || seconds <= 0) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return '<1m';
}

/** Format elapsed session or subagent duration in seconds: 1h 12m, 14m 20s, or 42s. */
function formatDuration(seconds) {
  if (seconds == null || seconds <= 0 || !Number.isFinite(seconds)) return '';
  const total = Math.floor(seconds);
  if (total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Get maximum token context capacity for a model name. */
function getContextCapacity(modelName) {
  const m = (modelName || '').toLowerCase();
  if (
    m.includes('argon') ||
    m.includes('neon') ||
    m.includes('carbon') ||
    m.includes('hydrogen') ||
    m.includes('orchestrator') ||
    m.includes('gemini 4') ||
    m.includes('gemini-4')
  ) {
    return 1000000;
  }
  if (
    m.includes('flash') ||
    m.includes('gemini 1.5') ||
    m.includes('gemini 2.5') ||
    m.includes('gemini 3.5') ||
    m.includes('gemini 3.6') ||
    m.includes('gemini 3.7') ||
    m.includes('gemini 3.8')
  ) {
    return 1000000;
  }
  if (m.includes('pro') || m.includes('gemini 2.0') || m.includes('gemini 3.0') || m.includes('gemini 3.1')) {
    return 2000000;
  }
  return 200000; // Claude / 3P default
}

/**
 * Parse AGY_CLI_AUTO_COMPACT_OVERRIDE (CLI v1.5.15+):
 * Accepts a token count ("700000"), K/M shorthand ("800K", "0.5M"), or percentage ("80%").
 * Returns a positive token count clamped to ctxSize, or null if unset/invalid.
 */
function parseAutoCompactOverride(rawValue, ctxSize) {
  if (rawValue == null || rawValue === '' || !Number.isFinite(ctxSize) || ctxSize <= 0) return null;
  const s = String(rawValue).trim();
  if (!s) return null;

  let tokens = null;
  const pctMatch = s.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[1]);
    if (Number.isFinite(pct) && pct > 0) {
      tokens = Math.round((pct / 100) * ctxSize);
    }
  } else {
    const unitMatch = s.match(/^(\d+(?:\.\d+)?)\s*([kKmM])?$/);
    if (unitMatch) {
      const val = parseFloat(unitMatch[1]);
      const unit = (unitMatch[2] || '').toLowerCase();
      if (Number.isFinite(val) && val > 0) {
        if (unit === 'k') tokens = Math.round(val * 1000);
        else if (unit === 'm') tokens = Math.round(val * 1000000);
        else tokens = Math.round(val);
      }
    }
  }

  if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return null;
  return Math.min(tokens, Math.round(ctxSize));
}

/**
 * Compute live remaining reset seconds from `q.reset_time` (ISO timestamp) when available,
 * falling back to `q.reset_in_seconds`.
 */
function resolveResetSeconds(q, nowMs = Date.now()) {
  if (!q || typeof q !== 'object') return 0;
  if (q.reset_time) {
    const resetMs = Date.parse(q.reset_time);
    if (Number.isFinite(resetMs) && resetMs > 0) {
      const diffSec = Math.floor((resetMs - nowMs) / 1000);
      return Math.max(0, diffSec);
    }
  }
  if (q.reset_in_seconds != null && Number.isFinite(Number(q.reset_in_seconds))) {
    return Math.max(0, Math.floor(Number(q.reset_in_seconds)));
  }
  return 0;
}

/**
 * Get remaining quota percentage, defaulting to 100 if missing or null.
 * If `q.reset_time` is in the past (window already reset while CLI quota cache was stale),
 * returns 100.
 */
function quotaPct(q, nowMs = Date.now()) {
  if (!q || q.remaining_fraction == null) return 100;
  if (q.reset_time) {
    const resetMs = Date.parse(q.reset_time);
    if (Number.isFinite(resetMs) && resetMs > 0 && nowMs >= resetMs) {
      return 100;
    }
  }
  const pct = Math.round(Number(q.remaining_fraction) * 100);
  if (!Number.isFinite(pct)) return 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Compute quota burn pace delta in percentage points relative to a linear burn over the window.
 * Positive values (+N%) mean you are burning faster than linear pace; negative (-N%) mean under pace.
 * Returns null if resetSeconds is unavailable or window has barely started.
 */
function computePaceDelta(pct, resetSeconds, windowSeconds) {
  if (
    !Number.isFinite(pct) ||
    !Number.isFinite(resetSeconds) ||
    !Number.isFinite(windowSeconds) ||
    resetSeconds <= 0 ||
    windowSeconds <= 0 ||
    resetSeconds >= windowSeconds
  ) {
    return null;
  }
  const elapsedFrac = (windowSeconds - resetSeconds) / windowSeconds;
  if (elapsedFrac < 0.02) return null;
  const usedPct = Math.max(0, Math.min(100, 100 - pct));
  const expectedUsedPct = elapsedFrac * 100;
  return Math.round(usedPct - expectedUsedPct);
}

/**
 * Model pricing rates in USD per million tokens.
 * NOTE: Fallback API-equivalent estimates used only when the CLI payload does not include `cost.total_usd`.
 */
const MODEL_PRICING = {
  'opus': { input: 15.0, output: 75.0 },
  'sonnet': { input: 3.0, output: 15.0 },
  'haiku': { input: 0.8, output: 4.0 },
  'gemini-4-argon': { input: 1.25, output: 5.0 },
  'argon': { input: 1.25, output: 5.0 },
  'gemini-4-neon': { input: 1.25, output: 5.0 },
  'neon': { input: 1.25, output: 5.0 },
  'gemini-4-carbon': { input: 0.50, output: 2.0 },
  'carbon': { input: 0.50, output: 2.0 },
  'gemini-4-hydrogen': { input: 0.15, output: 0.6 },
  'hydrogen': { input: 0.15, output: 0.6 },
  'gemini-3.8-flash': { input: 0.075, output: 0.3 },
  'gemini-3.7-flash': { input: 0.075, output: 0.3 },
  'gemini-3.6-flash': { input: 0.075, output: 0.3 },
  'gemini-3.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'flash': { input: 0.075, output: 0.3 },
  'gemini-3.1-pro': { input: 1.25, output: 5.0 },
  'gemini-3.0-pro': { input: 1.25, output: 5.0 },
  'gemini-2.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gpt-5': { input: 2.5, output: 10.0 },
  'gpt-oss': { input: 0.3, output: 1.2 },
  'o3': { input: 2.0, output: 8.0 },
  'o4': { input: 1.1, output: 4.4 },
  'default': { input: 3.0, output: 15.0 }
};

/**
 * Estimate API-equivalent USD cost from input, output, and optional cache-read tokens.
 */
function estimateCost(modelName, inTokens, outTokens, cacheReadTokens = 0) {
  const modelLower = String(modelName || '').toLowerCase();
  let pricing = MODEL_PRICING['default'];

  for (const [key, val] of Object.entries(MODEL_PRICING)) {
    if (key !== 'default' && modelLower.includes(key)) {
      pricing = val;
      break;
    }
  }

  const totalIn = Math.max(0, Number(inTokens) || 0);
  const totalOut = Math.max(0, Number(outTokens) || 0);
  const cachedIn = Math.max(0, Math.min(totalIn, Number(cacheReadTokens) || 0));
  const uncachedIn = Math.max(0, totalIn - cachedIn);

  const inputUsd = ((uncachedIn / 1000000) * pricing.input) + ((cachedIn / 1000000) * pricing.input * 0.25);
  const outputUsd = (totalOut / 1000000) * pricing.output;
  return inputUsd + outputUsd;
}

/**
 * Resolve session USD cost: prefer native CLI `payload.cost` when present,
 * falling back to `estimateCost()` when omitted.
 */
function resolveCost(payload, modelName, inTokens, outTokens, cacheReadTokens = 0) {
  const nativeCost = payload && payload.cost;
  if (nativeCost && typeof nativeCost === 'object' && nativeCost.total_usd != null) {
    const totalUsd = Number(nativeCost.total_usd);
    if (Number.isFinite(totalUsd) && totalUsd >= 0) {
      const subagentUsd = Number(nativeCost.subagent_usd);
      return {
        totalUsd,
        subagentUsd: Number.isFinite(subagentUsd) && subagentUsd > 0 ? subagentUsd : 0,
        estimated: nativeCost.estimated !== false,
        fromPayload: true
      };
    }
  }
  return {
    totalUsd: estimateCost(modelName, inTokens, outTokens, cacheReadTokens),
    subagentUsd: 0,
    estimated: true,
    fromPayload: false
  };
}

function buildFractionSegment(id, label, q, windowSeconds, nowMs) {
  const pct = quotaPct(q, nowMs);
  const resetSeconds = resolveResetSeconds(q, nowMs);
  return {
    id,
    label,
    quota: q || {},
    pct,
    resetSeconds,
    windowSeconds,
    paceDelta: computePaceDelta(pct, resetSeconds, windowSeconds),
    isAmount: false
  };
}

/**
 * Extract positive count-based quota buckets (such as AI credits with `remaining_amount`).
 * Matches Antigravity CLI v1.5.14+: only shows credit balances when > 0 and not disabled.
 */
function resolveCreditSegments(quota) {
  const credits = [];
  if (!quota || typeof quota !== 'object') return credits;
  for (const [key, q] of Object.entries(quota)) {
    if (!q || typeof q !== 'object' || q.disabled === true) continue;
    if (q.remaining_amount != null && q.remaining_fraction == null) {
      const amt = Number(q.remaining_amount);
      if (Number.isFinite(amt) && amt > 0) {
        const label = /credit/i.test(key) ? 'credits' : key;
        credits.push({
          id: key,
          label,
          amount: Math.floor(amt),
          quota: q,
          isAmount: true
        });
      }
    }
  }
  return credits;
}

/**
 * Resolve quota segments to render based on model, plan tier, and available quota buckets.
 *
 * Rules:
 * - If `payload.quota` is empty or omitted (e.g. GEMINI_API_KEY mode), returns `[]` instead of fake 100% bars.
 * - Skips any bucket marked `disabled: true`.
 * - Argon on Pro: 'argon-wk' segment, plus a secondary '5h' warning segment if gemini-5h drops below 25%.
 * - 3P models (Claude/GPT/o-series): '5h' (from 3p-5h) and 'wk' (from 3p-weekly).
 * - Regular Gemini models (Neon/Carbon/Hydrogen/Orchestrator or non-Pro Argon): '5h' (gemini-5h) and 'wk' (gemini-weekly).
 * - Appends any positive `remaining_amount` buckets (e.g., AI Credits).
 */
function resolveQuotaSegments(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object') return [];

  const quota = payload.quota;
  if (!quota || typeof quota !== 'object' || Object.keys(quota).length === 0) {
    return [];
  }

  const modelObj = payload.model;
  const modelName = (typeof modelObj === 'object' && modelObj !== null)
    ? (modelObj.display_name || modelObj.id || '')
    : (typeof payload.model === 'string' ? payload.model : (payload.model_name || ''));

  const planTier = String(payload.plan_tier || '');
  const isArgon = /argon/i.test(modelName);
  const isPro = /pro/i.test(planTier);
  const is3p = /claude|opus|sonnet|haiku|gpt|o1|o3|o4/i.test(modelName);

  const segments = [];

  if (isArgon && isPro) {
    let argonKey = 'gemini-argon-wtu-weekly';
    if (!quota[argonKey]) {
      const foundKey = Object.keys(quota).find(k => /argon.*week/i.test(k));
      if (foundKey) argonKey = foundKey;
    }
    const qArgon = quota[argonKey];
    if (qArgon && qArgon.disabled !== true) {
      segments.push(buildFractionSegment('argon-wk', 'argon-wk', qArgon, WEEKLY_SECONDS, nowMs));
    }

    const q5h = quota['gemini-5h'];
    if (q5h && q5h.disabled !== true && q5h.remaining_fraction != null && quotaPct(q5h, nowMs) < 25) {
      segments.push(buildFractionSegment('5h', '5h', q5h, FIVE_HOUR_SECONDS, nowMs));
    }
  } else if (is3p) {
    const q5h = quota['3p-5h'];
    const qWk = quota['3p-weekly'];
    if (q5h && q5h.disabled !== true) {
      segments.push(buildFractionSegment('5h', '5h', q5h, FIVE_HOUR_SECONDS, nowMs));
    }
    if (qWk && qWk.disabled !== true) {
      segments.push(buildFractionSegment('wk', 'wk', qWk, WEEKLY_SECONDS, nowMs));
    }
  } else {
    const q5h = quota['gemini-5h'];
    const qWk = quota['gemini-weekly'];
    if (q5h && q5h.disabled !== true) {
      segments.push(buildFractionSegment('5h', '5h', q5h, FIVE_HOUR_SECONDS, nowMs));
    }
    if (qWk && qWk.disabled !== true) {
      segments.push(buildFractionSegment('wk', 'wk', qWk, WEEKLY_SECONDS, nowMs));
    }
  }

  segments.push(...resolveCreditSegments(quota));
  return segments;
}

module.exports = {
  FIVE_HOUR_SECONDS,
  WEEKLY_SECONDS,
  formatResetTime,
  formatDuration,
  getContextCapacity,
  parseAutoCompactOverride,
  quotaPct,
  resolveResetSeconds,
  computePaceDelta,
  resolveQuotaSegments,
  resolveCreditSegments,
  MODEL_PRICING,
  estimateCost,
  resolveCost
};
