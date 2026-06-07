#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# register.sh: one-shot operator registration for the Tournamental Open Bot
# Arena federated network.
#
# Runs `tournamental-bot-node register` against the central API, then writes
# the returned operator credentials to ~/.tournamental/operator.json so the
# PM2 runtime can read them on every restart.
#
# Idempotent: if a credentials file already exists, the script prints the
# stored node_id and exits 0 without calling the API again. To force a
# re-register, delete the credentials file first.
# -----------------------------------------------------------------------------
set -euo pipefail

# Find the app root (this script lives in apps/operator-swarm/scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source .env if present so the operator does not have to export by hand.
if [[ -f "${APP_DIR}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${APP_DIR}/.env"
  set +a
fi

: "${TOURNAMENTAL_API_BASE_URL:?Set TOURNAMENTAL_API_BASE_URL in .env}"
: "${OPERATOR_EMAIL:?Set OPERATOR_EMAIL in .env}"
: "${OPERATOR_NODE_LABEL:?Set OPERATOR_NODE_LABEL in .env}"

# Resolve the credentials path with tilde expansion.
CREDS_RAW="${OPERATOR_CREDENTIALS_PATH:-${HOME}/.tournamental/operator.json}"
CREDS_PATH="${CREDS_RAW/#\~/${HOME}}"
CREDS_DIR="$(dirname "${CREDS_PATH}")"

mkdir -p "${CREDS_DIR}"
chmod 700 "${CREDS_DIR}" || true

if [[ -s "${CREDS_PATH}" ]]; then
  echo "[register] credentials already present at ${CREDS_PATH}"
  if command -v jq >/dev/null 2>&1; then
    NODE_ID="$(jq -r '.node_id // empty' "${CREDS_PATH}")"
    if [[ -n "${NODE_ID}" ]]; then
      echo "[register] node_id=${NODE_ID}"
    fi
  fi
  echo "[register] delete ${CREDS_PATH} and rerun to force re-registration"
  exit 0
fi

# Confirm the CLI from @tournamental/bot-node is on PATH (pnpm exec is the
# resilient option because the binary is hoisted into node_modules/.bin).
if ! command -v tournamental-bot-node >/dev/null 2>&1; then
  echo "[register] tournamental-bot-node not on PATH, falling back to pnpm exec"
  RUNNER=(pnpm --filter @tournamental/operator-swarm exec tournamental-bot-node)
else
  RUNNER=(tournamental-bot-node)
fi

echo "[register] registering node label=${OPERATOR_NODE_LABEL} email=${OPERATOR_EMAIL}"
echo "[register] api=${TOURNAMENTAL_API_BASE_URL}"

# The bot-node CLI writes credentials to stdout as JSON. Capture, validate,
# and persist atomically so a crash mid-write does not leave a half file.
TMP_FILE="$(mktemp)"
trap 'rm -f "${TMP_FILE}"' EXIT

"${RUNNER[@]}" register \
  --email="${OPERATOR_EMAIL}" \
  --label="${OPERATOR_NODE_LABEL}" \
  --api-base-url="${TOURNAMENTAL_API_BASE_URL}" \
  >"${TMP_FILE}"

# Basic sanity check: must be non-empty JSON with a node_id.
if ! command -v jq >/dev/null 2>&1; then
  echo "[register] WARNING: jq not installed, skipping JSON validation"
else
  if ! jq -e '.node_id' "${TMP_FILE}" >/dev/null; then
    echo "[register] ERROR: bot-node did not return a node_id"
    cat "${TMP_FILE}" >&2
    exit 1
  fi
fi

mv "${TMP_FILE}" "${CREDS_PATH}"
trap - EXIT
chmod 600 "${CREDS_PATH}"

echo "[register] OK, credentials written to ${CREDS_PATH}"
echo "[register] next: pnpm --filter @tournamental/operator-swarm run start"
