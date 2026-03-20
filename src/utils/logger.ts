const PREFIX = "[mcp-gsc]";

export const log = {
  info: (...args: unknown[]) => console.error(PREFIX, ...args),
  warn: (...args: unknown[]) => console.error(PREFIX, "WARN", ...args),
  error: (...args: unknown[]) => console.error(PREFIX, "ERROR", ...args),
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) console.error(PREFIX, "DEBUG", ...args);
  },
};
