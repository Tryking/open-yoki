// Who is talking in the web room. Everyone comes in as a guest with a nickname (no accounts, no wallets): the server
// hands out a random session token and remembers which guest it belongs to for a day. Tokens are never logged.
import { randomBytes } from 'node:crypto';

export const SESSION_MS = 24 * 3600e3;

export const isGuest = addr => /^guest-/.test(addr || '');

export function createAuth({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  function issue(address) {
    const token = randomBytes(24).toString('hex');
    sessions.set(token, { address, at: now() });
    if (sessions.size > 20000) for (const [t, s] of sessions) if (now() - s.at > SESSION_MS) sessions.delete(t);
    return { token, address };
  }

  function who(token) {
    const s = token && sessions.get(token);
    if (!s || now() - s.at > SESSION_MS) return null;
    return s.address;
  }

  const guest = () => issue('guest-' + randomBytes(5).toString('hex'));

  return { issue, guest, who };
}

export class AuthError extends Error {}
