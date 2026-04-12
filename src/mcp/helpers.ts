export type ToolResult =
  | { content: Array<{ type: 'text'; text: string }> }
  | { content: Array<{ type: 'text'; text: string }>; isError: true };

export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function toolSuccess(data: unknown): ToolResult {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

export function safeToolHandler<A extends unknown[]>(
  fn: (...args: A) => Promise<ToolResult>
): (...args: A) => Promise<ToolResult> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('D1_ERROR') || msg.includes('SQLITE_ERROR')) {
        console.error('MindVault D1 error:', msg);
        return toolError(
          `Internal error in the vault database (D1). Probably transient — wait a few seconds and try again. ` +
          `If it persists, report the timestamp ${new Date().toISOString()} and the attempted action to the maintainer.`
        );
      }
      console.error('MindVault tool error:', msg);
      return toolError(`Unexpected error: ${msg}. Check the input and try again.`);
    }
  };
}
