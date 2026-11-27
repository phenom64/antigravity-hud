const assert = require('assert');
const { renderHUD } = require('../src/render/lines');
const { renderTitle } = require('../src/title');

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
const acceptEditsLines = renderHUD(
  { model: 'Gemini 4 Argon (High)', cycle_mode: 'accept-edits' },
  { preset: 'full' },
  {},
  { permissionMode: 'always-proceed' }
);
assert.ok(acceptEditsLines[3].includes('\u23F5\u23F5 accept edits on'));
assert.ok(acceptEditsLines[3].includes('\x1b[38;2;196;167;255m'));

const planLines = renderHUD(
  { model: 'Gemini 4 Argon (High)', cycle_mode: 'plan' },
  { preset: 'full' },
  {},
  { permissionMode: 'always-proceed' }
);
assert.ok(planLines[3].includes('\u23F8 plan mode on'));
assert.ok(planLines[3].includes('\x1b[38;2;45;212;191m'));

const autoLines = renderHUD(
  { model: 'Gemini 4 Argon (High)', cycle_mode: 'auto' },
  { preset: 'full' },
  {},
  { permissionMode: 'always-proceed' }
);
assert.ok(autoLines[3].includes('\u23E9 auto mode on'));

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

const strictLines = renderHUD(
  { model: 'Gemini 4 Argon (High)' },
  { preset: 'full' },
  {},
  { permissionMode: 'strict' }
);
assert.ok(strictLines[3].includes('\u25A0 strict mode on'));

// Test 3: Context bar color gradient (Green <50%, Yellow >=50%, Orange >=70%, Red >=85%)
const ctx88 = renderHUD(
  { model: 'Gemini 4 Argon', context_window: { used_percentage: 88, total_input_tokens: 880000, context_window_size: 1000000 } },
  { preset: 'essential' },
  {}
);
assert.ok(ctx88[1].includes('ctx\x1b[0m \x1b[91m')); // Red critical context bar at 88%

const ctx55 = renderHUD(
  { model: 'Gemini 4 Argon', context_window: { used_percentage: 55, total_input_tokens: 550000, context_window_size: 1000000 } },
  { preset: 'essential' },
  {}
);
assert.ok(ctx55[1].includes('ctx\x1b[0m \x1b[93m')); // Yellow mid context bar at 55%

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

// Test 5: v0.6.0 features - native cost, vim, queued input, artifacts, structured subagents,
//         live update_steps, cache hit, auto-compact override, AI credits, pace delta, custom agent, conv ID
const v6Lines = renderHUD(
  {
    conversation_id: 'd7a2e523-bf96-4ba5-aa11-778b03bce6f0',
    conversation_title: 'Upgrade antigravity-hud to v0.6.0',
    model: { id: 'custom-gemini', display_name: 'Custom Gemini', effort: 'high' },
    agent: { name: 'reviewer' },
    cwd: 'C:/Users/dev/antigravity-hud',
    agent_state: 'tool_use',
    pending_input_count: 2,
    vim: { mode: 'VISUAL LINE' },
    artifact_count: 3,
    subagents: [
      { name: 'research', role: 'Docs Auditor', status: 'completed' },
      { name: 'research', role: 'Codebase Researcher', status: 'running' }
    ],
    context_window: {
      total_input_tokens: 400000,
      total_output_tokens: 12000,
      context_window_size: 1000000,
      used_percentage: 41.2,
      current_usage: {
        input_tokens: 14000,
        output_tokens: 800,
        cache_read_input_tokens: 36000
      }
    },
    quota: {
      'gemini-5h': { remaining_fraction: 0.30, reset_in_seconds: 9000 },
      'gemini-weekly': { remaining_fraction: 0.90, reset_in_seconds: 302400 },
      'ai-credits': { remaining_amount: 42 }
    },
    cost: {
      total_usd: 0.4213,
      subagent_usd: 0.12,
      estimated: false
    },
    terminal_width: 150
  },
  {
    preset: 'full',
    showCost: true,
    showCacheHit: true,
    showQuotaPace: true,
    showArtifacts: true,
    showConversationId: true,
    enableLinks: true
  },
  {
    shellCount: 2,
    taskCount: 1,
    activeSubagents: [{ role: 'Codebase Researcher', elapsedSeconds: 35 }],
    stepsProgress: { done: 2, total: 5, inProgress: 1, skipped: 0, failed: 1, activeTitle: 'Wire renderer tests' },
    planProgress: { done: 1, total: 2 } // should be overridden by live stepsProgress
  },
  {
    vcsType: 'jj',
    gitBranch: 'feat-v6',
    gitDirty: true,
    autoCompactOverride: '500K',
    noSpinner: true
  }
);

