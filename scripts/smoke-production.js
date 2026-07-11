'use strict';

const baseUrl = (process.env.SMOKE_BASE_URL || 'https://nrl.the-squad.com.au').replace(/\/$/, '');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

async function request(path, type) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(baseUrl + path, {
      headers: {'User-Agent': 'nrl-fantasy-production-monitor/1.0'},
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    const body = type === 'json' ? await response.json() : await response.text();
    console.log(`[smoke] ${path} ok in ${Date.now() - started}ms`);
    return body;
  } finally { clearTimeout(timeout); }
}

async function main() {
  const health = await request('/health', 'json');
  if (health.ok !== true) throw new Error('/health did not report ok=true');

  const ready = await request('/ready', 'json');
  if (ready.ok !== true || ready.storage !== 'postgresql')
    throw new Error(`/ready reported unexpected state: ${JSON.stringify(ready)}`);

  const homepage = await request('/', 'text');
  if (homepage.length < 10000 || !homepage.includes('id="app-main"'))
    throw new Error('Homepage response did not contain the expected application shell');

  console.log('[smoke] production checks passed');
}

main().catch(error => {
  console.error('[smoke] production check failed:', error.message);
  process.exitCode = 1;
});
