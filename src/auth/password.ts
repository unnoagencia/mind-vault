import { argon2id, argon2Verify } from 'hash-wasm';

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({
    password: plain,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 19456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: plain, hash: stored });
  } catch { return false; }
}
