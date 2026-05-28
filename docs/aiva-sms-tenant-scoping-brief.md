# Aiva-SMS gateway: tenant-scoped API keys + Tournamental SIM enrolment

> **Brief for the Aiva-SMS agent.** Tournamental is one consumer of the
> gateway at `localhost:9252` / `sms-api.aiva.nz`. We hit two problems
> that need fixing on the gateway side before Tournamental can safely
> send SMS in production. This doc states the bug, what we observe from
> the consumer side, the required gateway behaviour, and the contract
> we need exposed so Tournamental can verify the fix.

## Bug 1: API keys are not tenant-scoped

### Symptom

The API key Tim provisioned for Tournamental
(`ed30d424-89ed-4932-a66e-58e3d32e2089`) can:

- Send SMS via the **SDEAL** SIM (device `69c8e893ecdd1f940e903258`,
  tenant `6a0aa04f1ffd3870278ce5b0`).
- Send SMS via the **MyFurbaby** SIM (device `69ba741ee28f39167aa7fe72`,
  tenant `69ba7273e28f39167aa7fd79`).
- Send SMS via any other device that gets added to any tenant under
  Tim's account in the future.

This is the wrong blast radius. If `apps/auth-sms/.env` or
`apps/web/.env.production` leaks, an attacker can impersonate any of
Tim's brands by sending SMS from their SIMs.

### Reproduction

```bash
KEY=ed30d424-89ed-4932-a66e-58e3d32e2089

# Lists devices for EVERY tenant Tim owns, not just the calling tenant
curl -sH "x-api-key: $KEY" http://localhost:9252/api/v1/gateway/devices

# Returns role=ADMIN, name="Tim Thomas", cross-tenant visibility
curl -sH "x-api-key: $KEY" http://localhost:9252/api/v1/auth/who-am-i

# Successfully sends from a device under a tenant the caller has no
# legitimate need to access
curl -sX POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  http://localhost:9252/api/v1/gateway/devices/<any-device-id>/send-sms \
  -d '{"recipients":["+64..."],"message":"could-be-anyone"}'
```

### Root cause (consumer-side hypothesis)

`/v1/auth/who-am-i` returns `role: "ADMIN"` for every API key minted so
far. There appears to be no `role: "TENANT"` variant, no `tenantId`
binding on the key record, and no per-request authorisation check that
the resolved key's tenant matches the device's tenant.

### Required gateway behaviour

1. **API keys must carry a `tenantId`.** The key record / table should
   look something like:
   ```ts
   ApiKey {
     id: string;
     hashedKey: string;
     role: "ADMIN" | "TENANT";
     tenantId: string | null;   // required when role = "TENANT"
     scopes?: string[];         // optional finer-grained ("sms.send", "whatsapp.send", "devices.read")
     name: string;              // human label, e.g. "Tournamental production"
     createdAt: number;
     lastUsedAt: number | null;
     revokedAt: number | null;
   }
   ```
2. **Every send / list / read endpoint must enforce tenant boundary.**
   For role=TENANT keys:
   - `GET /api/v1/gateway/devices` returns only devices where
     `device.tenantId == key.tenantId`.
   - `POST /api/v1/gateway/devices/<deviceId>/send-sms` returns 403
     when `device.tenantId != key.tenantId` (instead of the current
     200 — silent cross-tenant send is the worst-case failure mode).
   - `POST /api/v1/whatsapp/sessions/<sessionId>/send` same: 403
     when the session's owning tenant differs.
   - `GET /api/v1/whatsapp/sessions` filtered the same way.
3. **`/api/v1/auth/who-am-i` returns the tenant binding** so consumers
   can verify their key on boot:
   ```json
   { "role": "TENANT", "tenantId": "<tt-id>", "tenantName": "Tournamental",
     "scopes": ["sms.send","whatsapp.send","devices.read"] }
   ```
4. **Admin keys keep current behaviour.** Tim's master ADMIN key
   continues to see everything; we only need new TENANT keys minted
   per consumer.

### Out of scope (nice-to-have, can defer)

- Per-IP allow-list on the key
- Per-key rate limiting
- Key rotation / expiry
- A `/api/v1/api-keys` management endpoint (currently 404)

## Bug 2: The Tournamental SIM isn't enrolled as a device

### Symptom

