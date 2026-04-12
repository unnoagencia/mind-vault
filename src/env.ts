export interface Env {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  OWNER_EMAIL?: string;
  OWNER_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  OAUTH_KV: KVNamespace;
  MCP_OBJECT: DurableObjectNamespace;
}

export interface AuthContext extends Record<string, unknown> {
  email: string;
  loggedInAt: number;
}
