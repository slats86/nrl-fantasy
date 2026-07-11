'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createDatabase} = require('../db');
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
