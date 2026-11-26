'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGoldenAmount } = require('../golden-utilities');

test('Golden amount parser accepts K/M and Arabic suffixes', () => {
  assert.equal(parseGoldenAmount('10k'), 10000);
  assert.equal(parseGoldenAmount('2.5m'), 2500000);
  assert.equal(parseGoldenAmount('3ك'), 3000);
  assert.equal(parseGoldenAmount('4م'), 4000000);
  assert.equal(parseGoldenAmount('-5m'), null);
  assert.equal(parseGoldenAmount('bad'), null);
});
