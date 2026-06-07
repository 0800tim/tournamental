# Tournamental Billion Bot - dashboard wrapper around @tournamental/bot-node.
# Self-contained: installs bot-node from a bundled tarball (v0.2.0 strategy
# recalibration) so the container does not depend on a live npm release.
# When 0.2.0 lands on the public npm registry, package.json can switch back
# to "@tournamental/bot-node": "^0.2.0".
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV DASH_PORT=4080
ENV DASH_HOST=0.0.0.0
ENV BOT_NODE_VERSION=0.2.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl python3 make g++ \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 botnode \
    && mkdir -p /app/data \
    && chown -R botnode:botnode /app

COPY --chown=botnode:botnode package.json /app/package.json
COPY --chown=botnode:botnode tournamental-bot-node-0.3.0.tgz /app/tournamental-bot-node-0.3.0.tgz

# Install bot-node CLI from the bundled tarball + better-sqlite3 locally so
# ESM imports resolve from /app. Expose the bot-node CLI on PATH via a
# symlink for convenience.
RUN cd /app \
    && npm install --omit=dev --no-audit --no-fund \
    && ln -s /app/node_modules/.bin/tournamental-bot-node /usr/local/bin/tournamental-bot-node \
    && npm cache clean --force \
    && chown -R botnode:botnode /app

COPY --chown=botnode:botnode dashboard.mjs /app/dashboard.mjs
COPY --chown=botnode:botnode fifa-wc-2026-fixtures.json /app/fifa-wc-2026-fixtures.json
ENV TOURNAMENTAL_MATCHES=/app/fifa-wc-2026-fixtures.json

USER botnode
EXPOSE 4080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4080/health || exit 1

ENTRYPOINT ["node", "/app/dashboard.mjs"]
