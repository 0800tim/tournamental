/**
 * Vitest global setup. Silences Fastify/pino logging so the test report
 * stays readable. To debug a flaky test, comment out the `LOG_LEVEL` line
 * locally.
 */
process.env.LOG_LEVEL = 'silent';
