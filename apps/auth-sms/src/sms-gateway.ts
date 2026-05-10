/**
 * Aiva SMS gateway client — re-export shim.
 *
 * The canonical implementation now lives in `@vtorn/aiva-client` so multiple
 * Tournamental services (auth-sms, push-notifications, future crm-bridge and
 * tournament-bot) share one client, one env contract, one set of tests.
 *
 * This file preserves the import path that auth-sms internals + tests already
 * use (`./sms-gateway.js`). Removing it would be a breaking refactor of the
 * service for no functional gain.
 */

export {
  AivaSmsClient,
  StubSmsClient,
  aivaSmsConfigFromEnv,
  type AivaSmsConfig,
  type SendSmsRequest,
  type SendSmsResult,
  type SmsSender,
} from '@vtorn/aiva-client';
