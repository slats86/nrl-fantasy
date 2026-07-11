const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const port = 32187;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrl-fantasy-test-'));
let server;

test.before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {...process.env, PORT: String(port), DATA_DIR: dataDir, APP_URL: `http://127.0.0.1:${port}`},
    stdio: 'ignore'
  });
  for (let i = 0; i < 30; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Test server did not start');
});

test.after(() => {
  if (server) server.kill();
  fs.rmSync(dataDir, {recursive: true, force: true});
});

test('health endpoint and security headers', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.uptime, 'number');
});

test('unknown API paths return JSON 404', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/missing`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type'), /application\/json/);
});

test('large frontend responses are compressed', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`, {headers: {'accept-encoding': 'br'}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'br');
});

test('team updates require authentication', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/soo/league/ABC123/picks`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({teamId: 'TEAM', picks: {}})
  });
  assert.ok([401, 404].includes(response.status));
});

test('removed destructive admin route is unavailable', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/soo/admin/wipe-leagues`);
  assert.equal(response.status, 404);
});

test('registration issues a secure cookie without exposing a bearer token', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/soo/register`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({name: 'Test User', email: 'test@example.com', password: 'a-long-test-password'})
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
  const body = await response.json();
  assert.equal(body.token, undefined);
});

test('score writes reject non-admin users and browser secrets', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/api/soo/scores`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({secret: 'SCORESECRET2026', game: 3, scores: {123: 50}})
  });
  assert.equal(response.status, 403);
});

test('unexpected async storage errors return a traceable 500 without crashing', async () => {
  const failurePort = port + 1;
  const invalidDataDir = path.join(os.tmpdir(), `nrl-fantasy-invalid-data-${process.pid}`);
  fs.writeFileSync(invalidDataDir, 'not a directory');
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {...process.env, PORT: String(failurePort), DATA_DIR: invalidDataDir, APP_URL: `http://127.0.0.1:${failurePort}`},
    stdio: 'ignore'
  });
  try {
    for (let i = 0; i < 30; i++) {
      try { if ((await fetch(`http://127.0.0.1:${failurePort}/health`)).ok) break; } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const response = await fetch(`http://127.0.0.1:${failurePort}/api/soo/register`, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'Failure Test', email: 'failure@example.com', password: 'a-long-test-password'})
    });
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.error, 'Internal server error');
    assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal((await fetch(`http://127.0.0.1:${failurePort}/health`)).status, 200);
  } finally {
    child.kill();
    fs.rmSync(invalidDataDir, {force: true});
  }
});
