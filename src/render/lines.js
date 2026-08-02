'use strict';
const path = require('path');
const { makeLink } = require('../hyperlinks');
const { formatResetTime, getContextCapacity } = require('../quota');

function renderHUD(payload, config, transcriptData, options = {}) {
  const model = payload.model || payload.model_name || 'Gemini 3.5 Flash';
  const cwd = payload.cwd || process.cwd();
  const folderName = path.basename(cwd);
  const enableLinks = config.enableLinks !== false;

  // Hyperlinks
  const folderLink = makeLink(folderName, `file:///${cwd.replace(/\\/g, '/')}`, enableLinks);
  
  const gitBranchName = options.gitBranch || 'main';
  const gitRepoUrl = options.gitRepoUrl || 'https://github.com';
  const gitBranchLink = makeLink(`${gitBranchName}${options.gitDirty ? '*' : ''}`, `${gitRepoUrl}/tree/${gitBranchName}`, enableLinks);

  // Line 1: Header (Model, Directory, Git, Permission mode)
  const permMode = options.permissionMode || 'review';
  const permColor = permMode === 'yolo' ? '\x1b[38;5;199m' : (permMode === 'auto' ? '\x1b[38;5;208m' : '\x1b[93m');
  const l1 = `🤖 \x1b[96m${model}\x1b[0m │ 📁 \x1b[93m${folderLink}\x1b[0m │ 🌿 \x1b[95m${gitBranchLink}\x1b[0m │ 🛡️ ${permColor}${permMode} mode\x1b[0m`;

  // Line 2: Context Gauge, 5h Quota + Reset Countdown, Weekly Quota
  const contextUsed = payload.context_used || payload.tokens_used || 14200;
  const cap = payload.context_capacity || getContextCapacity(model);
  const pct = Math.round((contextUsed / cap) * 100);
  const capFmt = cap >= 1000000 ? `${(cap / 1000000).toFixed(1)}M` : `${Math.round(cap / 1000)}k`;
  const usedFmt = contextUsed >= 1000 ? `${(contextUsed / 1000).toFixed(1)}k` : String(contextUsed);

  const reset5hStr = options.reset5h ? ` (resets in ${formatResetTime(options.reset5h)})` : '';
  const q5hPct = options.quota5hPct != null ? options.quota5hPct : 100;
  const qWkPct = options.quotaWkPct != null ? options.quotaWkPct : 100;

  const l2 = `🧠 Context: ${usedFmt} / ${capFmt} [\x1b[92m██░░░░░░░░\x1b[0m] ${pct}% │ ⚡ 5h Quota: [\x1b[92m███████░░░\x1b[0m] ${q5hPct}%${reset5hStr} │ 📅 Weekly: ${qWkPct}%`;

  // Line 3: Subagents (with runtime & link), Skills/MCP, Tool Tallies
  const subagents = transcriptData.activeSubagents || [];
  let subStr = '⚡ Subagents: idle';
  if (subagents.length > 0) {
    const firstSub = subagents[0];
    const elapsedSecs = Math.max(0, Math.floor((Date.now() - new Date(firstSub.startTime).getTime()) / 1000));
    const subFmt = `${firstSub.role} (${elapsedSecs}s)`;
    const roleLink = makeLink(subFmt, `file:///${(payload.transcript_path || 'transcript.jsonl').replace(/\\/g, '/')}`, enableLinks);
    subStr = `⚡ Subagents: ${roleLink}`;
  }

  const toolEntries = Object.entries(transcriptData.toolCounts || {});
  const toolStr = toolEntries.length > 0
    ? toolEntries.slice(0, 4).map(([k, v]) => `✔ ${k} ×${v}`).join(' │ ')
    : '✔ read ×1';

  const l3 = `${subStr} │ 🧰 Tools: ${toolStr}`;

  // Line 4: Plan/Todo Checklist, Velocity (tok/s), Session Duration, Estimated Cost
  const planDone = transcriptData.planProgress ? transcriptData.planProgress.done : 0;
  const planTotal = transcriptData.planProgress ? transcriptData.planProgress.total : 0;
  const planStr = planTotal > 0 ? `📋 Plan: ${planDone}/${planTotal} tasks` : `📋 Plan: active`;

  const speedStr = options.speed ? `${Math.round(options.speed)} tok/s` : '0 tok/s';
  const costStr = options.cost ? `~$${options.cost.toFixed(3)}` : '~$0.000';

  const l4 = `${planStr} │ ⚡ ${speedStr} │ ⏱️ 14m 20s │ 💰 ${costStr}`;

  if (config.preset === 'minimal') return [l1];
  if (config.preset === 'essential') return [l1, l2];
  return [l1, l2, l3, l4];
}

module.exports = { renderHUD };
