/**
 * Vitest global setup. Silences pino so the report stays readable. Comment
 * out the LOG_LEVEL line to debug a flaky test locally.
 */
process.env.LOG_LEVEL = 'silent';
