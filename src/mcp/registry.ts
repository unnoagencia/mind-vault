import type { Env } from '../env.js';
import { registerSaveNote } from './tools/save-note.js';
import { registerRecall } from './tools/recall.js';
import { registerExpand } from './tools/expand.js';
import { registerGetNote } from './tools/get-note.js';
import { registerLink } from './tools/link.js';

export function registerAllTools(server: any, env: Env): void {
  registerSaveNote(server, env);
  registerRecall(server, env);
  registerExpand(server, env);
  registerGetNote(server, env);
  registerLink(server, env);
}
