'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createDatabase, readLegacySnapshot} = require('../db');
test('database operations retry transient failures', async () => {
  const db = createDatabase({pool: {}}); let attempts = 0;
  const result = await db.retry(async () => { attempts++; if (attempts < 3) throw new Error('temporary outage'); return 'ok'; });
  assert.equal(result, 'ok'); assert.equal(attempts, 3);
});
test('database operations surface failure after bounded retries', async () => {
  const db = createDatabase({pool: {}}); let attempts = 0;
  await assert.rejects(db.retry(async () => { attempts++; throw new Error('database unavailable'); }, 2), /database unavailable/);
  assert.equal(attempts, 2);
});
test('empty legacy snapshots remain distinguishable from importable data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrl-empty-json-'));
  try {
    assert.equal(readLegacySnapshot(dir).total, 0);
    fs.writeFileSync(path.join(dir, 'soo-users.json'), JSON.stringify({a:{email:'a@example.com'}}));
    const snapshot = readLegacySnapshot(dir);
    assert.equal(snapshot.total, 1);
    assert.deepEqual(snapshot.counts, {users:1, leagues:0, scores:0});
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
