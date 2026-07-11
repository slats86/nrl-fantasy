'use strict';
const path = require('path');
const {createDatabase} = require('../db');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = createDatabase({connectionString: process.env.DATABASE_URL, dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data')});
  try { await db.migrate(); console.log('PostgreSQL migrations complete'); } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
