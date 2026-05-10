/**
 * @vtorn/aiva-client
 *
 * Shared Aiva SMS + WhatsApp gateway clients used across Tournamental services.
 *
 * Consumers today: `apps/auth-sms`, `apps/push-notifications`. Likely next:
 * `apps/crm-bridge` (broadcast messages to drip-list subscribers) and
 * `apps/tournament-bot` (fallback delivery when Telegram is unavailable).
 *
 * Env contract (single source of truth across the workspace):
 *   AIVA_SMS_API_URL    base URL, default http://localhost:9252
 *   AIVA_SMS_API_KEY    bearer token for the gateway
 *   AIVA_SMS_DEVICE_ID  Android device UUID (SMS only)
 *   AIVA_WA_SESSION_ID  Baileys session ID on the gateway (WhatsApp only)
 */

export {
  AivaSmsClient,
  StubSmsClient,
  aivaSmsConfigFromEnv,
  type AivaSmsConfig,
  type SendSmsRequest,
  type SendSmsResult,
  type SmsSender,
} from './sms.js';

export {
  AivaWhatsAppClient,
  StubWhatsAppClient,
  aivaWhatsAppConfigFromEnv,
  type AivaWhatsAppConfig,
  type SendWhatsAppRequest,
  type SendWhatsAppResult,
  type WhatsAppSender,
} from './whatsapp.js';
