# Plan 004: Unify modular `src/` architecture with `bin/antigravity-hud.js` and wire real renderer tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git -C "C:/Users/Kavish Krishnakumar/Developer/antigravity-hud" diff --stat 00c6adc..HEAD -- bin/antigravity-hud.js src/hyperlinks.js src/transcript.js src/render/lines.js tests/test-render.js`
> Note: Plans 001, 002, and 003 modify `bin/antigravity-hud.js`, `src/transcript.js`, and `tests/test-parser.js`. Ensure Plans 001–003 are `DONE` in `plans/README.md` before executing this plan.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-transcript-and-speed-cache.md, plans/002-agy-v1.5-payload-models-and-telemetry.md, plans/003-git-status-caching.md
- **Category**: tech-debt
- **Planned at**: commit `00c6adc`, 2026-11-22

## Why this matters

In v0.4.0, modular files (`src/config.js`, `src/hyperlinks.js`, `src/quota.js`, `src/transcript.js`, `src/render/lines.js`) were created and wired to unit tests (`tests/test-render.js`), but `bin/antigravity-hud.js` only imported them on lines 16–20 without calling `makeLink`, `parseTranscript`, `formatResetTime`, `getContextCapacity`, or `renderHUD`. As a result:
1. `src/render/lines.js` is an unused prototype with hardcoded bars (`██░░░░░░░░`) and a fake session timer (`⏱️ 14m 20s`).
2. `tests/test-render.js` only tests the unused `src/render/lines.js` module and never tests the actual CLI output rendered by `bin/antigravity-hud.js`.
3. Every feature change has to be written twice (once in `bin/antigravity-hud.js` and once in `src/render/lines.js`).

## Current state

Relevant files:
- `bin/antigravity-hud.js` — imports unused `makeLink`, `parseTranscript`, `formatResetTime`, `getContextCapacity`, `renderHUD` (lines 16–20), defines duplicate `fmtReset` (lines 129–137), inline transcript parser (lines 942–1012), and inline renderer (lines 1013–1200).
- `src/hyperlinks.js` — `makeLink(text, url, enableLinks = true)` (lines 1–12).
- `src/transcript.js` — `parseTranscript(transcriptPath)` (lines 1–60).
- `src/render/lines.js` — `renderHUD(payload, config, transcriptData, options = {})` (lines 1–90).
- `tests/test-render.js` — tests `renderHUD` (lines 1–39).

Current excerpt from `src/hyperlinks.js:1-12`:
```js
'use strict';

/**
 * Generate an OSC 8 ANSI terminal hyperlink string.
 * Format: \x1b]8;;<URL>\x1b\<TEXT>\x1b]8;;\x1b\
 */
function makeLink(text, url, enableLinks = true) {
  if (!enableLinks || !url) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

module.exports = { makeLink };
```

Current excerpt from `tests/test-render.js:1-39`:
```js
const assert = require('assert');
const { renderHUD } = require('../src/render/lines');

// Test 1: Standard Gemini render
const lines = renderHUD(
  { model: 'Gemini 3.5 Flash', cwd: 'C:/Users/found/Developer/antigravity-hud' },
  { preset: 'full', enableLinks: true },
  { activeSubagents: [{ role: 'research', startTime: new Date() }] }
);

assert.strictEqual(lines.length, 4);
assert.ok(lines[0].includes('Gemini 3.5 Flash'));
assert.ok(lines[0].includes('\x1b]8;;')); // OSC 8 link present
assert.ok(lines[1].includes('5h Quota'));
assert.ok(lines[1].includes('Weekly'));
assert.ok(!lines.some(l => l.includes('RAM '))); // RAM metric removed
assert.ok(lines[2].includes('Subagents'));
```

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run render tests | `node tests/test-render.js` | `✔ Line renderer test passed` (exit 0) |
| Run all tests | `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` | all 4 print `✔ ... passed` (exit 0) |

## Scope

**In scope**:
- `src/hyperlinks.js`
- `src/transcript.js`
- `src/render/lines.js`
- `bin/antigravity-hud.js`
- `tests/test-render.js`

**Out of scope**:
- `legacy/statusline-syn.ps1`

## Git workflow

- Branch: `advisor/004-unify-src-and-bin-architecture`
- Commit message style: Conventional Commits (e.g. `refactor: unify CLI renderer and transcript parser into src modules`)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Unify `parseTranscript` and `categoriseTool` in `src/transcript.js`

In `src/transcript.js`:
1. Move `readLastBytes(filePath, maxBytes)` and `categoriseTool(toolName)` from `bin/antigravity-hud.js` into `src/transcript.js` and export them alongside `parseTranscript`, `resolveTranscript`, and `getSpeed`.
2. Update `parseTranscript(transcriptPath, initialTaskCount = 0)` so it performs the exact bounded 256KB tail read (`readLastBytes(transcriptPath, 262144)` with partial first-line drop when `content.length >= 262144`) and computes:
   - `toolCounts` (category → count) and `toolLastSeen` (category → sequence number)
   - `rawToolCounts` (raw tool name → count)
   - `shellCount`, `taskCount`, `agentInvoked`, `activeAgents`
   - `activeSubagents`: track `invoke_subagent` calls (extracting `Role` or `TypeName` even when `tc.args` values are JSON-quoted strings as in `agy` v1.5.14 transcripts, e.g. `String(tc.args.Role || '').replace(/^"|"$/g, '')`, and recording `startTime` from `entry.created_at || entry.timestamp`).

