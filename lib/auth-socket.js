import { decode } from 'next-auth/jwt';

// Auth.js cookie names (plain over http, __Secure- prefixed over https).
const COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'];

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Large sessions are split across `<name>.0`, `<name>.1`, … chunks.
function readCookie(cookies, name) {
  if (cookies[name]) return cookies[name];
  const chunks = Object.keys(cookies)
    .filter((k) => k.startsWith(`${name}.`))
    .sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));
  return chunks.length ? chunks.map((k) => cookies[k]).join('') : null;
}

// Reads the signed-in user straight from the handshake cookie, so a client
// cannot claim someone else's name or Google account.
// Returns null for guests / unauthenticated sockets.
export async function verifySocketUser(handshake) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const cookies = parseCookies(handshake?.headers?.cookie || '');
  for (const name of COOKIE_NAMES) {
    const raw = readCookie(cookies, name);
    if (!raw) continue;
    try {
      const token = await decode({ token: raw, secret, salt: name });
      // gid is stamped from Google's account id at sign-in (see auth.js). A
      // token without it predates that and cannot be tied to a stable
      // account, so it is treated as no session at all.
      if (token?.gid) {
        return {
          id: String(token.gid),
          name: token.name || token.email?.split('@')[0] || 'Player',
          email: token.email || null,
          image: token.picture || null,
        };
      }
    } catch {
      // Wrong cookie variant or stale token — try the next one.
    }
  }
  return null;
}
