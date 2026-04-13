import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from './session.js';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef';

describe('session cookie', () => {
  it('round-trips an email', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    const result = await verifySession(token, SECRET, 1712990000 + 60);
    expect(result).toEqual({ email: 'robson@example.com', issuedAt: 1712990000 });
  });

  it('rejects a tampered token', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    const [e, i, _sig] = token.split('.');
    const tampered = `${e}.${i}.ZmFrZXNpZw`;
    expect(await verifySession(tampered, SECRET, 1712990000 + 60)).toBeNull();
  });

  it('rejects an expired token (> 7d)', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    const eightDaysLater = 1712990000 + 8 * 86400;
    expect(await verifySession(token, SECRET, eightDaysLater)).toBeNull();
  });

  it('rejects a wrong secret', async () => {
    const token = await signSession('robson@example.com', SECRET, 1712990000);
    expect(await verifySession(token, 'other-secret', 1712990000 + 60)).toBeNull();
  });
});
