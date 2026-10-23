'use strict';
// Versionsvergleich des Updaters (läuft ohne Electron: electron wird hier durch einen Platzhalter ersetzt)
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') return { app: {}, net: {} };
  return orig.call(this, req, ...rest);
};
const { isNewer, parseVersion, feedUrl } = require('../src/main/updater');
Module._load = orig;

test('Versionen vergleichen', () => {
  assert.ok(isNewer('1.2.0', '1.1.0'));
  assert.ok(isNewer('v1.10.0', '1.9.9'));
  assert.ok(isNewer('2.0.0', '1.99.99'));
  assert.ok(!isNewer('1.1.0', '1.1.0'));
  assert.ok(!isNewer('1.0.9', '1.1.0'));
  assert.ok(!isNewer('kaputt', '1.0.0'));
  assert.deepStrictEqual(parseVersion('v1.2.3-beta'), [1, 2, 3]);
});

test('Feed-Adresse aus package.json', () => {
  const pkg = require('../package.json');
  assert.strictEqual(feedUrl(pkg), `https://github.com/${pkg.updates.github}/releases/latest/download/latest.json`);
  assert.strictEqual(feedUrl({}), null);
});
