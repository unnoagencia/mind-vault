import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { MindVaultMCP } from './mcp/agent.js';
import { authHandler } from './auth/handler.js';

export { MindVaultMCP };

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: MindVaultMCP.serve('/mcp') as any,
  defaultHandler: authHandler as any,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  accessTokenTTL: 86400,
});
