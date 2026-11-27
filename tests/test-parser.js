const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  formatResetTime,
  formatDuration,
  getContextCapacity,
  parseAutoCompactOverride,
  computePaceDelta,
  resolveQuotaSegments,
  resolveResetSeconds,
  quotaPct,
  estimateCost,
  resolveCost
} = require('../src/quota');
const {
  parseTranscript,
  parseUpdateStepsArgs,
  resolveTranscript,
  getSpeed,
  categoriseTool
} = require('../src/transcript');
const {
  parsePorcelainBranchAndDirty,
  normalizeRemoteUrl,
  getGitInfo,
  getVcsInfo,
  isCliVersionAtLeast
} = require('../src/git');

assert.strictEqual(formatResetTime(6120), '1h 42m');
assert.strictEqual(formatResetTime(900), '15m');
assert.strictEqual(formatResetTime(30), '<1m');

assert.strictEqual(formatDuration(42), '42s');
assert.strictEqual(formatDuration(860), '14m 20s');
assert.strictEqual(formatDuration(4320), '1h 12m');

// Context capacities (including full Gemini 4 element family & Orchestrator)
assert.strictEqual(getContextCapacity('Gemini 4 Argon'), 1000000);
assert.strictEqual(getContextCapacity('gemini-4-argon'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 4 Neon (XHigh)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 4 Carbon (High)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 4 Hydrogen (Orchestrator)'), 1000000);
assert.strictEqual(getContextCapacity('Orchestrator (Neon)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.5 Flash'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.8 Flash (High)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.0 Pro'), 2000000);
assert.strictEqual(getContextCapacity('Claude Opus 4.6'), 200000);

// Auto-compaction threshold parser (CLI v1.5.15+ AGY_CLI_AUTO_COMPACT_OVERRIDE)
assert.strictEqual(parseAutoCompactOverride('700000', 1000000), 700000);
assert.strictEqual(parseAutoCompactOverride('800K', 1000000), 800000);
assert.strictEqual(parseAutoCompactOverride('0.5M', 1000000), 500000);
assert.strictEqual(parseAutoCompactOverride('80%', 1000000), 800000);
assert.strictEqual(parseAutoCompactOverride('2M', 1000000), 1000000); // clamped to ctxSize
assert.strictEqual(parseAutoCompactOverride('', 1000000), null);
assert.strictEqual(parseAutoCompactOverride('bad', 1000000), null);

// Pricing & cache discount + native payload cost resolution
assert.strictEqual(estimateCost('Gemini 3.8 Flash (High)', 1000000, 0), 0.075);
assert.strictEqual(estimateCost('Gemini 4 Argon', 1000000, 0, 0), 1.25);
assert.strictEqual(estimateCost('Gemini 4 Neon (XHigh)', 1000000, 0, 0), 1.25);
assert.strictEqual(estimateCost('Gemini 4 Carbon (High)', 1000000, 0, 0), 0.50);
assert.strictEqual(estimateCost('Gemini 4 Hydrogen (Low)', 1000000, 0, 0), 0.15);
// 800k cached (at 25% of 1.25 = 0.25) + 200k uncached (0.25) = 0.50
assert.strictEqual(Number(estimateCost('Gemini 4 Argon', 1000000, 0, 800000).toFixed(4)), 0.5);

const nativeCost = resolveCost(
  { cost: { total_usd: 0.4213, subagent_usd: 0.12, estimated: false } },
  'Gemini 4 Neon (High)',
  100000,
  5000
);
assert.strictEqual(nativeCost.totalUsd, 0.4213);
assert.strictEqual(nativeCost.subagentUsd, 0.12);
assert.strictEqual(nativeCost.estimated, false);
assert.strictEqual(nativeCost.fromPayload, true);

const fallbackCost = resolveCost({}, 'Gemini 4 Neon (High)', 1000000, 0, 0);
assert.strictEqual(fallbackCost.totalUsd, 1.25);
assert.strictEqual(fallbackCost.estimated, true);
assert.strictEqual(fallbackCost.fromPayload, false);

// Quota percentage helper, live reset_time wall-clock countdown & pace delta
assert.strictEqual(quotaPct({ remaining_fraction: 0.85 }), 85);
assert.strictEqual(quotaPct({ remaining_fraction: 0 }), 0);
assert.strictEqual(quotaPct(null), 100);
const fixedNow = Date.parse('2026-11-22T12:00:00Z');
assert.strictEqual(resolveResetSeconds({ reset_time: '2026-11-22T13:00:00Z', reset_in_seconds: 99999 }, fixedNow), 3600);
assert.strictEqual(quotaPct({ remaining_fraction: 0.12, reset_time: '2026-11-22T11:59:00Z' }, fixedNow), 100);
// Halfway through 5h window (9000s remaining), 30% remaining (70% used vs 50% expected) -> +20% ahead of pace
assert.strictEqual(computePaceDelta(30, 9000, 18000), 20);
// Halfway through 5h window, 80% remaining (20% used vs 50% expected) -> -30% under pace
assert.strictEqual(computePaceDelta(80, 9000, 18000), -30);
assert.strictEqual(computePaceDelta(90, 0, 18000), null);

// Empty / omitted quota (GEMINI_API_KEY mode) -> returns [] instead of fake 100% bars
assert.deepStrictEqual(resolveQuotaSegments({ model: { display_name: 'Gemini 4 Neon (High)' } }), []);
assert.deepStrictEqual(resolveQuotaSegments({ model: { display_name: 'Gemini 4 Neon (High)' }, quota: {} }), []);

// Disabled buckets skipped & positive remaining_amount (AI credits) surfaced while 0 credits stay hidden
const creditsSegs = resolveQuotaSegments({
  model: { display_name: 'Gemini 4 Neon (High)' },
  quota: {
    'gemini-5h': { remaining_fraction: 0.8, reset_in_seconds: 9000 },
    'gemini-weekly': { remaining_fraction: 0.9, reset_in_seconds: 300000, disabled: true },
    'ai-credits': { remaining_amount: 42 },
    'empty-credits': { remaining_amount: 0 }
  }
});
assert.strictEqual(creditsSegs.length, 2);
assert.strictEqual(creditsSegs[0].id, '5h');
assert.strictEqual(creditsSegs[1].isAmount, true);
assert.strictEqual(creditsSegs[1].label, 'credits');
assert.strictEqual(creditsSegs[1].amount, 42);

// Test 1: Gemini 4 Argon on Pro plan -> ONLY argon-wk segment when 5h is healthy
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

// Test 1b: Gemini 4 Argon on Pro plan with critically low gemini-5h (< 25%) -> argon-wk + 5h warning
const argonProLow5hSegs = resolveQuotaSegments({
  model: { display_name: 'Gemini 4 Argon (High)' },
  plan_tier: 'Google AI Pro',
  quota: {
    'gemini-argon-wtu-weekly': { remaining_fraction: 0.85, reset_in_seconds: 584397 },
    'gemini-5h': { remaining_fraction: 0.15, reset_in_seconds: 1800 }
  }
});
assert.strictEqual(argonProLow5hSegs.length, 2);
assert.strictEqual(argonProLow5hSegs[0].id, 'argon-wk');
assert.strictEqual(argonProLow5hSegs[1].id, '5h');
assert.strictEqual(argonProLow5hSegs[1].pct, 15);

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

// Test 3: Standard Gemini (or Neon) on Pro plan -> standard 5h and wk
const regularGeminiPayload = {
  model: { display_name: 'Gemini 4 Neon (XHigh)' },
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

// Test 4: Claude / GPT / Haiku / o3 3P models -> 3p-5h and 3p-weekly
const claudePayload = {
  model: { display_name: 'Claude Sonnet 5.5 (High)' },
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

const haikuSegs = resolveQuotaSegments({
  model: { display_name: 'Claude Haiku 4.5' },
  quota: {
    '3p-5h': { remaining_fraction: 0.55, reset_in_seconds: 5000 },
    '3p-weekly': { remaining_fraction: 0.65, reset_in_seconds: 200000 }
  }
});
assert.strictEqual(haikuSegs[0].pct, 55);

const o3Segs = resolveQuotaSegments({
  model: { display_name: 'o3-mini' },
  quota: {
    '3p-5h': { remaining_fraction: 0.40, reset_in_seconds: 7000 },
    '3p-weekly': { remaining_fraction: 0.50, reset_in_seconds: 250000 }
  }
});
assert.strictEqual(o3Segs[0].pct, 40);

// Test 5: Tool categorisation for agy v1.5.16+ tools (including update_steps)
assert.strictEqual(categoriseTool('swarm'), 'agent');
assert.strictEqual(categoriseTool('run_workflow'), 'task');
assert.strictEqual(categoriseTool('update_steps'), 'task');
assert.strictEqual(categoriseTool('read_file'), 'read');
assert.strictEqual(categoriseTool('run_command'), 'bash');
assert.strictEqual(categoriseTool('mcp__syncloudos__ping'), 'mcp');

// Test 5b: parseUpdateStepsArgs (direct array and JSON-stringified)
const parsedSteps = parseUpdateStepsArgs({
  steps: [
    { title: 'Inspect repo', status: 'done' },
    { title: 'Upgrade renderer', status: 'in_progress' },
    { title: 'Run tests', status: 'pending' },
    { title: 'Legacy cleanup', status: 'skipped' }
  ]
});
assert.deepStrictEqual(parsedSteps, {
  done: 1,
  total: 4,
  inProgress: 1,
  skipped: 1,
  failed: 0,
  activeTitle: 'Upgrade renderer'
});
const parsedStepsJson = parseUpdateStepsArgs({
  steps: JSON.stringify([{ title: 'Step A', status: 'done' }, { title: 'Step B', status: 'failed' }])
});
assert.strictEqual(parsedStepsJson.done, 1);
assert.strictEqual(parsedStepsJson.failed, 1);

// Test 6: Transcript resolution, skills/MCP/update_steps/checklist/subagent parsing & speed cache invalidation
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-hud-test-'));
try {
  const statePath = path.join(tmpDir, 'antigravity-hud-state.json');
  const oldTranscript = path.join(tmpDir, '.gemini', 'antigravity-cli', 'brain', 'conv-old', '.system_generated', 'logs', 'transcript.jsonl');
  const newTranscript = path.join(tmpDir, '.gemini', 'antigravity-cli', 'brain', 'conv-new', '.system_generated', 'logs', 'transcript.jsonl');
  fs.mkdirSync(path.dirname(oldTranscript), { recursive: true });
  fs.mkdirSync(path.dirname(newTranscript), { recursive: true });
  fs.writeFileSync(oldTranscript, '{"tool_calls":[{"name":"read_file"}]}\n', 'utf8');
  fs.writeFileSync(
    newTranscript,
    [
      JSON.stringify({
        created_at: '2026-11-22T12:00:00Z',
        type: 'PLANNER_RESPONSE',
        content: 'Plan:\n- [x] Step 1\n- [x] Step 2\n- [ ] Step 3',
        tool_calls: [
          { name: 'read_file', args: { Path: '"C:\\\\Users\\\\dev\\\\.agents\\\\skills\\\\improve\\\\SKILL.md"' } },
          { name: 'mcp__syncloudos__query', args: {} }
        ]
      }),
      JSON.stringify({
        created_at: '2026-11-22T12:01:00Z',
        type: 'PLANNER_RESPONSE',
        tool_calls: [
          { name: 'run_command', args: {} },
          { name: 'invoke_subagent', args: { Role: '"Codebase Researcher"', TypeName: '"research"' } },
          {
            name: 'update_steps',
            args: {
              steps: [
                { title: 'Audit CLI docs', status: 'done' },
                { title: 'Build v0.6.0', status: 'in_progress' },
                { title: 'Run tests', status: 'pending' }
              ]
            }
          }
        ]
      })
    ].join('\n') + '\n',
    'utf8'
  );

  // Seed stale state pointing to conv-old
  fs.writeFileSync(statePath, JSON.stringify({
    conversationId: 'conv-old',
    transcriptPath: oldTranscript,
    transcriptMtime: Date.now()
  }), 'utf8');

  // Payload from agy v1.5.14+ with .gemini/antigravity/brain (missing -cli) and conv-new
  const nonCliPayloadPath = path.join(tmpDir, '.gemini', 'antigravity', 'brain', 'conv-new', '.system_generated', 'logs', 'transcript.jsonl');
  const resolved = resolveTranscript(
    { conversation_id: 'conv-new', transcript_path: nonCliPayloadPath },
    { homedir: tmpDir, statePath }
  );
  assert.strictEqual(resolved, newTranscript);

  const parsed = parseTranscript(resolved);
  assert.strictEqual(parsed.toolCounts.bash, 1);
  assert.strictEqual(parsed.toolCounts.agent, 1);
  assert.strictEqual(parsed.toolCounts.read, 1);
  assert.strictEqual(parsed.toolCounts.mcp, 1);
  assert.strictEqual(parsed.toolCounts.task, 1);
  assert.strictEqual(parsed.shellCount, 1);
  assert.strictEqual(parsed.agentInvoked, 1);
  assert.deepStrictEqual(parsed.skills, ['improve']);
  assert.deepStrictEqual(parsed.mcpServers, ['syncloudos']);
  assert.deepStrictEqual(parsed.planProgress, { done: 2, total: 3 });
  assert.strictEqual(parsed.stepsProgress.done, 1);
  assert.strictEqual(parsed.stepsProgress.total, 3);
  assert.strictEqual(parsed.stepsProgress.activeTitle, 'Build v0.6.0');
  assert.strictEqual(parsed.activeSubagents.length, 1);
  assert.strictEqual(parsed.activeSubagents[0].role, 'Codebase Researcher');
  assert.strictEqual(parsed.sessionDurationSeconds, 60);

  // Speed cache scoping by conversationId
  const speedCachePath = path.join(tmpDir, 'speed-cache.json');
  fs.writeFileSync(speedCachePath, JSON.stringify({
    conversationId: 'conv-old',
    lastTokens: 500,
    lastTimestamp: Date.now() - 1000,
    lastSpeed: 42
  }), 'utf8');
  const speedOnSwitch = getSpeed(2500, speedCachePath, 'conv-new');
  assert.strictEqual(speedOnSwitch, 0);

  // Git porcelain parser (including ahead / behind) & TTL cache & VCS awareness
  const cleanGit = parsePorcelainBranchAndDirty('## main...origin/main\n');
  assert.strictEqual(cleanGit.branch, 'main');
  assert.strictEqual(cleanGit.dirty, '');
  assert.strictEqual(cleanGit.ahead, 0);
  assert.strictEqual(cleanGit.behind, 0);

  const abGit = parsePorcelainBranchAndDirty('## feat/hud...origin/feat/hud [ahead 2, behind 1]\n M src/quota.js\n?? new.js\n');
  assert.strictEqual(abGit.branch, 'feat/hud');
  assert.strictEqual(abGit.dirty, '*');
  assert.strictEqual(abGit.ahead, 2);
  assert.strictEqual(abGit.behind, 1);

  const detachedGit = parsePorcelainBranchAndDirty('## HEAD (no branch)\n');
  assert.strictEqual(detachedGit.branch, '');
  assert.strictEqual(detachedGit.dirty, '');

  assert.strictEqual(
    normalizeRemoteUrl('git@github.com:phenom64/antigravity-hud.git', 'master'),
    'https://github.com/phenom64/antigravity-hud/tree/master'
  );

  // Version check helper & getVcsInfo skipping git outside repos on CLI >= 1.4
  assert.strictEqual(isCliVersionAtLeast('1.5.17', 1, 4), true);
  assert.strictEqual(isCliVersionAtLeast('1.4.0', 1, 4), true);
  assert.strictEqual(isCliVersionAtLeast('1.3.9', 1, 4), false);

  const noRepoVcs = getVcsInfo('/not/a/repo', { version: '1.5.17' }, { statePath });
  assert.strictEqual(noRepoVcs.vcsType, '');
  assert.strictEqual(noRepoVcs.branch, '');

  const jjVcs = getVcsInfo('/fake/jj', { version: '1.5.17', vcs: { type: 'jj', branch: 'my-bookmark', dirty: true } }, { statePath });
  assert.strictEqual(jjVcs.vcsType, 'jj');
  assert.strictEqual(jjVcs.branch, 'my-bookmark');
  assert.strictEqual(jjVcs.dirty, '*');

  // Seed gitCache in statePath and verify cache hit
  const now = Date.now();
  fs.writeFileSync(statePath, JSON.stringify({
    gitCache: {
      '/fake/repo': {
        vcsType: 'git',
        branch: 'cached-branch',
        dirty: '*',
        ahead: 3,
        behind: 0,
        gitRepoUrl: 'https://github.com/user/repo/tree/cached-branch',
        statusTimestamp: now,
        remoteTimestamp: now
      }
    }
  }), 'utf8');
  const gitInfo = getGitInfo('/fake/repo', { statePath, now: now + 1000 });
  assert.strictEqual(gitInfo.cached, true);
  assert.strictEqual(gitInfo.branch, 'cached-branch');
  assert.strictEqual(gitInfo.dirty, '*');
  assert.strictEqual(gitInfo.ahead, 3);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('✔ Parser, quota & VCS tests passed');
