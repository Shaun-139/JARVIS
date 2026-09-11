/**
 * Host CPU/RAM sampling — shared by the proxy (samples its own container)
 * and the telemetry agent (samples your own machine), so "your PC" and
 * "the server" report numbers computed the exact same way.
 */

import os from 'node:os';

const round1 = (n) => Math.round(n * 10) / 10;
const clamp01hundred = (n) => Math.max(0, Math.min(100, n));

/** Returns a `sample()` function; call it on an interval (every ~1.5s). */
export function createHostSampler() {
  let cpuTimesPrev = os.cpus().map((c) => c.times);
  let procCpuPrev = process.cpuUsage();
  let procCpuPrevT = Date.now();
  let lastCpu = 0;

  return function sample() {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (let i = 0; i < cpus.length; i++) {
      const now = cpus[i].times;
      const prev = cpuTimesPrev[i] ?? now;
      const dIdle = now.idle - prev.idle;
      const dBusy =
        now.user - prev.user + (now.nice - prev.nice) + (now.sys - prev.sys) + (now.irq - prev.irq);
      idle += dIdle;
      total += dIdle + dBusy;
    }
    cpuTimesPrev = cpus.map((c) => c.times);
    const cpu = total > 0 ? (1 - idle / total) * 100 : lastCpu;
    lastCpu = cpu;

    const ramUsed = os.totalmem() - os.freemem();
    const ram = (ramUsed / os.totalmem()) * 100;

    const nowT = Date.now();
    const pu = process.cpuUsage(procCpuPrev); // µs of CPU since last sample
    const dtMs = nowT - procCpuPrevT || 1;
    procCpuPrev = process.cpuUsage();
    procCpuPrevT = nowT;
    const procCpu = ((pu.user + pu.system) / 1000 / dtMs) * 100;

    return {
      cpu: round1(clamp01hundred(cpu)),
      ram: round1(clamp01hundred(ram)),
      ramUsedGb: round1(ramUsed / 1e9),
      ramTotalGb: round1(os.totalmem() / 1e9),
      procMb: Math.round(process.memoryUsage().rss / 1048576),
      procCpu: round1(Math.max(0, procCpu)),
      cores: cpus.length,
      uptimeS: Math.round(process.uptime()),
      ts: nowT,
    };
  };
}
