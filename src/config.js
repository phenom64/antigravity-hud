'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-config.json');

const DEFAULT_CONFIG = {
  preset: 'full',
  layoutStyle: 'default',
  contextValue: 'both',
  pathLevels: 1,
  showCost: true,
  showSpeed: true,
  showCacheHit: true,
  showQuotaPace: false,
  showActiveTool: true,
  showConfigCounts: true,
  showSkills: true,
  showMcp: true,
  showSubagents: true,
  showTodos: true,
  showArtifacts: true,
  showConversationId: false,
  enableLinks: true,
  colorMode: true,
  unicodeMode: true,
  colors: {}
};

function loadConfig(configPathOverride = null) {
  const targetPath = configPathOverride || process.env.AGY_HUD_CONFIG || CONFIG_PATH;
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      const data = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      return Object.assign({}, DEFAULT_CONFIG, data);
    }
  } catch (_) {}
  return Object.assign({}, DEFAULT_CONFIG);
}

module.exports = { loadConfig, CONFIG_PATH, DEFAULT_CONFIG };