**Verify**: `node -e "const t = require('./src/transcript'); const res = t.parseTranscript('docs/payload-examples/transcript.example.jsonl'); console.log(res.toolCounts.read, res.shellCount);"` → `3 2`

### Step 2: Add `toFileUrl(p)` to `src/hyperlinks.js` and use `makeLink` everywhere

In `src/hyperlinks.js`:
1. Add and export `toFileUrl(p)`:
   ```js
   function toFileUrl(p) {
     if (!p) return '';
     let normalized = String(p).replace(/\\/g, '/');
     if (!normalized.startsWith('/')) normalized = '/' + normalized;
     return `file://${normalized}`;
   }
   ```
2. Export `{ makeLink, toFileUrl }`.

**Verify**: `node tests/test-hyperlinks.js` → `✔ Hyperlinks & Config test passed`

### Step 3: Move the production HUD line rendering from `bin/antigravity-hud.js` into `src/render/lines.js`

In `src/render/lines.js`:
1. Implement `renderHUD(payload, config, transcriptData, options = {})` using the real production rendering logic from `bin/antigravity-hud.js` (adaptive `normal`/`compact`/`tiny` layouts, custom ANSI/hex colors, `makeLink`/`toFileUrl`, `resolveQuotaSegments`, `formatResetTime`, `getContextCapacity`, tool tallies sorted by `toolLastSeen`, permission mode badges, and `minimal`/`essential`/`full` preset slicing), returning the array of rendered lines (`[line1]`, `[line1, line2]`, or `[line1, line2, line3, line4]`).
2. Support both `transcriptData` shapes: if `transcriptData` came from `parseTranscript()`, use its `toolCounts`, `toolLastSeen`, `shellCount`, `taskCount`, `agentInvoked`, `activeAgents`; if a caller passed `{ activeSubagents: [...] }` or empty `{}` in unit tests, handle gracefully without throwing.
3. In `bin/antigravity-hud.js`, replace the inline transcript parsing and line rendering in `runHud(raw)` with calls to `resolveTranscript`, `parseTranscript`, `getGitInfo`, `getSpeed`, and `renderHUD`, writing `lines.join('\n') + '\n'` to `process.stdout`. Remove duplicate `fmtReset`.

**Verify**: `node bin/antigravity-hud.js doctor` → exits 0 and renders the 4-line HUD sample cleanly.

### Step 4: Update `tests/test-render.js` to test the unified production renderer

In `tests/test-render.js`:
1. Verify `renderHUD` output for:
   - Standard Gemini (`Gemini 3.5 Flash`): 4 lines in `full` preset, OSC 8 link present (`\x1b]8;;`), `5h` and `wk` quota bars present, no `RAM ` metric, tool tallies rendered on Line 3, permission mode and shell/agents on Line 4.
   - Gemini 4 Argon on `Google AI Pro`: 4 lines, `argon-wk` present on Line 2, `5h` suppressed when `gemini-5h` is healthy.
   - Presets: `minimal` returns 1 line, `essential` returns 2 lines.
   - Layout modes: `tiny` layout omits progress bar blocks (`█`/`░`) and shortens `Gemini 4 Argon (High)` to `G4 Argon (H)`.

**Verify**: `node tests/test-render.js` → `✔ Line renderer test passed`

## Test plan

- `tests/test-render.js` tests the actual production renderer across:
  - Standard Gemini vs. Argon Pro quota display
  - `full` (4 lines), `essential` (2 lines), and `minimal` (1 line) presets
  - `normal` vs. `tiny` layout adaptation
  - OSC 8 hyperlink generation and `enableLinks: false` disabling
- Verification: `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` → all 4 pass.

## Done criteria

- [ ] `bin/antigravity-hud.js` delegates transcript parsing to `src/transcript.js` and HUD rendering to `src/render/lines.js`
- [ ] `fmtReset` duplicate is removed from `bin/antigravity-hud.js` in favor of `formatResetTime` from `src/quota.js`
- [ ] All OSC 8 links in HUD output are generated via `makeLink` from `src/hyperlinks.js`
- [ ] `node tests/test-hyperlinks.js && node tests/test-parser.js && node tests/test-render.js && node tests/test-integration.js` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:
- Any CLI subcommand (`install`, `uninstall`, `doctor`, `configure`, `mode`, `--help`) breaks or changes its external CLI behavior.
- Any test fails after two fix attempts.

## Maintenance notes

- Now that `src/render/lines.js` is the single renderer used by both `bin/antigravity-hud.js` and `tests/test-render.js`, any future visual tweak to Line 1–4 only needs to be edited in `src/render/lines.js`.
