/**
 * persist.ts — tiny namespaced localStorage helpers. Every access is wrapped so
 * a private window, a full quota or storage being disabled just yields the
 * fallback instead of throwing.
 */

const NS = 'jarvis:v1:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* quota exceeded / storage disabled — drop it */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(NS + key);
  } catch {
    /* ignore */
  }
}
