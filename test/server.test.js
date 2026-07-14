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

test('Team News API serves the verified snapshot with freshness and cache validation', async () => {
  const response=await fetch(`http://127.0.0.1:${port}/api/team-news`);
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/json/);assert.equal(response.headers.get('cache-control'),'no-cache, max-age=0, must-revalidate');assert.ok(response.headers.get('etag'));assert.ok(response.headers.get('x-team-news-freshness'));
  const body=await response.json();assert.equal(body.schemaVersion,1);assert.ok(body.availability.length>50);assert.ok(body.teamLists.length>=7);assert.ok(body.availability.every(item=>item.sourceUrl&&item.checkedAt));
  const head=await fetch(`http://127.0.0.1:${port}/api/team-news`,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('malformed and oversized JSON requests fail safely', async () => {
  const malformed = await fetch(`http://127.0.0.1:${port}/api/soo/create`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: '{not-json'
  });
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get('content-type'), /application\/json/);
  assert.ok(malformed.headers.get('x-request-id'));

  const oversized = await fetch(`http://127.0.0.1:${port}/api/soo/create`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({value: 'x'.repeat(110000)})
  });
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'Payload too large');
});

test('unsupported app methods advertise the allowed methods', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`, {method: 'PUT'});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('large frontend responses are compressed', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/`, {headers: {'accept-encoding': 'br'}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'br');
});

test('HTML and data support conditional requests without retransferring bodies', async () => {
  for (const requestPath of ['/', '/api/players', '/assets/season-data.js']) {
    const initial = await fetch(`http://127.0.0.1:${port}${requestPath}`);
    assert.equal(initial.status, 200);
    const etag = initial.headers.get('etag');
    assert.match(etag, /^W\/"[A-Za-z0-9_-]+"$/);
    if (requestPath === '/api/players') {
      assert.equal(initial.headers.get('cache-control'), 'no-cache, max-age=0, must-revalidate');
      assert.ok(initial.headers.get('x-nrl-data-source'));
      assert.match(initial.headers.get('x-nrl-data-stale'), /^(true|false)$/);
    }
    const conditional = await fetch(`http://127.0.0.1:${port}${requestPath}`, {headers: {'if-none-match': etag}});
    assert.equal(conditional.status, 304);
    assert.equal((await conditional.arrayBuffer()).byteLength, 0);
  }
});

test('live feed routes support cache-safe HEAD requests', async () => {
  for (const requestPath of ['/api/players', '/api/rounds']) {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, {method: 'HEAD'});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-cache, max-age=0, must-revalidate');
    assert.ok(response.headers.get('etag'));
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  }
});

test('cacheable data assets are JavaScript and unknown assets are unavailable', async () => {
  const asset = await fetch(`http://127.0.0.1:${port}/assets/data-core.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /application\/javascript/);
  assert.ok((await asset.text()).includes('const PLAYERS='));
  assert.equal((await fetch(`http://127.0.0.1:${port}/assets/unknown.js`)).status, 404);
});

test('web app manifest and install icon are available with safe content types', async () => {
  const manifestResponse = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
  assert.equal(manifestResponse.status, 200);
  assert.match(manifestResponse.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.short_name, 'The Squad');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons[0].src, '/assets/app-icon.svg');

  const icon = await fetch(`http://127.0.0.1:${port}/assets/app-icon.svg`);
  assert.equal(icon.status, 200);
  assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await icon.text(), /<svg/);
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

test('account deletion requires a password and removes login and league data', async () => {
  const email = 'delete-me@example.com';
  const password = 'delete-account-password';
  const registration = await fetch(`http://127.0.0.1:${port}/api/soo/register`, {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({name: 'Delete Me', email, password})
  });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`http://127.0.0.1:${port}/api/soo/create`, {
    method: 'POST', headers: {'content-type': 'application/json', cookie},
    body: JSON.stringify({name: 'Temporary League', teamName: 'Temporary Team', picks: {}})
  });
  assert.equal(created.status, 200);
  const {code} = await created.json();

  const rejected = await fetch(`http://127.0.0.1:${port}/api/soo/account`, {
    method: 'DELETE', headers: {'content-type': 'application/json', cookie}, body: JSON.stringify({password: 'wrong-password'})
  });
  assert.equal(rejected.status, 403);

  const deleted = await fetch(`http://127.0.0.1:${port}/api/soo/account`, {
    method: 'DELETE', headers: {'content-type': 'application/json', cookie}, body: JSON.stringify({password})
  });
  assert.equal(deleted.status, 200);
  assert.match(deleted.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/soo/me`, {headers: {cookie}})).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/soo/league/${code}`, {headers: {cookie}})).status, 404);
  const login = await fetch(`http://127.0.0.1:${port}/api/soo/login`, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email, password})
  });
  assert.equal(login.status, 401);
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
    const retry = await fetch(`http://127.0.0.1:${failurePort}/api/soo/register`, {
      method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({name: 'Failure Test', email: 'failure@example.com', password: 'a-long-test-password'})
    });
    assert.equal(retry.status, 500, 'failed persistence must roll back the in-memory registration');
    assert.equal((await fetch(`http://127.0.0.1:${failurePort}/health`)).status, 200);
  } finally {
    child.kill();
    fs.rmSync(invalidDataDir, {force: true});
  }
});
