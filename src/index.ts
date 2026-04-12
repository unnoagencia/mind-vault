import type { Env } from './env.js';

export default {
  async fetch(_req: Request, _env: Env): Promise<Response> {
    return new Response('Mind Vault booting', { status: 200 });
  },
};
