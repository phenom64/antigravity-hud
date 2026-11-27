'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Shallowly count files in a directory matching a predicate (never recursive, never throws).
 */
function countShallowFiles(dirPath, predicate) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) return 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let count = 0;
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!predicate || predicate(e.name)) count++;
    }
    return count;
  } catch (_) {
    return 0;
  }
}

/**
 * Gather fast, bounded workspace & CLI configuration counts (claude-hud style):
 * - docs: GEMINI.md / AGENTS.md / CLAUDE.md files in project & global dirs
 * - rules: .md rule files in project & global rules dirs
 * - hooks: configured hook entries in settings.json
 * - mcpCount: configured MCP servers in settings.json / mcp_config.json
 *
 * Strictly O(1) shallow stat/readdir calls — never walks subdirectories and never throws.
 */
function getWorkspaceContextCounts(projectDir, settings = {}, options = {}) {
  const result = { docs: 0, rules: 0, hooks: 0, configuredMcp: 0 };
  const home = options.homedir || os.homedir();
  const seenDocs = new Set();

  const checkDoc = (filePath) => {
    try {
      if (!filePath) return;
      const norm = path.resolve(filePath).toLowerCase();
      if (seenDocs.has(norm)) return;
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        seenDocs.add(norm);
        result.docs++;
      }
    } catch (_) {}
  };

  if (projectDir) {
    for (const name of ['GEMINI.md', 'AGENTS.md', 'CLAUDE.md']) {
      checkDoc(path.join(projectDir, name));
      checkDoc(path.join(projectDir, '.gemini', name));
    }
  }
  checkDoc(path.join(home, '.gemini', 'GEMINI.md'));
  checkDoc(path.join(home, '.gemini', 'antigravity-cli', 'GEMINI.md'));

  // Shallow rule directories (1 level only)
  const isMd = (n) => /\.md$/i.test(n);
  const ruleDirs = [
    path.join(home, '.gemini', 'antigravity-cli', 'rules'),
    path.join(home, '.gemini', 'rules')
  ];
  if (projectDir) {
    ruleDirs.push(
      path.join(projectDir, '.gemini', 'rules'),
      path.join(projectDir, '.agents', 'rules')
    );
  }
  const seenRuleDirs = new Set();
  for (const dir of ruleDirs) {
    try {
      const norm = path.resolve(dir).toLowerCase();
      if (seenRuleDirs.has(norm)) continue;
      seenRuleDirs.add(norm);
      result.rules += countShallowFiles(dir, isMd);
    } catch (_) {}
  }

  // Hooks from settings.json
  try {
    if (settings && settings.hooks && typeof settings.hooks === 'object') {
      for (const val of Object.values(settings.hooks)) {
        if (Array.isArray(val)) result.hooks += val.length;
        else if (val && typeof val === 'object') result.hooks += 1;
      }
    }
  } catch (_) {}

  // Configured MCP servers from settings.json or mcp_config.json
  const mcpNames = new Set();
  try {
    if (settings && settings.mcpServers && typeof settings.mcpServers === 'object') {
      for (const k of Object.keys(settings.mcpServers)) mcpNames.add(k);
    }
  } catch (_) {}

  try {
    const mcpConfigPath = path.join(home, '.gemini', 'antigravity-cli', 'mcp_config.json');
    if (fs.existsSync(mcpConfigPath)) {
      const parsed = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      const servers = parsed && (parsed.mcpServers || parsed.servers);
      if (servers && typeof servers === 'object') {
        for (const k of Object.keys(servers)) mcpNames.add(k);
      }
    }
  } catch (_) {}

  result.configuredMcp = mcpNames.size;
  return result;
}

module.exports = { getWorkspaceContextCounts };
