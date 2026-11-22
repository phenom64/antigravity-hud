'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const DEFAULT_STATUS_TTL_MS = 5000;
const DEFAULT_REMOTE_TTL_MS = 60000;

/**
 * Parse `git status --porcelain -b` output into `{ branch, dirty }`.
 */
function parsePorcelainBranchAndDirty(output) {
  if (!output || typeof output !== 'string') {
    return { branch: '', dirty: '' };
  }
  const lines = output.split(/\r?\n/).filter(l => l.length > 0);
  if (lines.length === 0) {
    return { branch: '', dirty: '' };
  }

  let branch = '';
  let startIdx = 0;
  if (lines[0].startsWith('## ')) {
    startIdx = 1;
    const header = lines[0].slice(3).trim();
    if (header.startsWith('HEAD (no branch)') || header === 'HEAD') {
      branch = '';
    } else if (header.startsWith('No commits yet on ')) {
      branch = header.slice('No commits yet on '.length).trim();
    } else if (header.startsWith('Initial commit on ')) {
      branch = header.slice('Initial commit on '.length).trim();
    } else {
      branch = header.split('...')[0].split(/\s+/)[0].trim();
    }
  }

  const hasChanges = lines.slice(startIdx).some(l => l.trim().length > 0);
  return {
    branch,
    dirty: branch && hasChanges ? '*' : ''
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
 * Retrieve git branch, dirty marker, and remote tree URL with TTL caching.
 */
function getGitInfo(project, options = {}) {
  if (!project) return { branch: '', dirty: '', gitRepoUrl: '', cached: false };

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
      gitRepoUrl: entry.gitRepoUrl || '',
      cached: true
    };
  }

  let branch = '';
  let dirty = '';
  try {
    const porcelain = execFileSync('git', ['-C', project, 'status', '--porcelain', '-b'], {
      timeout: 1500,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const parsed = parsePorcelainBranchAndDirty(porcelain);
    branch = parsed.branch;
    dirty = parsed.dirty;
  } catch (_) {
    branch = '';
    dirty = '';
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

  return { branch, dirty, gitRepoUrl, cached: false };
}

module.exports = {
  getGitInfo,
  parsePorcelainBranchAndDirty,
  normalizeRemoteUrl
};
