/** A logger that keeps every line as `LEVEL message`, for asserting on logs. */

import { type Logger } from "../../src/core/ports/logger";

export function recordingLogger(lines: string[]): Logger {
  const logger: Logger = {
    debug: (message) => void lines.push(`DEBUG ${message}`),
    info: (message) => void lines.push(`INFO ${message}`),
    warn: (message) => void lines.push(`WARNING ${message}`),
    error: (message) => void lines.push(`ERROR ${message}`),
    child: () => logger,
  };
  return logger;
}
