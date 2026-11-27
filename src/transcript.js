'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/** Read only the last maxBytes of a file. */
function readLastBytes(filePath, maxBytes = 262144) {
  let fd;
  try {
    const stats = fs.statSync(filePath);
    const size = stats.size;
    if (size === 0) return '';

    fd = fs.openSync(filePath, 'r');
    const bytesToRead = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const position = size - bytesToRead;

    fs.readSync(fd, buffer, 0, bytesToRead, position);
    return buffer.toString('utf8');
  } catch (_) {
    return '';
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

/** Map tool calls to structured categories. */
function categoriseTool(toolName) {
  if (!toolName) return 'tool';
  if (toolName.startsWith('mcp__')) return 'mcp';

  const name = toolName.toLowerCase();

  if (name.includes('browser') || name.includes('chrome') || name.includes('computer')) {
    return 'browser';
  }
  if (name.includes('read') || name.includes('view') || name.includes('list')) {
    return 'read';
  }
  if (name.includes('grep') || name.includes('search')) {
    return 'search';
  }
  if (name.includes('write') || name.includes('create')) {
    return 'write';
  }
  if (name.includes('edit') || name.includes('replace') || name.includes('patch')) {
    return 'edit';
  }
  if (name.includes('command') || name.includes('shell') || name.includes('bash') || name === 'run_command') {
    return 'bash';
  }
  if (['define_subagent', 'invoke_subagent', 'manage_subagents', 'send_message', 'swarm'].includes(name)) {
    return 'agent';
  }
  if (['manage_task', 'schedule', 'run_workflow', 'update_steps'].includes(name)) {
    return 'task';
  }
  if (['ask_question', 'ask_permission'].includes(name)) {
    return 'ask';
  }
  if (name === 'generate_image' || name.includes('image')) {
    return 'image';
  }
  return 'tool';
}

/**
 * Atomically write JSON to disk using a PID+random temp file + rename to prevent
 * Windows EBUSY / partial-file corruption when statusLine and title run concurrently.
 */
function atomicWriteJson(filePath, data) {
  let tmpPath = '';
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    tmpPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (_) {
    try {
      if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

/**
 * Fast, bounded lookup of transcript.jsonl directly under <brainDir>/<convId>/.system_generated/logs/
 * (avoids unbounded recursive traversal into scratch/ or cloned repos inside brain folders).
 */
function findTranscriptsInBrainDir(brainDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(brainDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const candidate = path.join(brainDir, e.name, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) {
          results.push({ path: candidate, mtime: stat.mtimeMs });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return results;
}

function saveTranscriptCache(statePath, tPath, convId = null) {
  try {
    let existing = {};
    if (fs.existsSync(statePath)) {
      try {
        existing = JSON.parse(fs.readFileSync(statePath, 'utf8')) || {};
      } catch (_) {
        existing = {};
      }
    }
    const nextConvId = convId || null;
    // Skip redundant disk writes when the cached transcript hasn't changed
    if (existing.conversationId === nextConvId && existing.transcriptPath === tPath) {
      return;
    }
    existing.conversationId = nextConvId;
    existing.transcriptPath = tPath;
    existing.transcriptMtime = Date.now();
    atomicWriteJson(statePath, existing);
  } catch (_) {}
}

/**
 * Locate the best transcript.jsonl to parse for the current payload.
 * Ensures the cache in antigravity-hud-state.json is scoped to the current conversation_id
 * and repairs .gemini/antigravity/brain -> .gemini/antigravity-cli/brain paths emitted by agy v1.5+.
 */
function resolveTranscript(j, options = {}) {
  if (process.env.AGY_HUD_TRANSCRIPT) {
    try {
      if (fs.existsSync(process.env.AGY_HUD_TRANSCRIPT)) {
        return process.env.AGY_HUD_TRANSCRIPT;
      }
    } catch (_) {}
  }

  const home = options.homedir || os.homedir();
  const statePath = options.statePath || path.join(home, '.gemini', 'antigravity-cli', 'antigravity-hud-state.json');
  const convId = (j && (j.conversation_id || j.session_id)) ? String(j.conversation_id || j.session_id) : null;

  // 1. Check explicit payload transcript_path and conversation_id brain directories first
  const candidates = [];
  if (j && j.transcript_path) {
    candidates.push(j.transcript_path);
    const cliVariant = j.transcript_path.replace(/([\\/]\.gemini[\\/])antigravity([\\/]brain[\\/])/i, '$1antigravity-cli$2');
    if (cliVariant !== j.transcript_path) candidates.push(cliVariant);
    const nonCliVariant = j.transcript_path.replace(/([\\/]\.gemini[\\/])antigravity-cli([\\/]brain[\\/])/i, '$1antigravity$2');
    if (nonCliVariant !== j.transcript_path) candidates.push(nonCliVariant);
  }
  if (convId) {
    candidates.push(path.join(home, '.gemini', 'antigravity-cli', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'));
    candidates.push(path.join(home, '.gemini', 'antigravity', 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'));
  }

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        saveTranscriptCache(statePath, candidate, convId);
        return candidate;
      }
    } catch (_) {}
  }

  // 2. Try reading state cache, but only accept if conversationId matches (or no convId in payload)
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const cachedPath = state && state.transcriptPath;
      if (cachedPath && fs.existsSync(cachedPath)) {
        const matchesConv = !convId || state.conversationId === convId || cachedPath.includes(convId);
        if (matchesConv) {
          return cachedPath;
        }
      }
    }
  } catch (_) {}

  // 3. Fallback: Search common brain directories (direct layout only, no deep recursion)
  const searchDirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'brain'),
    path.join(home, '.gemini', 'antigravity', 'brain'),
  ];
  let all = [];
  for (const d of searchDirs) {
    try {
      if (fs.existsSync(d)) all.push(...findTranscriptsInBrainDir(d));
    } catch (_) {}
  }
  if (all.length === 0) return null;
  all.sort((a, b) => b.mtime - a.mtime);
  const foundPath = all[0].path;

  saveTranscriptCache(statePath, foundPath, convId);
  return foundPath;
}

function cleanArgString(val) {
  if (typeof val !== 'string') return '';
  return val.replace(/^"|"$/g, '').trim();
}

function countChecklistItems(text) {
  if (!text || typeof text !== 'string') return null;
  const doneMatches = text.match(/^\s*[-*]\s*\[[xX]\]\s+/gm);
  const todoMatches = text.match(/^\s*[-*]\s*\[\s\]\s+/gm);
  const done = doneMatches ? doneMatches.length : 0;
  const todo = todoMatches ? todoMatches.length : 0;
  if (done + todo === 0) return null;
  return { done, total: done + todo };
}

/**
 * Parse `update_steps` tool call arguments (CLI v1.5.16+) into live step checklist metrics.
 */
function parseUpdateStepsArgs(args) {
  if (!args || typeof args !== 'object') return null;
  let steps = args.steps || args.Steps;
  if (typeof steps === 'string') {
    try {
      steps = JSON.parse(steps);
    } catch (_) {
      return null;
    }
  }
  if (!Array.isArray(steps) || steps.length === 0) return null;

  let done = 0;
  let inProgress = 0;
  let skipped = 0;
  let failed = 0;
  let activeTitle = '';

  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    const st = String(s.status || '').toLowerCase();
    if (st === 'done') done++;
    else if (st === 'in_progress') {
      inProgress++;
      if (!activeTitle && s.title) activeTitle = String(s.title).trim();
    } else if (st === 'skipped') skipped++;
    else if (st === 'failed') failed++;
  }

  return {
    done,
    total: steps.length,
    inProgress,
    skipped,
    failed,
    activeTitle
  };
}

/**
 * Bounded JSONL transcript reader (reads up to last 256KB).
 * Parses tool category tallies, shell/task/agent counts, active subagents (with elapsed runtime),
 * loaded skills, MCP servers, live `update_steps` checklists, markdown plan checklists, and session duration.
 */
function parseTranscript(transcriptPath, initialTaskCount = 0) {
  const result = {
    toolCounts: {},
    toolLastSeen: {},
    rawToolCounts: {},
    shellCount: 0,
    taskCount: initialTaskCount || 0,
    agentInvoked: 0,
    activeAgents: null,
    activeSubagents: [],
    skills: [],
    mcpServers: [],
    planProgress: { done: 0, total: 0 },
    stepsProgress: { done: 0, total: 0, inProgress: 0, skipped: 0, failed: 0, activeTitle: '' },
    sessionDurationSeconds: 0
  };

  if (!transcriptPath) return result;
  let stats;
  try {
    if (!fs.existsSync(transcriptPath)) return result;
    stats = fs.statSync(transcriptPath);
  } catch (_) {
    return result;
  }

  try {
    const content = readLastBytes(transcriptPath, 262144);
    if (!content) return result;

    const lines = content.split('\n');
    const isTailSlice = lines.length > 1 && content.length >= 262144;
    if (isTailSlice) {
      lines.shift();
    }

    const subagentsMap = new Map();
    const mcpSet = new Set();
    const skillsSet = new Set();
    let firstTsMs = (isTailSlice && stats && stats.birthtimeMs) ? stats.birthtimeMs : null;
    let lastTsMs = null;
    let seqNum = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        continue;
      }
      seqNum++;

      const rawTs = entry.created_at || entry.timestamp;
      if (rawTs) {
        const parsedMs = new Date(rawTs).getTime();
        if (Number.isFinite(parsedMs) && parsedMs > 0) {
          if (firstTsMs === null || parsedMs < firstTsMs) firstTsMs = parsedMs;
          if (lastTsMs === null || parsedMs > lastTsMs) lastTsMs = parsedMs;
        }
      }

      if (entry.content && typeof entry.content === 'string') {
        const m = entry.content.match(/You have\s+(\d+)\s+active subagent/);
        if (m) result.activeAgents = parseInt(m[1], 10) || 0;

        if (entry.type === 'PLANNER_RESPONSE') {
          const cl = countChecklistItems(entry.content);
          if (cl) result.planProgress = cl;
        }
      }

      if (Array.isArray(entry.tool_calls)) {
        for (const tc of entry.tool_calls) {
          const toolName = tc.name || tc.tool_name || (tc.function && (tc.function.name || tc.function)) || '';
          const cat = categoriseTool(toolName);

          result.toolCounts[cat] = (result.toolCounts[cat] || 0) + 1;
          result.toolLastSeen[cat] = seqNum;
          if (toolName) {
            result.rawToolCounts[toolName] = (result.rawToolCounts[toolName] || 0) + 1;
          }

          if (toolName.startsWith('mcp__')) {
            const parts = toolName.split('__');
            if (parts[1]) mcpSet.add(parts[1]);
          }

          const args = tc.arguments || tc.args || {};
          const rawPath = cleanArgString(args.Path || args.AbsolutePath || '');
          if (rawPath) {
            const skillMatch = rawPath.match(/[\\/]+skills[\\/]+([^\\/]+)[\\/]+SKILL\.md$/i);
            if (skillMatch && skillMatch[1]) {
              skillsSet.add(skillMatch[1]);
            }
            const mcpMatch = rawPath.match(/[\\/]+mcp[\\/]+([^\\/]+)[\\/]+/i);
            if (mcpMatch && mcpMatch[1]) {
              mcpSet.add(mcpMatch[1]);
            }
          }

          const writeContent = cleanArgString(args.Content || args.Replacement || '');
          if (writeContent && writeContent.includes('- [')) {
            const cl = countChecklistItems(writeContent.replace(/\\n/g, '\n'));
            if (cl && cl.total >= 2) {
              result.planProgress = cl;
            }
          }

          const name = toolName.toLowerCase();
          if (name === 'update_steps') {
            const parsedSteps = parseUpdateStepsArgs(args);
            if (parsedSteps) {
              result.stepsProgress = parsedSteps;
            }
          }

          if (name === 'run_command') result.shellCount++;
          if (name === 'manage_task' || name === 'schedule' || name === 'run_workflow') result.taskCount++;

          if (name === 'invoke_subagent' || name === 'swarm') {
            const subs = args.Subagents || args.subagents;
            result.agentInvoked += Array.isArray(subs) ? subs.length : 1;

            const subId = cleanArgString(args.conversationID || args.Recipient) || `sub-${subagentsMap.size}`;
            const role = cleanArgString(args.Role || args.TypeName || args.name) || 'subagent';
            const model = cleanArgString(args.Model || args.model) || 'inherit';
            const startTime = rawTs ? new Date(rawTs) : new Date();
            subagentsMap.set(subId, {
              id: subId,
              role,
              model,
              startTime,
              status: 'running'
            });
          } else if (name === 'manage_subagents') {
            const action = cleanArgString(args.Action || args.action || '').toLowerCase();
            if (action === 'kill_all') {
              subagentsMap.clear();
            } else if (action === 'kill') {
              const ids = args.ConversationIds || args.conversationIds || [];
              if (Array.isArray(ids)) {
                for (const id of ids) subagentsMap.delete(cleanArgString(id));
              }
            }
          }
        }
      }
    }

    const refNowMs = lastTsMs || Date.now();
    result.activeSubagents = Array.from(subagentsMap.values()).map(sub => {
      const startMs = sub.startTime instanceof Date ? sub.startTime.getTime() : Date.now();
      const elapsedSeconds = Number.isFinite(startMs) ? Math.max(0, Math.floor((refNowMs - startMs) / 1000)) : 0;
      return Object.assign({}, sub, { elapsedSeconds });
    });
    result.mcpServers = Array.from(mcpSet);
    result.skills = Array.from(skillsSet);

    if (firstTsMs && Number.isFinite(firstTsMs)) {
      const endMs = lastTsMs && lastTsMs >= firstTsMs ? lastTsMs : Date.now();
      result.sessionDurationSeconds = Math.max(0, Math.floor((endMs - firstTsMs) / 1000));
    }
  } catch (_) {}

  result.shellCount = Math.min(result.shellCount, 99);
  result.taskCount = Math.min(result.taskCount, 99);
  result.agentInvoked = Math.min(result.agentInvoked, 99);
  if (result.activeAgents !== null) {
    result.activeAgents = Math.min(result.activeAgents, 99);
  }

  return result;
}

/**
 * Compute token generation speed (tok/s), scoped by conversationId to prevent
 * cross-session delta spikes.
 */
function getSpeed(currentTokens, cachePath, convId = null) {
  let cache = { conversationId: null, lastTokens: 0, lastTimestamp: 0, lastSpeed: 0 };
  try {
    if (fs.existsSync(cachePath)) {
      cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) || cache;
    }
  } catch (_) {}

  const now = Date.now();

  if (convId && cache.conversationId && cache.conversationId !== convId) {
    atomicWriteJson(cachePath, {
      conversationId: convId,
      lastTokens: currentTokens,
      lastTimestamp: now,
      lastSpeed: 0
    });
    return 0;
  }

  const dt = (now - (cache.lastTimestamp || 0)) / 1000;
  let speed = cache.lastSpeed || 0;

  if (dt >= 0.5) {
    const dTokens = currentTokens - (cache.lastTokens || 0);
    if (dTokens > 0 && cache.lastTimestamp > 0) {
      speed = dTokens / dt;
    } else if (dTokens < 0) {
      speed = 0;
    } else if (dt > 3) {
      speed = 0;
    }
    atomicWriteJson(cachePath, {
      conversationId: convId || cache.conversationId || null,
      lastTokens: currentTokens,
      lastTimestamp: now,
      lastSpeed: speed
    });
  }
  return speed;
}

module.exports = {
  readLastBytes,
  categoriseTool,
  resolveTranscript,
  parseTranscript,
  parseUpdateStepsArgs,
  getSpeed
};
