const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const binPath = path.join(__dirname, '../bin/antigravity-hud.js');
const output = execFileSync(process.execPath, [binPath, 'doctor'], { encoding: 'utf8' });

assert.ok(output.includes('Antigravity HUD Diagnostics') || output.includes('Doctor'));
console.log('✔ Integration doctor test passed');
