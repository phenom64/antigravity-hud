const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const binPath = path.join(__dirname, '../bin/antigravity-hud.js');
const samplePath = path.join(__dirname, '../docs/payload-examples/statusline-last.example.json');
const sampleJson = fs.readFileSync(samplePath, 'utf8');
const isolatedConfigPath = path.join(os.tmpdir(), `agy-hud-nonexistent-${process.pid}.json`);

// 1. Doctor subcommand
const doctorOut = execFileSync(process.execPath, [binPath, 'doctor'], { encoding: 'utf8' });
assert.ok(doctorOut.includes('Antigravity HUD Diagnostics') || doctorOut.includes('Doctor'));
assert.ok(doctorOut.includes('Sample Window Title Output'));

// 2. Default stdin HUD render (isolated from host user config)
const hudOut = execFileSync(process.execPath, [binPath], {
  input: sampleJson,
  encoding: 'utf8',
  env: Object.assign({}, process.env, {
    AGY_HUD_NO_COLOR: '1',
    AGY_HUD_CONFIG: isolatedConfigPath
  })
});
const hudLines = hudOut.trimEnd().split('\n');
assert.strictEqual(hudLines.length, 4);
assert.ok(hudLines[0].includes('Gemini 4 Neon (High)'));
assert.ok(hudLines[1].includes('$0.421'));

// 3. Companion title subcommand (plain text, single line, no ANSI)
const titleOut = execFileSync(process.execPath, [binPath, 'title'], {
  input: sampleJson,
  encoding: 'utf8',
  env: Object.assign({}, process.env, { AGY_HUD_CONFIG: isolatedConfigPath })
});
assert.ok(!titleOut.includes('\x1b'));
assert.strictEqual(titleOut.trim().split('\n').length, 1);
assert.ok(titleOut.includes('my-app'));
assert.ok(titleOut.includes('G4 Neon (H)'));

// 4. Updated bind-shift-tab message reflects native Shift+Tab support
const shiftTabOut = execFileSync(process.execPath, [binPath, 'bind-shift-tab'], { encoding: 'utf8' });
assert.ok(shiftTabOut.includes('natively supported'));

console.log('✔ Integration tests (doctor, HUD, title, bind-shift-tab) passed');

// 5. Standalone (npx-style) install --with-title -> doctor -> render -> reinstall -> uninstall
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
    AGY_HUD_NO_COLOR: '1',
    AGY_HUD_CONFIG: isolatedConfigPath
  });

  // Install without antigravity-hud on PATH
  const installOut = execFileSync(process.execPath, [binPath, 'install', '--with-title'], { encoding: 'utf8', env });
  assert.ok(installOut.includes('Installed standalone runtime'), 'Expected standalone runtime install output');

  const settingsDir = path.join(tmpHome, '.gemini', 'antigravity-cli');
  const settingsFile = path.join(settingsDir, 'settings.json');
  const standaloneBin = path.join(settingsDir, 'antigravity-hud', 'bin', 'antigravity-hud.js');

  assert.ok(fs.existsSync(standaloneBin), 'Expected standalone bin/antigravity-hud.js to exist');
  assert.ok(fs.existsSync(path.join(settingsDir, 'antigravity-hud', 'src', 'title.js')), 'Expected src/title.js copied');
  assert.ok(fs.existsSync(settingsFile), 'Expected settings.json to be created');

  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.strictEqual(settings.statusLine.type, 'command');
  assert.strictEqual(settings.statusLine.enabled, true);
  assert.ok(
    settings.statusLine.command.includes('antigravity-hud.js'),
    `Expected standalone command in settings.json, got: ${settings.statusLine.command}`
  );
  assert.strictEqual(settings.title.command, `${settings.statusLine.command} title`);

  // Execute the installed standalone runtime directly with sample payload (HUD + title)
  const hudStandaloneOut = execFileSync(process.execPath, [standaloneBin], { input: sampleJson, encoding: 'utf8', env });
  assert.ok(hudStandaloneOut.trim().length > 0, 'Expected standalone runtime to render non-empty HUD');
  const titleStandaloneOut = execFileSync(process.execPath, [standaloneBin, 'title'], { input: sampleJson, encoding: 'utf8', env });
  assert.ok(titleStandaloneOut.includes('my-app'), 'Expected standalone runtime to render title');

  // Doctor should recognize the standalone install
  const doctorStandaloneOut = execFileSync(process.execPath, [binPath, 'doctor'], { encoding: 'utf8', env });
  assert.ok(doctorStandaloneOut.includes('Standalone runtime installed'), 'Expected doctor to detect standalone runtime');
  assert.ok(doctorStandaloneOut.includes('currently configured to use antigravity-hud'), 'Expected doctor to confirm configuration');

  // Re-running install should succeed cleanly and refresh runtime
  const reinstallOut = execFileSync(process.execPath, [binPath, 'install', '--with-title'], { encoding: 'utf8', env });
  assert.ok(reinstallOut.includes('Runtime updated'), 'Expected idempotent reinstall message');

  // Uninstall should disable statusLine + title and remove standalone runtime directory
  const uninstallOut = execFileSync(process.execPath, [binPath, 'uninstall'], { encoding: 'utf8', env });
  assert.ok(uninstallOut.includes('Disabled statusLine'), 'Expected uninstall to disable statusLine');
  assert.ok(uninstallOut.includes('Disabled title'), 'Expected uninstall to disable title');
  assert.ok(!fs.existsSync(path.join(settingsDir, 'antigravity-hud')), 'Expected uninstall to remove standalone dir');

  const afterUninstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.strictEqual(afterUninstall.statusLine.enabled, false);
  assert.strictEqual(afterUninstall.title.enabled, false);

  console.log('✔ Integration standalone install/doctor/uninstall test passed');
} finally {
  fs.rmSync(tmpHome, { recursive: true, force: true });
}
