const assert = require('assert');
const { renderHUD } = require('../src/render/lines');

const lines = renderHUD(
  { model: 'Gemini 3.5 Flash', cwd: 'C:/Users/found/Developer/antigravity-hud' },
  { preset: 'full', enableLinks: true },
  { activeSubagents: [{ role: 'research', startTime: new Date() }] }
);

assert.strictEqual(lines.length, 4);
assert.ok(lines[0].includes('Gemini 3.5 Flash'));
assert.ok(lines[0].includes('\x1b]8;;')); // OSC 8 link present
assert.ok(lines[2].includes('Subagents'));

console.log('✔ Line renderer test passed');
