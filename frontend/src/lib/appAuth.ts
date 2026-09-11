/**
 * appAuth — the optional whole-app password gate (separate concern from
 * backend/agent.mjs's AGENT_TOKEN). Stored once per browser; every API call
 * attaches it, so the backend can require APP_PASSWORD on every route.
 */

import { load, save, remove } from './persist';

const KEY = 'appPassword';

export function getAppPassword(): string {
  return load<string>(KEY, '');
}

export function setAppPassword(pw: string): void {
  save(KEY, pw);
}

export function clearAppPassword(): void {
  remove(KEY);
}

/** Spread into fetch() headers — empty object once no password is stored. */
export function authHeaders(): Record<string, string> {
  const pw = getAppPassword();
  return pw ? { 'X-App-Password': pw } : {};
}

/** For EventSource, which can't set custom headers — appends ?pw=. */
export function withAuthQuery(url: string): string {
  const pw = getAppPassword();
  if (!pw) return url;
  return url + (url.includes('?') ? '&' : '?') + `pw=${encodeURIComponent(pw)}`;
}
