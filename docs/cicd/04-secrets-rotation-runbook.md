# 04, Secrets rotation runbook

> How to rotate environment secrets without downtime.

## Scope

Any secret in `apps/<name>/.env.staging` or `apps/<name>/.env.production`
on the deploy host. Excludes the smart-contract / on-chain key material
(handled separately per docs/21).

## Rotation flow

The slot-swap deploy model gives us a free dry-run for new secrets:
they're picked up on the *next* deploy without a separate restart.

### 1. Add the new secret beside the old

In your secret store (1Password / Vault / `pass`), add:

```
AIVA_SMS_API_KEY_NEW = <new-value>
```

Do **not** remove `AIVA_SMS_API_KEY` yet.

### 2. Update the app to dual-read

In code, read the new key first, fall back to the old:

```ts
const apiKey = process.env.AIVA_SMS_API_KEY_NEW ?? process.env.AIVA_SMS_API_KEY;
if (!apiKey) throw new Error('missing AIVA_SMS_API_KEY[_NEW]');
```

Ship this through the pipeline. Both keys are valid simultaneously.

### 3. Rotate the secret store value

Once the dual-read code is in prod:

1. Update `AIVA_SMS_API_KEY` to the new value in your store.
2. The next deploy reads it and propagates to the env file.
3. Validate with a smoke test that hits the secret-using path.

### 4. Remove the dual-read

After 24h of clean prod logs:

1. Remove the `_NEW` env var from secret store and env files.
2. Revert the code to single-read.
3. Ship.

## Emergency rotation (key compromised)

When a key has leaked publicly:

1. Set the incident flag (see 03 runbook).
2. Rotate the secret in your provider (e.g. Aiva SMS, Stripe) **first** -
   invalidate the old key.
3. Update the env file on the deploy host directly:
   ```bash
   ssh deploy@<host>
   sudo $EDITOR /opt/vtorn/apps/<name>/.env.production
   pm2 reload vtorn-<name>-prod --update-env
   ```
4. Verify the app is healthy.
5. Push the rotation through git (so future deploys carry it).
6. Clear the incident flag.

This bypasses the pipeline because every minute matters during a leak.
Note the override in the post-mortem.

## What lives where

| Class                      | Stored in              | Loaded by                  |
| -------------------------- | ---------------------- | -------------------------- |
| Per-app HTTP service keys  | `.env.<env>` on host   | PM2 env_file               |
| GitHub Actions secrets     | GH org/repo settings   | Workflow `secrets.X`       |
| Cloudflare API token       | `cf-api-token` file    | infra/scripts/cf-*.sh      |
| Database password          | `.env.<env>` on host   | services + db-up.sh        |
| Smart contract signer key  | external KMS (TBD)     | apps/onchain-pool (TBD)    |

## Rule of thumb

- Secrets are per-env, never copied between envs.
- Rotation always staged through the pipeline unless emergency.
- Every rotation event lands a session note: who, what, why, when.

## Related docs

- [docs/25-keys-and-secrets-required.md](../25-keys-and-secrets-required.md)
 , the canonical list of secrets per app.
- [docs/33-security-hardening-checklist.md](../33-security-hardening-checklist.md)
 , broader security posture.
