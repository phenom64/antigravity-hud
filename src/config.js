'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'antigravity-hud-config.json');

const DEFAULT_CONFIG = {
  preset: 'full',
  showCost: true,
  showSpeed: true,
  showMemory: false,
  showSkills: true,
  showMcp: true,
  showSubagents: true,
  showTodos: true,
  enableLinks: true,
  colorMode: true,
  unicodeMode: true,
  colors: {}
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return Object.assign({}, DEFAULT_CONFIG, data);
    }
  } catch (_) {}
  return Object.assign({}, DEFAULT_CONFIG);
}

module.exports = { loadConfig, CONFIG_PATH, DEFAULT_CONFIG };