assert.ok(v6Lines[0].includes('Custom Gemini (High)')); // effort appended when missing
assert.ok(v6Lines[0].includes('@reviewer')); // custom agent badge
assert.ok(v6Lines[0].includes('jj:(')); // non-git VCS prefix
assert.ok(v6Lines[0].includes('2 queued')); // pending_input_count
assert.ok(v6Lines[0].includes('V-LINE')); // Vim mode
assert.ok(v6Lines[0].includes('#d7a2e523')); // short conversation ID
assert.ok(v6Lines[1].includes('\u26A172%')); // cache hit ratio (36k / 50k)
assert.ok(v6Lines[1].includes('cmp 82%')); // 412k / 500k override
assert.ok(v6Lines[1].includes('\u21E120%')); // 5h pace delta (+20%)
assert.ok(v6Lines[1].includes('credits')); // positive remaining_amount
assert.ok(v6Lines[1].includes('42'));
assert.ok(v6Lines[1].includes('$0.421') && !v6Lines[1].includes('~$0.421')); // exact native cost
assert.ok(v6Lines[1].includes('+$0.12 sub')); // subagent cost breakdown
assert.ok(v6Lines[3].includes('3 artifacts')); // native artifact_count
assert.ok(v6Lines[3].includes('1 agents') && v6Lines[3].includes('Codebase Researcher 35s') && v6Lines[3].includes('+1 done')); // structured subagents
assert.ok(v6Lines[3].includes('2/5 steps') && v6Lines[3].includes('Wire renderer tests')); // live update_steps beats markdown plan
assert.ok(!v6Lines[3].includes('1/2 plan'));

// Test 6: API key mode (no quota) hides quota bars; error & reviewing states; Orchestrator planner -> executor
const apiKeyLines = renderHUD(
  {
    model: { display_name: 'Orchestrator (Neon)' },
    agent_state: 'error',
    context_window: { total_input_tokens: 10000, total_output_tokens: 1000, context_window_size: 1000000, used_percentage: 1.1 }
  },
  { preset: 'essential' },
  {},
  { orchestrator: { planner: 'Gemini 4 Neon (High)', executor: 'Gemini 4 Hydrogen (High)' } }
);
assert.ok(apiKeyLines[0].includes('Orchestrator (Neon \u2192 Hydrogen)'));
assert.ok(apiKeyLines[0].includes('\u2716') && apiKeyLines[0].includes('error'));
assert.ok(!apiKeyLines[1].includes('5h') && !apiKeyLines[1].includes('wk'));

// Test 7: Companion window title renderer (plain text, zero ANSI escape codes, single line)
const titleConfirm = renderTitle(
  {
    model: { display_name: 'Gemini 4 Neon (High)' },
    workspace: { project_dir: 'C:\\Users\\dev\\antigravity-hud' },
    agent_state: 'working',
    tool_confirmation_pending: true,
    pending_input_count: 2,
    context_window: { used_percentage: 14.6 }
  },
  { gitBranch: 'master', gitDirty: true }
);
assert.ok(!titleConfirm.includes('\x1b'));
assert.ok(!titleConfirm.includes('\n'));
assert.ok(titleConfirm.includes('confirm'));
assert.ok(titleConfirm.includes('antigravity-hud (master*)'));
assert.ok(titleConfirm.includes('G4 Neon (H)'));
assert.ok(titleConfirm.includes('ctx 15%'));
assert.ok(titleConfirm.includes('+2q'));

const titleAscii = renderTitle(
  { model: 'Claude Opus 5.5 (High)', cwd: '/home/dev/app', agent_state: 'idle' },
  { noUnicode: true }
);
assert.strictEqual(titleAscii, '* ready | app | Opus 5.5 (H)');

console.log('✔ Line & title renderer tests passed');
