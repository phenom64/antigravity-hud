const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  formatResetTime,
  formatDuration,
  getContextCapacity,
  resolveQuotaSegments,
  quotaPct,
  estimateCost
} = require('../src/quota');
const {
  parseTranscript,
  resolveTranscript,
  getSpeed,
  categoriseTool
} = require('../src/transcript');
const {
  parsePorcelainBranchAndDirty,
  normalizeRemoteUrl,
  getGitInfo
} = require('../src/git');

assert.strictEqual(formatResetTime(6120), '1h 42m');
assert.strictEqual(formatResetTime(900), '15m');

assert.strictEqual(formatDuration(42), '42s');
assert.strictEqual(formatDuration(860), '14m 20s');
assert.strictEqual(formatDuration(4320), '1h 12m');

// Context capacities (including full Gemini 4 element family)
assert.strictEqual(getContextCapacity('Gemini 4 Argon'), 1000000);
assert.strictEqual(getContextCapacity('gemini-4-argon'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 4 Neon (XHigh)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 4 Carbon (High)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 4 Hydrogen (Orchestrator)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.5 Flash'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.8 Flash (High)'), 1000000);
assert.strictEqual(getContextCapacity('Gemini 3.0 Pro'), 2000000);
assert.strictEqual(getContextCapacity('Claude Opus 4.6'), 200000);

// Pricing & cache discount
assert.strictEqual(estimateCost('Gemini 3.8 Flash (High)', 1000000, 0), 0.075);
assert.strictEqual(estimateCost('Gemini 4 Argon', 1000000, 0, 0), 1.25);
assert.strictEqual(estimateCost('Gemini 4 Neon (XHigh)', 1000000, 0, 0), 1.25);
assert.strictEqual(estimateCost('Gemini 4 Carbon (High)', 1000000, 0, 0), 0.50);
assert.strictEqual(estimateCost('Gemini 4 Hydrogen (Low)', 1000000, 0, 0), 0.15);
// 800k cached (at 25% of 1.25 = 0.25) + 200k uncached (0.25) = 0.50
assert.strictEqual(Number(estimateCost('Gemini 4 Argon', 1000000, 0, 800000).toFixed(4)), 0.5);

// Quota percentage helper
assert.strictEqual(quotaPct({ remaining_fraction: 0.85 }), 85);
assert.strictEqual(quotaPct({ remaining_fraction: 0 }), 0);
assert.strictEqual(quotaPct(null), 100);

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

// Test 5: Tool categorisation for new agy v1.5+ tools
assert.strictEqual(categoriseTool('swarm'), 'agent');
assert.strictEqual(categoriseTool('run_workflow'), 'task');
assert.strictEqual(categoriseTool('read_file'), 'read');
assert.strictEqual(categoriseTool('run_command'), 'bash');
assert.strictEqual(categoriseTool('mcp__syncloudos__ping'), 'mcp');

// Test 6: Transcript resolution, skills/MCP/checklist/subagent parsing & speed cache invalidation
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
          { name: 'invoke_subagent', args: { Role: '"Codebase Researcher"', TypeName: '"research"' } }
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

  // Payload from agy v1.5.14 with .gemini/antigravity/brain (missing -cli) and conv-new
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
  assert.strictEqual(parsed.shellCount, 1);
  assert.strictEqual(parsed.agentInvoked, 1);
  assert.deepStrictEqual(parsed.skills, ['improve']);
  assert.deepStrictEqual(parsed.mcpServers, ['syncloudos']);
  assert.deepStrictEqual(parsed.planProgress, { done: 2, total: 3 });
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

  // Git porcelain parser (including ahead / behind) & TTL cache
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

  // Seed gitCache in statePath and verify cache hit
  const now = Date.now();
  fs.writeFileSync(statePath, JSON.stringify({
    gitCache: {
      '/fake/repo': {
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

console.log('✔ Parser & quota test passed');
