# Gemini 4 Argon Quota & RAM Removal Design Specification

## Overview

This specification details the update to `antigravity-hud` to support **Gemini 4 Argon**, specifically its separate weekly limit (`gemini-argon-wtu-weekly`) for subscribers on Google AI Pro plans. It also removes the unnecessary RAM percentage metric from the HUD display and configuration.

## Requirements & Business Rules

1. **Argon Weekly Limit for Pro Subscribers**:
   - When the user is on a **Pro plan** (`plan_tier` matches `/pro/i`, e.g. `"Google AI Pro"`) **AND** using an **Argon model** (`model.id` or `model.display_name` matches `/argon/i`):
     - Display **only** the Argon weekly quota on Line 2.
     - The segment label is `argon-wk` (e.g. `argon-wk [██░░░░] 11% 6d 18h`).
     - Suppress/hide the standard 5-hour quota (`5h`) segment.
2. **Standard Gemini Models**:
   - When using regular Gemini models (e.g. `Gemini 3.5 Flash`, `Gemini 3.0 Pro`), or an Argon model on a non-Pro tier:
     - Display both `5h` (from `gemini-5h`) and `wk` (from `gemini-weekly`).
3. **Third-Party Models (Claude / GPT)**:
   - When using 3P models (`model` matches `/claude|opus|sonnet|gpt/i`):
     - Display both `5h` (from `3p-5h`) and `wk` (from `3p-weekly`).
4. **Context Window & Pricing for Argon**:
   - Context capacity fallback for `argon` in `getContextCapacity()` is set to `1000000` (1M tokens).
   - In `MODEL_PRICING`, add pricing for `gemini-4-argon` / `argon`.
5. **RAM Percentage Removal**:
   - Remove RAM percentage tracking (`getRamUsage`) and its display on Line 2 (and Line 1 in minimal/essential presets).
   - Remove `showMemory` option from configuration wizard and defaults.

---

## Architecture & Modular Components

### 1. Quota Resolution Engine (`src/quota.js`)

Add `resolveQuotaSegments(payload)` to `src/quota.js`:
- Inputs: `payload` (the parsed stdin JSON object).
- Extracts:
  - `modelName`: `dig(payload, 'model', 'display_name') || dig(payload, 'model', 'id') || payload.model || ''`
  - `planTier`: `payload.plan_tier || ''`
  - `quota`: `payload.quota || {}`
- Detection:
  - `isArgon`: `/argon/i.test(modelName)`
  - `isPro`: `/pro/i.test(planTier)`
  - `is3p`: `/claude|opus|sonnet|gpt/i.test(modelName)`
- Segments returned:
  - **Argon Pro**:
    Key resolved: `quota['gemini-argon-wtu-weekly']` (or key matching `/argon.*week/i`).
    Returns:
    ```js
    [
      {
        id: 'argon-wk',
        label: 'argon-wk',
        quota: qArgon,
        pct: quotaPct(qArgon),
        resetSeconds: qArgon.reset_in_seconds
      }
    ]
    ```
  - **3P Models**:
    Returns two segments:
    - `{ id: '5h', label: '5h', quota: q5h, pct: quotaPct(q5h), resetSeconds: q5h.reset_in_seconds }` (from `3p-5h`)
    - `{ id: 'wk', label: 'wk', quota: qWk, pct: quotaPct(qWk), resetSeconds: qWk.reset_in_seconds }` (from `3p-weekly`)
  - **Default (Standard Gemini or Non-Pro Argon)**:
    Returns two segments:
    - `{ id: '5h', label: '5h', quota: q5h, pct: quotaPct(q5h), resetSeconds: q5h.reset_in_seconds }` (from `gemini-5h`)
    - `{ id: 'wk', label: 'wk', quota: qWk, pct: quotaPct(qWk), resetSeconds: qWk.reset_in_seconds }` (from `gemini-weekly`)

Export `resolveQuotaSegments` and `quotaPct` alongside `formatResetTime` and `getContextCapacity`.

### 2. HUD Main CLI (`bin/antigravity-hud.js`)

- Import `resolveQuotaSegments` from `../src/quota`.
- Update `runHud()`:
  - Call `const quotaSegments = resolveQuotaSegments(j);`.
  - Format segments:
    ```js
    const quotaParts = quotaSegments.map(seg =>
      quotaSegment(seg.label, seg.pct, seg.resetSeconds, barLen)
    );
    const line2Parts = [ctxLabel, ...quotaParts];
    ```
  - Remove RAM calculation (`getRamUsage()`) and RAM string injection into `line1Parts` and `line2Parts`.
  - In `MODEL_PRICING`, add `'gemini-4-argon': { input: 1.25, output: 5.0 }`.
  - In `runConfigure()`, remove step 4 (RAM monitoring question).

### 3. Modular Renderer (`src/render/lines.js`)

- Use `resolveQuotaSegments(payload)` to derive quota display on Line 2.
- Remove RAM / memory display references.

### 4. Configuration Defaults (`src/config.js`)

- Remove `showMemory` from `DEFAULT_CONFIG`.

---

## Testing & Verification Plan

1. **Unit Tests in `tests/test-parser.js`**:
   - Test `resolveQuotaSegments`:
     - Argon with `"plan_tier": "Google AI Pro"` returns single `'argon-wk'` segment.
     - Argon with `"plan_tier": "Google AI Ultra"` or standard plan returns `'5h'` and `'wk'`.
     - Standard Gemini returns `'gemini-5h'` and `'gemini-weekly'`.
     - Claude / GPT returns `'3p-5h'` and `'3p-weekly'`.
   - Test `getContextCapacity('Gemini 4 Argon')` returns `1000000`.
2. **Renderer Tests in `tests/test-render.js`**:
   - Verify rendered Line 2 contains `argon-wk` and does not contain `5h Quota` when Argon on Pro is active.
   - Verify RAM percentage is absent from output lines.
3. **Integration Test with Live & Example Payloads**:
   - Run `npm test`.
   - Pipe `docs/payload-examples/statusline-last.example.json` and a synthesized Argon payload into `bin/antigravity-hud.js` and verify output.
