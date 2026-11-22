const assert = require('assert');
const { renderHUD } = require('../src/render/lines');

// Test 1: Standard Gemini render (full preset, 4 lines, git ahead/behind, subagents, plan, skills, mcp, duration)
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
    agentInvoked: 1,
    activeSubagents: [{ role: 'Codebase Researcher', elapsedSeconds: 42 }],
    planProgress: { done: 3, total: 5 },
    skills: ['improve', 'using-superpowers'],
    mcpServers: ['syncloudos'],
    sessionDurationSeconds: 860
  },
  {
    gitBranch: 'master',
    gitDirty: true,
    gitAhead: 2,
    gitBehind: 1,
    gitRepoUrl: 'https://github.com/phenom64/antigravity-hud/tree/master',
    permissionMode: 'proceed-in-sandbox',
    speed: 35.4
  }
);

assert.strictEqual(lines.length, 4);
assert.ok(lines[0].includes('Gemini 3.5 Flash'));
assert.ok(lines[0].includes('\x1b]8;;')); // OSC 8 link present
assert.ok(lines[0].includes('master* \u21912 \u21931')); // branch + dirty + ahead/behind
assert.ok(lines[0].includes('confirm')); // tool_confirmation_pending badge
assert.ok(lines[1].includes('5h'));
assert.ok(lines[1].includes('wk'));
assert.ok(!lines.some(l => l.includes('RAM '))); // RAM metric removed
assert.ok(lines[2].includes('read'));
assert.ok(lines[2].includes('edit'));
assert.ok(lines[3].includes('\u23E9 auto mode on'));
assert.ok(lines[3].includes('3 shell'));
assert.ok(lines[3].includes('1 tasks'));
assert.ok(lines[3].includes('1 agents'));
assert.ok(lines[3].includes('Codebase Researcher 42s'));
assert.ok(lines[3].includes('3/5 plan'));
assert.ok(lines[3].includes('2 skills'));
assert.ok(lines[3].includes('1 mcp'));
assert.ok(lines[3].includes('sandbox'));
assert.ok(lines[3].includes('14m 20s'));

// Test 2: All 4 Shift+Tab cycle_mode states
// 2a. accept-edits -> "⏵⏵ accept edits on" in light purple (#C4A7FF -> \x1b[38;2;196;167;255m)
const acceptEditsLines = renderHUD(
  { model: 'Gemini 4 Argon (High)', cycle_mode: 'accept-edits' },
  { preset: 'full' },
  {},
  { permissionMode: 'always-proceed' }
);
assert.ok(acceptEditsLines[3].includes('\u23F5\u23F5 accept edits on'));
assert.ok(acceptEditsLines[3].includes('\x1b[38;2;196;167;255m'));

// 2b. plan -> "⏸ plan mode on" in teal (#2DD4BF -> \x1b[38;2;45;212;191m)
const planLines = renderHUD(
  { model: 'Gemini 4 Argon (High)', cycle_mode: 'plan' },
  { preset: 'full' },
  {},
  { permissionMode: 'always-proceed' }
);
assert.ok(planLines[3].includes('\u23F8 plan mode on'));
assert.ok(planLines[3].includes('\x1b[38;2;45;212;191m'));

// 2c. auto -> "⏩ auto mode on" in orange (\x1b[38;5;208m)
const autoLines = renderHUD(
  { model: 'Gemini 4 Argon (High)', cycle_mode: 'auto' },
  { preset: 'full' },
  {},
  { permissionMode: 'always-proceed' }
);
assert.ok(autoLines[3].includes('\u23E9 auto mode on'));

// 2d. omitted cycle_mode ("") -> falls back to settings.json always-proceed ("⏩ bypass permissions (YOLO)")
const yoloLines = renderHUD(
  {
    model: { display_name: 'Gemini 4 Argon (High)' },
    plan_tier: 'Google AI Pro',
    cwd: 'C:/Users/found/Developer/antigravity-hud',
    quota: {
      'gemini-argon-wtu-weekly': { remaining_fraction: 0.11, reset_in_seconds: 584397 },
      'gemini-5h': { remaining_fraction: 0.72, reset_in_seconds: 1800 }
    }
  },
  { preset: 'full', enableLinks: true },
  {},
  { permissionMode: 'always-proceed' }
);
assert.strictEqual(yoloLines.length, 4);
assert.ok(yoloLines[0].includes('Gemini 4 Argon (High)'));
assert.ok(yoloLines[1].includes('argon-wk'));
assert.ok(!yoloLines[1].includes(' 5h ')); // 5h quota suppressed when >= 25%
assert.ok(yoloLines[3].includes('\u23E9 bypass permissions (YOLO)'));

// Test 3: Context bar color gradient (Green <50%, Yellow >=50%, Orange >=70%, Red >=85%)
const ctx88 = renderHUD(
  { model: 'Gemini 4 Argon', context_window: { used_percentage: 88, total_input_tokens: 880000, context_window_size: 1000000 } },
  { preset: 'essential' },
  {}
);
assert.ok(ctx88[1].includes('ctx \x1b[91m')); // Red critical context bar at 88%

const ctx55 = renderHUD(
  { model: 'Gemini 4 Argon', context_window: { used_percentage: 55, total_input_tokens: 550000, context_window_size: 1000000 } },
  { preset: 'essential' },
  {}
);
assert.ok(ctx55[1].includes('ctx \x1b[93m')); // Yellow mid context bar at 55%

// Test 4: Minimal & Essential presets + Tiny layout shortening for Gemini 4 family
const tinyLines = renderHUD(
  {
    model: { display_name: 'Gemini 4 Neon (XHigh)' },
    terminal_width: 80
  },
  { preset: 'minimal', enableLinks: false },
  {}
);
assert.strictEqual(tinyLines.length, 1);
assert.ok(tinyLines[0].includes('G4 Neon (XH)'));
assert.ok(!tinyLines[0].includes('\x1b]8;;'));

const essentialLines = renderHUD(
  { model: 'Claude Sonnet 5.5 (High)' },
  { preset: 'essential' },
  {}
);
assert.strictEqual(essentialLines.length, 2);

console.log('✔ Line renderer test passed');
