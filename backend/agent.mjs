/**
 * J.A.R.V.I.S. telemetry agent — run this on your own machine to feed its
 * real CPU/RAM into the deployed HUD, instead of it only ever showing
 * whatever container the backend proxy happens to be hosted on.
 *
 * Posts a sample every 1.5s to AGENT_TARGET_URL's /api/host-metrics,
 * authenticated with AGENT_TOKEN (must match the same env var set on that
 * server). Reads both from backend/.env.local, same as the proxy does —
 * add them there, or export them in your shell before running.
 *
 *   npm run agent          (from backend/, or `npm run agent` at the repo root)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHostSampler } from './lib/metrics.mjs';

for (const file of ['.env.local', '.env']) {
  try {
    const txt = readFileSync(resolve(process.cwd(), file), 'utf8');
    for (const raw of txt.split('\n')) {
      const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (!m || raw.trim().startsWith('#')) continue;
      const key = m[1];
      let val = (m[2] ?? '').trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    /* both files are optional */
  }
}

const TARGET = (process.env.AGENT_TARGET_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.AGENT_TOKEN || '';

if (!TARGET || !TOKEN) {
  console.error(
    '[agent] Set AGENT_TARGET_URL (your deployed backend\'s URL) and AGENT_TOKEN\n' +
      '        (matching the AGENT_TOKEN set on that server) in backend/.env.local,\n' +
      '        then run this again.',
  );
  process.exit(1);
}

const sample = createHostSampler();

async function tick() {
  const body = sample();
  try {
    const res = await fetch(`${TARGET}/api/host-metrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      process.stdout.write(`\r[agent] cpu ${body.cpu}% · ram ${body.ram}%  →  ${TARGET}   `);
    } else {
      console.warn(`\n[agent] ${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    console.warn(`\n[agent] send failed: ${String(err?.message || err)}`);
  }
}

console.log(`[agent] streaming this machine's stats to ${TARGET} every 1.5s (Ctrl+C to stop)`);
tick();
setInterval(tick, 1500);
