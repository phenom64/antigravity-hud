'use strict';

/** Format reset seconds into human-readable reset time string. */
function formatResetTime(seconds) {
  if (seconds == null || seconds <= 0) return '';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
    m.includes('gemini 3.8')
  ) {
    return 1000000;
  }
  if (m.includes('pro') || m.includes('gemini 2.0') || m.includes('gemini 3.0')) {
    return 2000000;
  }
  return 200000; // Claude / 3P default
}

/**
 * Compute live remaining reset seconds from `q.reset_time` (ISO timestamp) when available,
 * falling back to `q.reset_in_seconds`.
 */
function resolveResetSeconds(q, nowMs = Date.now()) {
  if (!q || typeof q !== 'object') return 0;
  if (q.reset_time) {
    const resetMs = Date.parse(q.reset_time);
    if (Number.isFinite(resetMs)) {
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
    if (Number.isFinite(resetMs) && nowMs >= resetMs) {
      return 100;
    }
  }
  const pct = Math.round(Number(q.remaining_fraction) * 100);
  if (!Number.isFinite(pct)) return 100;
  return Math.max(0, Math.min(100, pct));
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
  'gemini-4-argon': { input: 1.25, output: 5.0 },
  'argon': { input: 1.25, output: 5.0 },
  'gemini-4-neon': { input: 1.25, output: 5.0 },
  'neon': { input: 1.25, output: 5.0 },
  'gemini-4-carbon': { input: 0.50, output: 2.0 },
  'carbon': { input: 0.50, output: 2.0 },
  'gemini-4-hydrogen': { input: 0.15, output: 0.6 },
  'hydrogen': { input: 0.15, output: 0.6 },
  'gemini-3.8-flash': { input: 0.075, output: 0.3 },
  'gemini-3.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.075, output: 0.3 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'flash': { input: 0.075, output: 0.3 },
  'gemini-3.0-pro': { input: 1.25, output: 5.0 },
  'gemini-2.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gpt-5': { input: 2.5, output: 10.0 },
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
 * Resolve quota segments to render based on model and plan tier.
 *
 * Rules:
 * - Argon on Pro: 'argon-wk' segment, plus a secondary '5h' warning segment if gemini-5h drops below 25%
 * - 3P models (Claude/GPT/o-series): '5h' (from 3p-5h) and 'wk' (from 3p-weekly)
 * - Regular Gemini models (including Neon/Carbon/Hydrogen or non-Pro Argon): '5h' (from gemini-5h) and 'wk' (from gemini-weekly)
 */
function resolveQuotaSegments(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object') {
    return [
      { id: '5h', label: '5h', quota: {}, pct: 100, resetSeconds: 0 },
      { id: 'wk', label: 'wk', quota: {}, pct: 100, resetSeconds: 0 }
    ];
  }

  const modelObj = payload.model;
  const modelName = (typeof modelObj === 'object' && modelObj !== null)
    ? (modelObj.display_name || modelObj.id || '')
    : (typeof payload.model === 'string' ? payload.model : (payload.model_name || ''));

  const planTier = String(payload.plan_tier || '');
  const quota = payload.quota || {};

  const isArgon = /argon/i.test(modelName);
  const isPro = /pro/i.test(planTier);
  const is3p = /claude|opus|sonnet|haiku|gpt|o1|o3|o4/i.test(modelName);

  if (isArgon && isPro) {
    let argonKey = 'gemini-argon-wtu-weekly';
    if (!quota[argonKey]) {
      const foundKey = Object.keys(quota).find(k => /argon.*week/i.test(k));
      if (foundKey) argonKey = foundKey;
    }
    const qArgon = quota[argonKey] || {};
    const segments = [
      {
        id: 'argon-wk',
        label: 'argon-wk',
        quota: qArgon,
        pct: quotaPct(qArgon, nowMs),
        resetSeconds: resolveResetSeconds(qArgon, nowMs)
      }
    ];

    const q5h = quota['gemini-5h'];
    if (q5h && q5h.remaining_fraction != null && quotaPct(q5h, nowMs) < 25) {
      segments.push({
        id: '5h',
        label: '5h',
        quota: q5h,
        pct: quotaPct(q5h, nowMs),
        resetSeconds: resolveResetSeconds(q5h, nowMs)
      });
    }

    return segments;
  }

  if (is3p) {
    const q5h = quota['3p-5h'] || {};
    const qWk = quota['3p-weekly'] || {};
    return [
      {
        id: '5h',
        label: '5h',
        quota: q5h,
        pct: quotaPct(q5h, nowMs),
        resetSeconds: resolveResetSeconds(q5h, nowMs)
      },
      {
        id: 'wk',
        label: 'wk',
        quota: qWk,
        pct: quotaPct(qWk, nowMs),
        resetSeconds: resolveResetSeconds(qWk, nowMs)
      }
    ];
  }

  const q5h = quota['gemini-5h'] || {};
  const qWk = quota['gemini-weekly'] || {};
  return [
    {
      id: '5h',
      label: '5h',
      quota: q5h,
      pct: quotaPct(q5h, nowMs),
      resetSeconds: resolveResetSeconds(q5h, nowMs)
    },
    {
      id: 'wk',
      label: 'wk',
      quota: qWk,
      pct: quotaPct(qWk, nowMs),
      resetSeconds: resolveResetSeconds(qWk, nowMs)
    }
  ];
}

module.exports = {
  formatResetTime,
  formatDuration,
  getContextCapacity,
  quotaPct,
  resolveResetSeconds,
  resolveQuotaSegments,
  MODEL_PRICING,
  estimateCost
};