Tournamental's phone number is `+64204259096`. The gateway's device
list (under Tim's account) returns only two devices, both on different
SIMs / tenants:

- `samsung Phone 1` → MyFurbaby SIM `+64204259191`
- `SM-S918B` → SDEAL SIM `+64204259069`

No device matches the Tournamental SIM. So Tournamental can't send SMS
at all without going through one of the other brands' SIMs — which is
the wrong outcome even before Bug 1 is fixed.

### Required action

1. Pair the Tournamental phone (the one with SIM `+64204259096`) as
   a new device through the Aiva agent Android app.
2. Create a new tenant in the gateway: `Tournamental`.
3. Bind the newly paired device to that tenant.
4. Mint a TENANT-scoped API key for the Tournamental tenant (once
   Bug 1 is fixed).
5. Bind the existing Tournamental WhatsApp session
   (`wa-69897af7bfdfd4aa035bf69a-1778486777235`) to the same tenant so
   the same key can call both `/send-sms` and `/whatsapp/...send`.

## Bug 3: SIM phone numbers are masked in the device list

`device.simInfo.sims[].number` comes back as `null` on every device:

```json
"simInfo": {
  "sims": [
    { "subscriptionId": 9, "carrierName": "Skinny", "displayName": "Skinny", "number": null },
    { "subscriptionId": 7, "carrierName": "One NZ", "displayName": "One NZ", "number": null }
  ]
}
```

This means consumers have no way to verify which device backs which
phone number — the only way we found out the wrong SIM was sending was
by Tim receiving the SMS and reading the From: number.

**Required**: populate `device.simInfo.sims[].number` (or a
`device.primaryNumber` field at the device level) so consumers can
assert "this device is the +64204259096 SIM" before sending. This is
also load-bearing for the audit log — without the number we can't
prove which SIM dispatched a given message.

## Contract Tournamental needs back

When the three bugs are fixed, hand back to Tim:

1. **Tournamental tenant id** (so it can be referenced in audit logs).
2. **Tournamental device id** for the +64204259096 SIM (we'll set
   `AIVA_SMS_DEVICE_ID` to this in `apps/auth-sms/.env`).
3. **Tournamental tenant API key** (we'll replace
   `AIVA_SMS_API_KEY` in `apps/auth-sms/.env` and
   `apps/web/.env.production`).
4. **Tournamental WhatsApp session id**, if it's being re-issued —
   otherwise keep the existing `wa-69897af7bfdfd4aa035bf69a-1778486777235`.

Tim's verification on the Tournamental side will be:

```bash
KEY=<new-tenant-key>

# Should return role=TENANT, tenantId set, tenantName=Tournamental
curl -sH "x-api-key: $KEY" https://sms-api.aiva.nz/api/v1/auth/who-am-i

# Should return exactly ONE device — the Tournamental SIM — with
# simInfo.sims[].number == "+64204259096"
curl -sH "x-api-key: $KEY" https://sms-api.aiva.nz/api/v1/gateway/devices

# Should 403 because this device belongs to the SDEAL tenant
curl -isX POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  https://sms-api.aiva.nz/api/v1/gateway/devices/69c8e893ecdd1f940e903258/send-sms \
  -d '{"recipients":["+6421535832"],"message":"should-403"}'

# Should 200 and deliver from the +64204259096 SIM
curl -isX POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  https://sms-api.aiva.nz/api/v1/gateway/devices/<tournamental-device-id>/send-sms \
  -d '{"recipients":["+6421535832"],"message":"hello from Tournamental"}'

# Same on WhatsApp
curl -isX POST -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  https://sms-api.aiva.nz/api/v1/whatsapp/sessions/<tt-wa-session-id>/send \
  -d '{"phone":"6421535832","message":"hello from Tournamental WA"}'
```

All four should pass before Tim closes the loop.

## What Tournamental will do once the contract is delivered

1. Update `apps/auth-sms/.env`:
   ```
   AIVA_SMS_API_KEY=<new-tenant-key>
   AIVA_SMS_DEVICE_ID=<new-device-id>
   AIVA_WA_SESSION_ID=<if changed>
   ```
2. Restart `vtorn-auth-sms` via its ecosystem.
3. Run a single warm-invite end-to-end test against Tim's number
   (`+6421535832`) on `play-dev.tournamental.com` to confirm SMS +
   WhatsApp + email all dispatch from the right Tournamental
   identities.
4. Mirror the same env-var swap in `apps/web/.env.production` so the
   prod web app's CRM helpers stay in step.

The Tournamental side has no other code changes pending on this — the
`x-api-key` header switch is already shipped, the WhatsApp-first then
SMS-fallback in the warm-invite is already shipped. We just need the
correctly-scoped credentials.

---

Last updated 2026-05-28. Owner: Tim. Reviewer: Aiva-SMS agent.
