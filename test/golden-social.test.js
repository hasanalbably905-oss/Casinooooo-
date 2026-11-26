'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleGoldenSocial } = require('../golden-social');

function makeMessage(content, target) {
  const replies = [];
  const author = { id: '11111111111111111', bot: false };
  const targetUser = target ? { id: target, toString: () => '<@' + target + '>' } : null;
  return {
    content,
    guild: {},
    author,
    member: { roles: { cache: { has: () => true } } },
    mentions: { users: { first: () => targetUser } },
    client: { users: { fetch: async id => id === target ? targetUser : null } },
    replies,
    reply: async payload => { replies.push(payload); return payload; },
  };
}

test('Golden social friend add persists in the current account object', async () => {
  const users = {};
  const saved = { count: 0 };
  const account = id => users[id] ||= { id, coins: 0, friends: [], blocked: [] };
  const message = makeMessage('فرند <@22222222222222222>', '22222222222222222');
  const handled = await handleGoldenSocial(message, {
    account,
    save: async () => { saved.count++; },
    premiumRoleId: 'premium',
  });
  assert.equal(handled, true);
  assert.deepEqual(account(message.author.id).friends, ['22222222222222222']);
  assert.equal(saved.count, 1);
  assert.equal(message.replies.length, 1);
});

test('Golden premium block removes the target from friends', async () => {
  const users = {};
  const account = id => users[id] ||= { id, coins: 0, friends: ['22222222222222222'], blocked: [] };
  const message = makeMessage('بلوك <@22222222222222222>', '22222222222222222');
  await handleGoldenSocial(message, { account, save: async () => {}, premiumRoleId: 'premium' });
  assert.deepEqual(account(message.author.id).friends, []);
  assert.deepEqual(account(message.author.id).blocked, ['22222222222222222']);
});
