const assert = require('assert');
const { formatResetTime, getContextCapacity, resolveQuotaSegments, quotaPct } = require('../src/quota');
const { parseTranscript } = require('../src/transcript');

assert.strictEqual(formatResetTime(6120), '1h 42m');
assert.strictEqual(formatResetTime(900), '15m');

// Context capacities
assert.strictEqual(getContextCapacity('Gemini 4 Argon'), 1000000);
assert.strictEqual(getContextCapacity('gemini-4-argon'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.5 Flash'), 1000000);
assert.strictEqual(getContextCapacity('Claude Opus 4.6'), 200000);

// Quota percentage helper
assert.strictEqual(quotaPct({ remaining_fraction: 0.85 }), 85);
assert.strictEqual(quotaPct({ remaining_fraction: 0 }), 0);
assert.strictEqual(quotaPct(null), 100);

// Test 1: Gemini 4 Argon on Pro plan -> ONLY argon-wk segment
const argonProPayload = {
  model: { display_name: 'Gemini 4 Argon' },
  plan_tier: 'Google AI Pro',
  quota: {
    'gemini-argon-wtu-weekly': { remaining_fraction: 0.11, reset_in_seconds: 584397 },
    'gemini-5h': { remaining_fraction: 1.0, reset_in_seconds: 18000 },
    'gemini-weekly': { remaining_fraction: 0.99, reset_in_seconds: 580000 }
  }
};
const argonProSegs = resolveQuotaSegments(argonProPayload);
assert.strictEqual(argonProSegs.length, 1);
assert.strictEqual(argonProSegs[0].id, 'argon-wk');
assert.strictEqual(argonProSegs[0].label, 'argon-wk');
assert.strictEqual(argonProSegs[0].pct, 11);
assert.strictEqual(argonProSegs[0].resetSeconds, 584397);

// Test 2: Gemini 4 Argon on non-Pro plan (e.g. Ultra or standard) -> standard 5h and wk
const argonNonProPayload = {
  model: { display_name: 'Gemini 4 Argon' },
  plan_tier: 'Google AI Ultra',
  quota: {
    'gemini-argon-wtu-weekly': { remaining_fraction: 0.11, reset_in_seconds: 584397 },
    'gemini-5h': { remaining_fraction: 0.75, reset_in_seconds: 14000 },
    'gemini-weekly': { remaining_fraction: 0.88, reset_in_seconds: 400000 }
  }
};
const argonNonProSegs = resolveQuotaSegments(argonNonProPayload);
assert.strictEqual(argonNonProSegs.length, 2);
assert.strictEqual(argonNonProSegs[0].label, '5h');
assert.strictEqual(argonNonProSegs[0].pct, 75);
assert.strictEqual(argonNonProSegs[1].label, 'wk');
assert.strictEqual(argonNonProSegs[1].pct, 88);

// Test 3: Standard Gemini on Pro plan -> standard 5h and wk
const regularGeminiPayload = {
  model: { display_name: 'Gemini 3.8 Flash (High)' },
  plan_tier: 'Google AI Pro',
  quota: {
    'gemini-5h': { remaining_fraction: 0.95, reset_in_seconds: 17000 },
    'gemini-weekly': { remaining_fraction: 0.99, reset_in_seconds: 580000 },
    'gemini-argon-wtu-weekly': { remaining_fraction: 0.11, reset_in_seconds: 584397 }
  }
};
const regularGeminiSegs = resolveQuotaSegments(regularGeminiPayload);
assert.strictEqual(regularGeminiSegs.length, 2);
assert.strictEqual(regularGeminiSegs[0].label, '5h');
assert.strictEqual(regularGeminiSegs[0].pct, 95);
assert.strictEqual(regularGeminiSegs[1].label, 'wk');
assert.strictEqual(regularGeminiSegs[1].pct, 99);

// Test 4: Claude / GPT 3P models -> 3p-5h and 3p-weekly
const claudePayload = {
  model: { display_name: 'Claude Sonnet 4' },
  plan_tier: 'Google AI Pro',
  quota: {
    '3p-5h': { remaining_fraction: 0.60, reset_in_seconds: 9000 },
    '3p-weekly': { remaining_fraction: 0.70, reset_in_seconds: 350000 }
  }
};
const claudeSegs = resolveQuotaSegments(claudePayload);
assert.strictEqual(claudeSegs.length, 2);
assert.strictEqual(claudeSegs[0].label, '5h');
assert.strictEqual(claudeSegs[0].pct, 60);
assert.strictEqual(claudeSegs[1].label, 'wk');
assert.strictEqual(claudeSegs[1].pct, 70);

const gptPayload = {
  model: { display_name: 'GPT-5 Turbo' },
  quota: {
    '3p-5h': { remaining_fraction: 0.40, reset_in_seconds: 7000 },
    '3p-weekly': { remaining_fraction: 0.50, reset_in_seconds: 250000 }
  }
};
const gptSegs = resolveQuotaSegments(gptPayload);
assert.strictEqual(gptSegs.length, 2);
assert.strictEqual(gptSegs[0].label, '5h');
assert.strictEqual(gptSegs[0].pct, 40);

console.log('✔ Parser & quota test passed');
