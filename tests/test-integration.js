const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const binPath = path.join(__dirname, '../bin/antigravity-hud.js');
const samplePayloadPath = path.join(__dirname, '../docs/payload-examples/statusline-last.example.json');

// 1. Basic doctor check
const output = execFileSync(process.execPath, [binPath, 'doctor'], { encoding: 'utf8' });
assert.ok(output.includes('Antigravity HUD Diagnostics') || output.includes('Doctor'));
console.log('✔ Integration doctor test passed');

// 2. Standalone (npx-style) install -> doctor -> render -> reinstall -> uninstall
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-hud-test-'));
try {
  // Filter out any directory containing an existing global antigravity-hud so we exercise standalone install
  const pathSep = os.platform() === 'win32' ? ';' : ':';
  const filteredPath = (process.env.PATH || '')
    .split(pathSep)
    .filter(dir => {
      if (!dir) return false;
      return (
        !fs.existsSync(path.join(dir, 'antigravity-hud')) &&
        !fs.existsSync(path.join(dir, 'antigravity-hud.cmd'))
      );
    })
    .join(pathSep);

  const env = Object.assign({}, process.env, {
    HOME: tmpHome,
    USERPROFILE: tmpHome,
    PATH: filteredPath,
    AGY_HUD_NO_COLOR: '1'
  });

  // Install without antigravity-hud on PATH
  const installOut = execFileSync(process.execPath, [binPath, 'install'], { encoding: 'utf8', env });
  assert.ok(installOut.includes('Installed standalone runtime'), 'Expected standalone runtime install output');

  const settingsDir = path.join(tmpHome, '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');
  const standaloneBin = path.join(settingsDir, 'antigravity-hud', 'bin', 'antigravity-hud.js');

  assert.ok(fs.existsSync(standaloneBin), 'Expected standalone bin/antigravity-hud.js to exist');
  assert.ok(fs.existsSync(settingsFile), 'Expected settings.json to be created');

  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.strictEqual(settings.statusLine.type, 'command');
  assert.strictEqual(settings.statusLine.enabled, true);
  assert.ok(
    settings.statusLine.command.includes('antigravity-hud.js'),
    `Expected standalone command in settings.json, got: ${settings.statusLine.command}`
  );

  // Execute the installed standalone runtime directly with sample payload
  const sampleRaw = fs.readFileSync(samplePayloadPath, 'utf8');
  const hudOut = execFileSync(process.execPath, [standaloneBin], {
    input: sampleRaw,
    encoding: 'utf8',
    env
  });
  assert.ok(hudOut.trim().length > 0, 'Expected standalone runtime to render non-empty HUD');

  // Doctor should recognize the standalone install
  const doctorOut = execFileSync(process.execPath, [binPath, 'doctor'], { encoding: 'utf8', env });
  assert.ok(doctorOut.includes('Standalone runtime installed'), 'Expected doctor to detect standalone runtime');
  assert.ok(doctorOut.includes('currently configured to use antigravity-hud'), 'Expected doctor to confirm configuration');

  // Re-running install should succeed cleanly and refresh runtime
  const reinstallOut = execFileSync(process.execPath, [binPath, 'install'], { encoding: 'utf8', env });
  assert.ok(reinstallOut.includes('Runtime updated'), 'Expected idempotent reinstall message');

  // Uninstall should disable statusLine and remove standalone runtime directory
  const uninstallOut = execFileSync(process.execPath, [binPath, 'uninstall'], { encoding: 'utf8', env });
  assert.ok(uninstallOut.includes('Disabled statusLine'), 'Expected uninstall to disable statusLine');
  assert.ok(!fs.existsSync(path.join(settingsDir, 'antigravity-hud')), 'Expected uninstall to remove standalone dir');

  const afterUninstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.strictEqual(afterUninstall.statusLine.enabled, false);

  console.log('✔ Integration standalone install/doctor/uninstall test passed');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
