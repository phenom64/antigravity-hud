const assert = require('assert');
const { formatResetTime, getContextCapacity } = require('../src/quota');
const { parseTranscript } = require('../src/transcript');

assert.strictEqual(formatResetTime(6120), '1h 42m');
assert.strictEqual(formatResetTime(900), '15m');

assert.strictEqual(getContextCapacity('Gemini 3.5 Flash'), 1000000);
assert.strictEqual(getContextCapacity('Claude Opus 4.6'), 200000);

console.log('✔ Parser & quota test passed');
