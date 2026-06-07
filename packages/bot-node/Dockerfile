# syntax=docker/dockerfile:1.6
#
# Tournamental Bot Node - operator-facing federated node.
#
# Build:
#   docker build -t tournamental/bot-node:0.1.0 .
# Run (one-shot demo):
#   docker run --rm tournamental/bot-node:0.1.0 \
#     tournamental-bot-node --bots=1000 --dry-run
# Run (persistent operator deployment):
#   docker run -d --name bot-node \
#     -v $(pwd)/data:/app/data \
#     -e TOURNAMENTAL_CENTRAL_URL=https://api.tournamental.com \
#     -p 4080:4080 \
#     tournamental/bot-node:0.1.0 \
#     tournamental-bot-node serve

FROM node:20-bookworm-slim AS builder
WORKDIR /build
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json tsup.config.ts tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV TOURNAMENTAL_NODE_DB=/app/data/bot-node.db
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 botnode \
    && mkdir -p /app/data \
    && chown -R botnode:botnode /app
COPY --from=builder --chown=botnode:botnode /build/node_modules ./node_modules
COPY --from=builder --chown=botnode:botnode /build/dist ./dist
COPY --from=builder --chown=botnode:botnode /build/package.json ./package.json
USER botnode
EXPOSE 4080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4080/health || exit 1
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["--help"]
