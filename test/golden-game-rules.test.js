'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rpsWinner, xoWinner, xoIsDraw } = require('../golden-game-rules');

test('rock-paper-scissors winner follows Golden rules', () => {
  assert.equal(rpsWinner('rock', 'scissors', 'p1', 'p2'), 'p1');
  assert.equal(rpsWinner('paper', 'rock', 'p1', 'p2'), 'p1');
  assert.equal(rpsWinner('scissors', 'paper', 'p1', 'p2'), 'p1');
  assert.equal(rpsWinner('rock', 'rock', 'p1', 'p2'), null);
  assert.equal(rpsWinner('scissors', 'rock', 'p1', 'p2'), 'p2');
});

test('XO detects wins and draws', () => {
  assert.equal(xoWinner(['X','X','X','O',null,'O',null,null,null], 'X'), true);
  assert.equal(xoWinner(['X','O','X','O','X','O','O','X','O'], 'X'), false);
  assert.equal(xoIsDraw(['X','O','X','X','O','O','O','X','X']), true);
  assert.equal(xoIsDraw(['X','O','X','X','O',null,'O','X','X']), false);
});
