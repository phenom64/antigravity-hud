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
  if (m.includes('flash') || m.includes('gemini 1.5') || m.includes('gemini 3.5')) return 1000000;
  if (m.includes('pro') || m.includes('gemini 2.0') || m.includes('gemini 3.0')) return 2000000;
  return 200000; // Claude default
}

module.exports = { formatResetTime, getContextCapacity };
