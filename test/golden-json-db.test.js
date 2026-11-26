'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJsonDatabase } = require('../golden-json-db');

test('JSON model supports create, query, update operators and persistence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-json-'));
  const filePath = path.join(dir, 'store.json');
  try {
    const db = createJsonDatabase({ filePath });
    const User = db.model('users');
    await User.create({ id: 'u1', coins: 100, tags: ['player'], nested: { rank: 1 } });
    await User.create({ id: 'u2', coins: 50 });
    assert.equal((await User.findOne({ id: 'u1' }).lean()).coins, 100);
    assert.equal(await User.countDocuments({ coins: { $gte: 50 } }), 2);
    await User.updateOne({ id: 'u1' }, { $inc: { coins: 25 }, $push: { tags: 'vip' }, $set: { 'nested.rank': 2 } });
    const updated = await User.findOne({ id: 'u1' }).lean();
    assert.equal(updated.coins, 125);
    assert.deepEqual(updated.tags, ['player', 'vip']);
    assert.equal(updated.nested.rank, 2);
    const sorted = await User.find({}).sort({ coins: -1 }).limit(1).lean();
    assert.equal(sorted[0].id, 'u1');
    await User.deleteOne({ id: 'u2' });
    const reopened = createJsonDatabase({ filePath });
    assert.equal(await reopened.model('users').countDocuments({}), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
