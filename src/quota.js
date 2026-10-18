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

/** Get maximum token context capacity for a model name. */
function getContextCapacity(modelName) {
  const m = (modelName || '').toLowerCase();
  if (m.includes('argon')) return 1000000;
  if (m.includes('flash') || m.includes('gemini 1.5') || m.includes('gemini 3.5') || m.includes('gemini 3.8')) return 1000000;
  if (m.includes('pro') || m.includes('gemini 2.0') || m.includes('gemini 3.0')) return 2000000;
  return 200000; // Claude default
}

/** Get remaining quota percentage, defaulting to 100 if missing or null. */
function quotaPct(q) {
  if (!q || q.remaining_fraction == null) return 100;
  const pct = Math.round(Number(q.remaining_fraction) * 100);
  if (!Number.isFinite(pct)) return 100;
  return Math.max(0, Math.min(100, pct));
}

/**
 * Resolve quota segments to render based on model and plan tier.
 *
 * Rules:
 * - Argon on Pro: single 'argon-wk' segment (separate weekly limits for Pro subscribers)
 * - 3P models (Claude/GPT): '5h' (from 3p-5h) and 'wk' (from 3p-weekly)
 * - Regular Gemini models (or non-Pro Argon): '5h' (from gemini-5h) and 'wk' (from gemini-weekly)
 */
function resolveQuotaSegments(payload) {
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
  const is3p = /claude|opus|sonnet|gpt/i.test(modelName);

  if (isArgon && isPro) {
    let argonKey = 'gemini-argon-wtu-weekly';
    if (!quota[argonKey]) {
      const foundKey = Object.keys(quota).find(k => /argon.*week/i.test(k));
      if (foundKey) argonKey = foundKey;
    }
    const qArgon = quota[argonKey] || {};
    return [
      {
        id: 'argon-wk',
        label: 'argon-wk',
        quota: qArgon,
        pct: quotaPct(qArgon),
        resetSeconds: qArgon.reset_in_seconds
      }
    ];
  }

  if (is3p) {
    const q5h = quota['3p-5h'] || {};
    const qWk = quota['3p-weekly'] || {};
    return [
      {
        id: '5h',
        label: '5h',
        quota: q5h,
        pct: quotaPct(q5h),
        resetSeconds: q5h.reset_in_seconds
      },
      {
        id: 'wk',
        label: 'wk',
        quota: qWk,
        pct: quotaPct(qWk),
        resetSeconds: qWk.reset_in_seconds
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
      pct: quotaPct(q5h),
      resetSeconds: q5h.reset_in_seconds
    },
    {
      id: 'wk',
      label: 'wk',
      quota: qWk,
      pct: quotaPct(qWk),
      resetSeconds: qWk.reset_in_seconds
    }
  ];
}

module.exports = { formatResetTime, getContextCapacity, quotaPct, resolveQuotaSegments };
