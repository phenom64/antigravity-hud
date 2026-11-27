'use strict';
const { basenameAny } = require('./render/lines');

function dig(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function shortenModelForTitle(model) {
  if (!model) return '';
  return String(model)
    .replace(/^Gemini\s+4\s+/i, 'G4 ')
    .replace(/^Gemini\s+/i, 'G')
    .replace(/^Claude\s+Opus\s*/i, 'Opus ')
    .replace(/^Claude\s+Sonnet\s*/i, 'Sonnet ')
    .replace(/^Claude\s+Haiku\s*/i, 'Haiku ')
    .replace(/\s*\((XHigh|High|Medium|Low|Thinking|Max)\)/gi, (_, m) => {
      const u = m.toLowerCase();
      if (u === 'xhigh') return ' (XH)';
      if (u === 'max') return ' (Max)';
      return ` (${m[0].toUpperCase()})`;
    })
    .trim();
}

/**
 * Render a plain-text, single-line terminal window title for Antigravity CLI's
 * `title` command integration (`~/.gemini/antigravity-cli/settings.json`).
 * No ANSI color codes or control characters are emitted.
 */
function renderTitle(payload = {}, options = {}) {
  const j = payload || {};
  const noUnicode = Boolean(options.noUnicode || process.env.AGY_HUD_NO_UNICODE === '1');

  const state = String(j.agent_state || 'idle').toLowerCase();
  let statePrefix;
  if (j.tool_confirmation_pending === true) {
    statePrefix = noUnicode ? '! confirm' : '\u26A0 confirm';
  } else if (state === 'error') {
    statePrefix = noUnicode ? 'x error' : '\u2716 error';
  } else if (state === 'reviewing') {
    statePrefix = noUnicode ? '|| reviewing' : '\u23F8 reviewing';
  } else if (state === 'working') {
    statePrefix = noUnicode ? '* working' : '\u2699 working';
  } else if (state === 'tool_use') {
    statePrefix = noUnicode ? '* tool' : '\u2699 tool';
  } else if (state === 'thinking') {
    statePrefix = noUnicode ? '* thinking' : '\u25C6 thinking';
  } else if (state === 'initializing' || state === 'authenticating') {
    statePrefix = noUnicode ? `... ${state}` : `\u23F3 ${state}`;
  } else {
    statePrefix = noUnicode ? '* ready' : '\u25CF ready';
  }

  const project = dig(j, 'workspace', 'project_dir') || dig(j, 'workspace', 'current_dir') || j.cwd || '';
  const repo = basenameAny(project) || 'agy';

  const branch = options.gitBranch || dig(j, 'vcs', 'branch') || '';
  const dirty = (options.gitDirty || dig(j, 'vcs', 'dirty')) ? '*' : '';
  const repoPart = branch ? `${repo} (${branch}${dirty})` : repo;

  const rawModel = (typeof j.model === 'object' && j.model !== null)
    ? (j.model.display_name || j.model.id || '')
    : (j.model || j.model_name || '');
  const shortModel = shortenModelForTitle(rawModel);

  const rawPct = dig(j, 'context_window', 'used_percentage');
  const ctxPart = rawPct != null && Number.isFinite(Number(rawPct))
    ? `ctx ${Math.round(Number(rawPct))}%`
    : '';

  const pending = Number(j.pending_input_count) || 0;
  const queuedPart = pending > 0 ? `+${pending}q` : '';

  const parts = [statePrefix, repoPart];
  if (shortModel) parts.push(shortModel);
  if (ctxPart) parts.push(ctxPart);
  if (queuedPart) parts.push(queuedPart);

  // Strip any control characters/newlines to strictly honor CLI title spec
  return parts.join(' | ').replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { renderTitle, shortenModelForTitle };
