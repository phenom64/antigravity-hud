'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DEFAULT_STATUS_TTL_MS = 5000;
const DEFAULT_REMOTE_TTL_MS = 60000;

/**
 * Parse `git status --porcelain -b` output into `{ branch, dirty, ahead, behind }`.
 */
function parsePorcelainBranchAndDirty(output) {
  if (!output || typeof output !== 'string') {
    return { branch: '', dirty: '', ahead: 0, behind: 0 };
  }
  const lines = output.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) {
    return { branch: '', dirty: '', ahead: 0, behind: 0 };
  }

  let branch = '';
  let ahead = 0;
  let behind = 0;
  let startIdx = 0;
  if (lines[0].startsWith('## ')) {
    startIdx = 1;
    const header = lines[0].slice(3).trim();

    const trackMatch = header.match(/\[([^\]]+)\]/);
    if (trackMatch) {
      const trackStr = trackMatch[1];
      const aheadM = trackStr.match(/ahead\s+(\d+)/i);
      const behindM = trackStr.match(/behind\s+(\d+)/i);
      if (aheadM) ahead = parseInt(aheadM[1], 10) || 0;
      if (behindM) behind = parseInt(behindM[1], 10) || 0;
    }

    const cleanHeader = header.replace(/\s*\[[^\]]*\]\s*$/, '').trim();
    if (cleanHeader.startsWith('HEAD (no branch)') || cleanHeader === 'HEAD') {
      branch = '';
    } else if (cleanHeader.startsWith('No commits yet on ')) {
      branch = cleanHeader.slice('No commits yet on '.length).trim();
    } else if (cleanHeader.startsWith('Initial commit on ')) {
      branch = cleanHeader.slice('Initial commit on '.length).trim();
    } else {
      branch = cleanHeader.split('...')[0].split(/\s+/)[0].trim();
    }
  }

  const hasChanges = lines.slice(startIdx).some(l => l.trim().length > 0);
  return {
    branch,
    dirty: branch && hasChanges ? '*' : '',
    ahead: branch ? ahead : 0,
    behind: branch ? behind : 0
  };
}

/**
 * Normalize a git remote URL into an HTTP(S) branch tree URL.
 */
function normalizeRemoteUrl(rawRemote, branch) {
  if (!rawRemote || !branch) return '';
  let base = String(rawRemote).trim().replace(/\.git$/, '');
  if (base.startsWith('git@')) {
    base = base.replace(/^git@([^:]+):/, 'https://$1/');
  }
  if (base.startsWith('https://') || base.startsWith('http://')) {
    return `${base}/tree/${encodeURIComponent(branch)}`;
  }
  return '';
}

function readStateFile(statePath) {
  try {
    if (fs.existsSync(statePath)) {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return {};
}

function writeStateFile(statePath, state) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Retrieve git branch, dirty marker, ahead/behind counts, and remote tree URL with TTL caching.
 */
function getGitInfo(project, options = {}) {
  if (!project) return { branch: '', dirty: '', ahead: 0, behind: 0, gitRepoUrl: '', cached: false };

  const statePath = options.statePath || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-state.json');
  const statusTtlMs = options.statusTtlMs != null ? options.statusTtlMs : DEFAULT_STATUS_TTL_MS;
  const remoteTtlMs = options.remoteTtlMs != null ? options.remoteTtlMs : DEFAULT_REMOTE_TTL_MS;
  const now = options.now != null ? options.now : Date.now();

  const state = readStateFile(statePath);
  const gitCache = (state.gitCache && typeof state.gitCache === 'object') ? state.gitCache : {};
  const entry = gitCache[project];

  if (entry && entry.statusTimestamp && (now - entry.statusTimestamp) < statusTtlMs) {
    return {
      branch: entry.branch || '',
      dirty: entry.dirty || '',
      ahead: entry.ahead || 0,
      behind: entry.behind || 0,
      gitRepoUrl: entry.gitRepoUrl || '',
      cached: true
    };
  }

  let branch = '';
  let dirty = '';
  let ahead = 0;
  let behind = 0;
  try {
    const porcelain = execFileSync('git', ['-C', project, 'status', '--porcelain', '-b'], {
      timeout: 1500,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const parsed = parsePorcelainBranchAndDirty(porcelain);
    branch = parsed.branch;
    dirty = parsed.dirty;
    ahead = parsed.ahead;
    behind = parsed.behind;
  } catch (_) {
    branch = '';
    dirty = '';
    ahead = 0;
    behind = 0;
  }

  let rawRemote = (entry && entry.rawRemote) || '';
  let remoteTimestamp = (entry && entry.remoteTimestamp) || 0;

  if (branch) {
    if (!rawRemote || !remoteTimestamp || (now - remoteTimestamp) >= remoteTtlMs) {
      try {
        rawRemote = execFileSync('git', ['-C', project, 'remote', 'get-url', 'origin'], {
          timeout: 1500,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
      } catch (_) {
        rawRemote = '';
      }
      remoteTimestamp = now;
    }
  } else {
    rawRemote = '';
    remoteTimestamp = now;
  }

  const gitRepoUrl = normalizeRemoteUrl(rawRemote, branch);

  gitCache[project] = {
    branch,
    dirty,
    ahead,
    behind,
    rawRemote,
    gitRepoUrl,
    statusTimestamp: now,
    remoteTimestamp
  };

  // Prune cache if more than 10 projects are stored
  const keys = Object.keys(gitCache);
  if (keys.length > 10) {
    keys.sort((a, b) => (gitCache[a].statusTimestamp || 0) - (gitCache[b].statusTimestamp || 0));
    while (keys.length > 10) {
      delete gitCache[keys.shift()];
    }
  }

  state.gitCache = gitCache;
  writeStateFile(statePath, state);

  return { branch, dirty, ahead, behind, gitRepoUrl, cached: false };
}

module.exports = {
  getGitInfo,
  parsePorcelainBranchAndDirty,
  normalizeRemoteUrl
};
