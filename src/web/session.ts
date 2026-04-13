const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = '='.repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signSession(
  email: string,
  secret: string,
  issuedAt: number
): Promise<string> {
  const e = b64urlEncode(encoder.encode(email));
  const i = b64urlEncode(encoder.encode(String(issuedAt)));
  const sig = await hmac(secret, `${e}.${i}`);
  return `${e}.${i}.${b64urlEncode(sig)}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowSeconds: number
): Promise<{ email: string; issuedAt: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [e, i, s] = parts;
  const expected = await hmac(secret, `${e}.${i}`);
  const got = b64urlDecode(s);
  if (!constantTimeEqual(expected, got)) return null;
  const email = new TextDecoder().decode(b64urlDecode(e));
  const issuedAt = Number(new TextDecoder().decode(b64urlDecode(i)));
  if (!Number.isFinite(issuedAt)) return null;
  if (nowSeconds - issuedAt > SESSION_TTL_SECONDS) return null;
  return { email, issuedAt };
}
