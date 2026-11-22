# Plan 001: Fix transcript cache pinning and scope speed cache by conversation ID

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

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `00c6adc`, 2026-11-22

## Why this matters

Currently, `resolveTranscript(j)` in `bin/antigravity-hud.js` checks `~/.gemini/antigravity-cli/antigravity-hud-state.json` before checking the stdin payload's `conversation_id` or `transcript_path`, and returns the cached path whenever `fs.existsSync(cachedPath)` is true. Because old conversation transcripts are never deleted when a new session starts, the HUD remains permanently pinned to an old conversation's `transcript.jsonl`, showing stale tool counts, shell counts, and subagent counts in every new session. Additionally, Antigravity CLI v1.5.14 emits `transcript_path` pointing to `.gemini/antigravity/brain/<id>/...` whereas the CLI writes transcripts to `.gemini/antigravity-cli/brain/<id>/...`, and `getSpeed()` in `bin/antigravity-hud.js` does not scope `speed-cache.json` by `conversation_id`, causing bogus token-per-second spikes when switching conversations.

## Current state

Relevant files:
- `bin/antigravity-hud.js` — Main CLI entrypoint containing `getSpeed` (lines 234–264), `saveTranscriptCache` & `resolveTranscript` (lines 309–374), and `runHud` (lines 852–995).
- `tests/test-parser.js` — Unit test suite for parser and quota helpers.

Current excerpt from `bin/antigravity-hud.js:234-264`:
```js
function getSpeed(currentTokens, cachePath) {
  let cache = { lastTokens: 0, lastTimestamp: 0, lastSpeed: 0 };
  try {
    if (fs.existsSync(cachePath)) {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    }
  } catch (_) {}

  const now = Date.now();
  const dt = (now - cache.lastTimestamp) / 1000;
  let speed = cache.lastSpeed || 0;

  if (dt >= 0.5) {
    const dTokens = currentTokens - cache.lastTokens;
    if (dTokens > 0) {
      speed = dTokens / dt;
    } else if (dTokens < 0) {
      speed = 0; // reset
    } else {
      if (dt > 3) speed = 0; // idle decay
    }
    try {
      fs.writeFileSync(cachePath, JSON.stringify({
        lastTokens: currentTokens,
        lastTimestamp: now,
        lastSpeed: speed
      }), 'utf8');
    } catch (_) {}
  }
  return speed;
}
```

Current excerpt from `bin/antigravity-hud.js:309-374`:
```js
function saveTranscriptCache(statePath, tPath) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      transcriptPath: tPath,
      transcriptMtime: Date.now()
    }, null, 2), 'utf8');
  } catch (_) {}
}

/** Locate the best transcript.jsonl to parse. */
function resolveTranscript(j) {
  // 0. AGY_HUD_TRANSCRIPT env override (handy for local testing)
  if (process.env.AGY_HUD_TRANSCRIPT) {
    try { if (fs.existsSync(process.env.AGY_HUD_TRANSCRIPT)) return process.env.AGY_HUD_TRANSCRIPT; } catch (_) {}
  }

  const statePath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-state.json');
  let cachedPath = null;

  // 1. Try reading state cache
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      cachedPath = state.transcriptPath;
    }
  } catch (_) {}

  // Check if cache is still valid
  if (cachedPath) {
    try {
      if (fs.existsSync(cachedPath)) {
        return cachedPath;
      }
    } catch (_) {
      cachedPath = null;
    }
  }

  // 2. Explicit path from payload
  if (j && j.transcript_path) {
    try {
      if (fs.existsSync(j.transcript_path)) {
        saveTranscriptCache(statePath, j.transcript_path);
        return j.transcript_path;
      }
    } catch (_) {}
  }

  // 3. Search common brain directories for newest transcript.jsonl
  const home = os.homedir();
  const searchDirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'brain'),
    path.join(home, '.gemini', 'antigravity', 'brain'),
  ];
  let all = [];
  for (const d of searchDirs) {
    try { if (fs.existsSync(d)) all.push(...findFiles(d, 'transcript.jsonl')); } catch (_) {}
  }
  if (all.length === 0) return null;
  all.sort((a, b) => b.mtime - a.mtime);
  const foundPath = all[0].path;

  saveTranscriptCache(statePath, foundPath);
  return foundPath;
}
```

Current excerpt from `bin/antigravity-hud.js:870-871`:
```js
  const cachePath   = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'speed-cache.json');
  const streamSpeed = getSpeed(ctxOut, cachePath);
```

Repo conventions:
- Zero external npm dependencies; CommonJS (`'use strict';`) using only Node.js built-ins (`fs`, `path`, `os`, `assert`).
- All file I/O errors in the HUD hot path must be caught with `try { ... } catch (_) {}` so the statusline never crashes.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run parser tests | `node tests/test-parser.js` | `✔ Parser & quota test passed` (exit 0) |
| Run all tests | `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` | all 4 print `✔ ... passed` (exit 0) |

## Scope

**In scope** (the only files you should modify):
- `bin/antigravity-hud.js`
- `src/transcript.js`
- `tests/test-parser.js`

**Out of scope** (do NOT touch):
- `legacy/statusline-syn.ps1`
- `src/quota.js` (covered in Plan 002)

## Git workflow

