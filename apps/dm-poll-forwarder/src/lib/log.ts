/**
 * Tiny logger interface so tests can inject a silent logger and the
 * Fastify-bound logger is used at runtime. Mirrors apps/dm-otp.
 */

export interface Logger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
