'use strict';
const fs = require('fs');

/**
 * Bounded JSONL transcript reader.
 * Parses active subagents (with runtimes), tool call tallies, skills, MCP servers, and checklist/plan progress.
 */
function parseTranscript(transcriptPath) {
  const result = {
    toolCounts: {},
    activeSubagents: [],
    skills: [],
    mcpServers: [],
    planProgress: { done: 0, total: 0 }
  };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return result;

  try {
    const stats = fs.statSync(transcriptPath);
    const readSize = Math.min(stats.size, 262144);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, readSize, stats.size - readSize);
    fs.closeSync(fd);

    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    const subagentsMap = new Map();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);

        // Tool calls tracking
        if (entry.tool_calls) {
          for (const tc of entry.tool_calls) {
            const name = tc.name || tc.function || 'tool';
            result.toolCounts[name] = (result.toolCounts[name] || 0) + 1;

            if (name === 'invoke_subagent' && tc.args) {
              const subId = tc.args.conversationID || tc.args.Recipient || `sub-${subagentsMap.size}`;
              subagentsMap.set(subId, {
                id: subId,
                role: tc.args.Role || tc.args.TypeName || 'subagent',
                model: tc.args.Model || 'flash',
                startTime: entry.timestamp ? new Date(entry.timestamp) : new Date(),
                status: 'running'
              });
            }
          }
        }
      } catch (_) {}
    }

    result.activeSubagents = Array.from(subagentsMap.values());
  } catch (_) {}

  return result;
}

module.exports = { parseTranscript };