- Branch: `advisor/001-transcript-and-speed-cache`
- Commit message style: Conventional Commits matching repo history (e.g. `fix: invalidate transcript and speed caches on conversation change`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add `resolveTranscript` and `getSpeed` helpers to `src/transcript.js` and export them

In `src/transcript.js`, add and export `resolveTranscript(j, options = {})` and `getSpeed(currentTokens, cachePath, convId)` so both `bin/antigravity-hud.js` and `tests/test-parser.js` can call and unit-test them directly:

1. `resolveTranscript(j, options = {})`:
   - `const home = options.homedir || os.homedir();`
   - `const statePath = options.statePath || path.join(home, '.gemini', 'antigravity-cli', 'antigravity-hud-state.json');`
   - Step 0: If `process.env.AGY_HUD_TRANSCRIPT` is set and exists on disk, return it immediately.
   - Determine active conversation ID: `const convId = (j && (j.conversation_id || j.session_id)) ? String(j.conversation_id || j.session_id) : null;`
   - Step 1 (Explicit path & conversation-id path resolution):
     Build candidate paths in priority order:
     - If `j && j.transcript_path`, push `j.transcript_path`, and also push `j.transcript_path.replace(/([\\/]\.gemini[\\/])antigravity([\\/]brain[\\/])/i, '$1antigravity-cli$2')` if different (fixes the `agy` v1.5.14 `.gemini/antigravity/brain` vs `.gemini/antigravity-cli/brain` path discrepancy).
     - If `convId`, push:
       - `path.join(home, '.gemini', 'antigravity-cli', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl')`
       - `path.join(home, '.gemini', 'antigravity', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl')`
     - Check each candidate with `fs.existsSync(candidate)`. On the first hit, save `{ conversationId: convId, transcriptPath: candidate, transcriptMtime: Date.now() }` to `statePath` (preserving any other fields in `statePath` if it already exists) and return `candidate`.
   - Step 2 (State cache check):
     Read `statePath` if it exists. Only accept `state.transcriptPath` if `fs.existsSync(state.transcriptPath)` is true **AND** (`!convId` || `state.conversationId === convId` || `state.transcriptPath.includes(convId)`).
   - Step 3 (Fallback directory scan):
     Scan `searchDirs` (`brain` dirs under `.gemini/antigravity-cli` and `.gemini/antigravity`) for `transcript.jsonl`, sort by `mtime` descending, save to `statePath` with `conversationId: convId`, and return `foundPath`.
2. `getSpeed(currentTokens, cachePath, convId = null)`:
   - Read existing `cache` from `cachePath`.
   - If `convId && cache.conversationId && cache.conversationId !== convId`, reset `cache = { conversationId: convId, lastTokens: currentTokens, lastTimestamp: Date.now(), lastSpeed: 0 }`, write it to `cachePath`, and return `0`.
   - Otherwise compute `speed` as before and persist `conversationId: convId || cache.conversationId || null` in `cachePath`.

**Verify**: `node -e "const t = require('./src/transcript'); console.log(typeof t.resolveTranscript, typeof t.getSpeed);"` → `function function`

### Step 2: Wire `resolveTranscript` and `getSpeed` in `bin/antigravity-hud.js`

In `bin/antigravity-hud.js`:
1. Import `resolveTranscript` and `getSpeed` from `../src/transcript`.
2. Remove the duplicate inline definitions of `getSpeed`, `findFiles`, `saveTranscriptCache`, and `resolveTranscript` from `bin/antigravity-hud.js`.
3. In `runHud(raw)`, pass `j.conversation_id || j.session_id || null` as the 3rd argument to `getSpeed(ctxOut, cachePath, j.conversation_id || j.session_id || null)`.

**Verify**: `node bin/antigravity-hud.js doctor` → exits 0 and prints `[OK] Sample render complete.`

### Step 3: Add unit tests for conversation-scoped transcript and speed caches in `tests/test-parser.js`

In `tests/test-parser.js`, add tests using a temporary directory (`fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hud-test-'))`) verifying:
1. When `antigravity-hud-state.json` caches conversation `conv-old`, calling `resolveTranscript({ conversation_id: 'conv-new', transcript_path: '...' })` where `.gemini/antigravity/brain/conv-new/...` is remapped to `.gemini/antigravity-cli/brain/conv-new/...` resolves `conv-new`'s transcript instead of returning `conv-old`.
2. Calling `getSpeed(500, tmpSpeedCache, 'conv-1')` followed by `getSpeed(2000, tmpSpeedCache, 'conv-2')` resets speed to `0` on conversation switch instead of spiking.
3. Clean up the temporary directory with `fs.rmSync(tmpDir, { recursive: true, force: true })`.

**Verify**: `node tests/test-parser.js` → `✔ Parser & quota test passed`

## Test plan

- New unit tests in `tests/test-parser.js` covering:
  - Cache invalidation when `conversation_id` changes between sessions.
  - Automatic path repair when `transcript_path` points to `.gemini/antigravity/brain/<id>` but the file resides in `.gemini/antigravity-cli/brain/<id>`.
  - Speed cache reset when `conversation_id` changes.
- Pattern: follow existing `assert.strictEqual` style in `tests/test-parser.js`.
- Verification: `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` → all 4 test files pass.

## Done criteria

- [ ] `node tests/test-parser.js` exits 0 with new cache invalidation and speed scoping tests passing
- [ ] `node tests/test-hyperlinks.js && node tests/test-render.js && node tests/test-integration.js` exits 0
- [ ] `resolveTranscript` no longer returns a cached transcript from a different `conversation_id`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:
- The code at `bin/antigravity-hud.js:234-374` does not match the "Current state" excerpts.
- Any existing test in `tests/` fails after two fix attempts.
- The fix requires modifying files outside `bin/antigravity-hud.js`, `src/transcript.js`, and `tests/test-parser.js`.

## Maintenance notes

- Keep `antigravity-hud-state.json` reads/writes preserving unrelated keys in the JSON object so Plan 003 (git status caching) can share `antigravity-hud-state.json` without key collisions.
