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

// Test 2: Gemini 4 Argon on Google AI Pro
const argonLines = renderHUD(
  {
    model: { display_name: 'Gemini 4 Argon' },
    plan_tier: 'Google AI Pro',
    cwd: 'C:/Users/found/Developer/antigravity-hud',
    quota: {
      'gemini-argon-wtu-weekly': { remaining_fraction: 0.11, reset_in_seconds: 584397 }
    }
  },
  { preset: 'full', enableLinks: true },
  {}
);

assert.strictEqual(argonLines.length, 4);
assert.ok(argonLines[0].includes('Gemini 4 Argon'));
assert.ok(argonLines[1].includes('argon-wk'));
assert.ok(!argonLines[1].includes('5h Quota')); // 5h quota suppressed for Argon Pro
assert.ok(!argonLines.some(l => l.includes('RAM '))); // RAM metric removed

console.log('✔ Line renderer test passed');
