const assert = require('assert');
const { makeLink, toFileUrl } = require('../src/hyperlinks');
const { loadConfig, DEFAULT_CONFIG } = require('../src/config');

const link = makeLink('my-repo', 'https://github.com/user/repo', true);
assert.strictEqual(link, '\x1b]8;;https://github.com/user/repo\x1b\\my-repo\x1b]8;;\x1b\\');

const unlinked = makeLink('my-repo', 'https://github.com/user/repo', false);
assert.strictEqual(unlinked, 'my-repo');

assert.strictEqual(toFileUrl('C:\\Users\\dev\\project'), 'file:///C:/Users/dev/project');
assert.strictEqual(toFileUrl('/home/dev/project'), 'file:///home/dev/project');

assert.strictEqual(DEFAULT_CONFIG.enableLinks, true);
assert.strictEqual('showMemory' in DEFAULT_CONFIG, false);

const config = loadConfig();
assert.strictEqual(config.preset, 'full');
console.log('✔ Hyperlinks & Config test passed');
