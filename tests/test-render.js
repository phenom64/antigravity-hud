const assert = require('assert');
const { renderHUD } = require('../src/render/lines');

// Test 1: Standard Gemini render (full preset, 4 lines)
const lines = renderHUD(
  {
    model: 'Gemini 3.5 Flash',
    cwd: 'C:/Users/found/Developer/antigravity-hud',
    agent_state: 'working',
    tool_confirmation_pending: true,
    sandbox: { enabled: true },
    context_window: {
      total_input_tokens: 48000,
      total_output_tokens: 4000,
      context_window_size: 1000000,
      used_percentage: 5.2
    },
    quota: {
      'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 10800 },
      'gemini-weekly': { remaining_fraction: 0.91, reset_in_seconds: 561600 }
    }
  },
  { preset: 'full', enableLinks: true, showCost: true, showSpeed: true },
  {
    toolCounts: { read: 5, edit: 2 },
    toolLastSeen: { read: 1, edit: 2 },
    shellCount: 3,
    taskCount: 1,
    agentInvoked: 2
  },
  {
    gitBranch: 'master',
    gitDirty: true,
    gitRepoUrl: 'https://github.com/phenom64/antigravity-hud/tree/master',
    permissionMode: 'proceed-in-sandbox',
    speed: 35.4
  }
);

assert.strictEqual(lines.length, 4);
assert.ok(lines[0].includes('Gemini 3.5 Flash'));
assert.ok(lines[0].includes('\x1b]8;;')); // OSC 8 link present
assert.ok(lines[0].includes('master*'));
assert.ok(lines[0].includes('confirm')); // tool_confirmation_pending badge
assert.ok(lines[1].includes('5h'));
assert.ok(lines[1].includes('wk'));
assert.ok(!lines.some(l => l.includes('RAM '))); // RAM metric removed
assert.ok(lines[2].includes('read'));
assert.ok(lines[2].includes('edit'));
assert.ok(lines[3].includes('auto mode'));
assert.ok(lines[3].includes('3 shell'));
assert.ok(lines[3].includes('1 tasks'));
assert.ok(lines[3].includes('2 agents'));
assert.ok(lines[3].includes('sandbox'));

// Test 2: Gemini 4 Argon on Google AI Pro (single argon-wk quota bar)
const argonLines = renderHUD(
  {
    model: { display_name: 'Gemini 4 Argon (High)' },
    plan_tier: 'Google AI Pro',
    cwd: 'C:/Users/found/Developer/antigravity-hud',
    cycle_mode: 'yolo',
    quota: {
      'gemini-argon-wtu-weekly': { remaining_fraction: 0.11, reset_in_seconds: 584397 },
      'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 1800 }
    }
  },
  { preset: 'full', enableLinks: true },
  {}
);

assert.strictEqual(argonLines.length, 4);
assert.ok(argonLines[0].includes('Gemini 4 Argon (High)'));
assert.ok(argonLines[1].includes('argon-wk'));
assert.ok(!argonLines[1].includes(' 5h ')); // 5h quota suppressed when >= 25%
assert.ok(!argonLines.some(l => l.includes('RAM ')));
assert.ok(argonLines[3].includes('bypass permissions (YOLO)')); // cycle_mode from payload

// Test 3: Minimal & Essential presets + Tiny layout shortening
const tinyLines = renderHUD(
  {
    model: { display_name: 'Gemini 4 Argon (High)' },
    terminal_width: 80
  },
  { preset: 'minimal', enableLinks: false },
  {}
);
assert.strictEqual(tinyLines.length, 1);
assert.ok(tinyLines[0].includes('G4 Argon (H)'));
assert.ok(!tinyLines[0].includes('\x1b]8;;'));

const essentialLines = renderHUD(
  { model: 'Claude Sonnet 4.6' },
  { preset: 'essential' },
  {}
);
assert.strictEqual(essentialLines.length, 2);

console.log('✔ Line renderer test passed');
