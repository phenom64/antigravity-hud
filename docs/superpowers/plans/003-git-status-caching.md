# Plan 003: Cache git branch, dirty status, and remote URL across render ticks

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C "C:/Users/Kavish Krishnakumar/Developer/antigravity-hud" diff --stat 00c6adc..HEAD -- bin/antigravity-hud.js tests/test-parser.js`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-transcript-and-speed-cache.md
- **Category**: perf
- **Planned at**: commit `00c6adc`, 2026-11-22

## Why this matters

On every statusline render tick, `bin/antigravity-hud.js` synchronously spawns three separate `git` processes via `execFileSync`: `git branch --show-current`, `git status --porcelain`, and `git remote get-url origin`. On Windows, spawning 3 `git.exe` processes per tick adds 100–300ms+ of blocking overhead (and heavy disk I/O on large repositories), even though `remote get-url origin` almost never changes and `branch`/`status` only need refreshing every few seconds.

## Current state

Relevant files:
- `bin/antigravity-hud.js` — inline `execFileSync('git', ...)` calls at lines 905–937.

Current excerpt from `bin/antigravity-hud.js:905-937`:
```js
  // ─── GIT BRANCH ────────────────────────────────────────────────────────────────
  let branch = '';
  let dirty  = '';
  let gitRepoUrl = '';
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

    try {
      let rawRemote = execFileSync('git', ['-C', project, 'remote', 'get-url', 'origin'], {
        timeout: 3000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (rawRemote) {
        rawRemote = rawRemote.replace(/\.git$/, '');
        if (rawRemote.startsWith('git@')) {
          rawRemote = rawRemote.replace(/^git@([^:]+):/, 'https://$1/');
        }
        if (rawRemote.startsWith('https://') || rawRemote.startsWith('http://')) {
          gitRepoUrl = `${rawRemote}/tree/${encodeURIComponent(branch)}`;
        }
      }
    } catch (_) { /* no remote origin */ }
  }
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run parser tests | `node tests/test-parser.js` | `✔ Parser & quota test passed` (exit 0) |
| Run all tests | `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` | all 4 print `✔ ... passed` (exit 0) |

## Scope

**In scope**:
- `src/git.js` (create)
- `bin/antigravity-hud.js`
- `tests/test-parser.js`

**Out of scope**:
- `legacy/statusline-syn.ps1`

## Git workflow

- Branch: `advisor/003-git-status-caching`
- Commit message style: Conventional Commits (e.g. `perf: cache git branch, dirty state, and remote URL with TTL`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Create `src/git.js` with TTL-cached `getGitInfo(project, options = {})`

Create `src/git.js` using only Node.js built-ins (`fs`, `path`, `os`, `child_process`):
1. Define `DEFAULT_STATUS_TTL_MS = 5000` (5 seconds for branch & dirty state) and `DEFAULT_REMOTE_TTL_MS = 60000` (60 seconds for remote origin URL).
2. Read cache file (`options.cachePath || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-state.json')`). Store git entries under `state.gitCache = state.gitCache || {}` keyed by `project` (keeping at most 10 recent project entries to avoid unbounded growth).
3. If `entry && (now - entry.statusTimestamp) < statusTtlMs`, return `{ branch: entry.branch, dirty: entry.dirty, gitRepoUrl: entry.gitRepoUrl }` immediately with **zero** `git` subprocess spawns.
4. When refreshing:
   - Run `git -C <project> status --porcelain -b` in a **single** `execFileSync` call (`timeout: 1500, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']`) to get both the current branch (`## branch...` on line 1) and whether the working tree is dirty (any subsequent non-empty line), cutting 2 subprocesses down to 1! If detached HEAD (`## HEAD (no branch)`), set `branch = ''`.
   - Only run `git -C <project> remote get-url origin` if `branch` is non-empty AND (`!entry || !entry.remoteTimestamp || (now - entry.remoteTimestamp) >= remoteTtlMs`). Normalize `git@host:owner/repo.git` to `https://host/owner/repo` and build `gitRepoUrl = rawBase ? `${rawBase}/tree/${encodeURIComponent(branch)}` : ''`.
   - Persist updated `state.gitCache[project]` back to `cachePath` (preserving existing top-level keys in `antigravity-hud-state.json` such as `transcriptPath` and `conversationId`).
5. Export `{ getGitInfo, parsePorcelainBranchAndDirty }`.

**Verify**: `node -e "const g = require('./src/git'); console.log(g.parsePorcelainBranchAndDirty('## master...origin/master\n M file.js\n'));"` → `{ branch: 'master', dirty: '*' }`

### Step 2: Replace inline `git` calls in `bin/antigravity-hud.js` with `getGitInfo(project)`

In `bin/antigravity-hud.js`:
1. Import `{ getGitInfo } = require('../src/git')`.
2. Replace lines 906–937 with:
   `const { branch, dirty, gitRepoUrl } = getGitInfo(project);`

**Verify**: `node bin/antigravity-hud.js doctor` → exits 0

### Step 3: Add unit tests for `parsePorcelainBranchAndDirty` and TTL caching in `tests/test-parser.js`

In `tests/test-parser.js`, test:
1. `parsePorcelainBranchAndDirty('## main...origin/main\n')` returns `{ branch: 'main', dirty: '' }`.
2. `parsePorcelainBranchAndDirty('## feat/hud\n?? newfile.js\n')` returns `{ branch: 'feat/hud', dirty: '*' }`.
3. `getGitInfo` returns cached values on a second call within TTL without spawning `git`.

**Verify**: `node tests/test-parser.js` → `✔ Parser & quota test passed`

## Test plan

- Unit tests in `tests/test-parser.js` for `parsePorcelainBranchAndDirty` (clean branch, dirty branch, detached HEAD) and cache hit within TTL.
- Verification: `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` → all pass.

## Done criteria

- [ ] `src/git.js` exists and combines branch + dirty detection into a single `git status --porcelain -b` call cached with a 5s TTL
- [ ] `node tests/test-parser.js` exits 0
- [ ] `node tests/test-hyperlinks.js && node tests/test-render.js && node tests/test-integration.js` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:
- `git status --porcelain -b` behaves unexpectedly on the local git version.
- Any existing test fails after two fix attempts.

## Maintenance notes

- `getGitInfo` shares `antigravity-hud-state.json` with `resolveTranscript` by reading and merging top-level JSON keys before writing.
