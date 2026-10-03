# syntax=docker/dockerfile:1
# Targets:
#   (default)  runtime  the app: compiled server + web, production dependencies only
#   migrate             one-shot: applies database migrations, then exits (needs the Prisma CLI)

# ── Build: install everything, generate the Prisma client, compile server + web ──
FROM node:26-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
COPY server/package.json server/
COPY web/package.json web/
# The npm cache persists across builds (BuildKit cache mount): faster rebuilds, resumable downloads.
RUN --mount=type=cache,target=/root/.npm npm ci
COPY server server
COPY web web
RUN npm run build -w server && npm run build -w web

# ── Migrate: the full toolchain, run once per deployment before the app starts ──
FROM build AS migrate
USER node
WORKDIR /app/server
CMD ["node", "/app/node_modules/prisma/build/index.js", "migrate", "deploy"]

# ── Production dependencies of the server (from the npm cache: no second download) ──
# @prisma/client lists the Prisma CLI and TypeScript as optional peers; as they are also dev
# dependencies, npm marks them "devOptional" and keeps them unless both dev AND optional packages
# are omitted (~250 MB). The server needs no optional package at runtime (the smoke test checks).
FROM build AS prod-deps
RUN --mount=type=cache,target=/root/.npm rm -rf node_modules server/node_modules web/node_modules \
 && npm ci --omit=dev --omit=optional --omit=peer -w server --include-workspace-root=false --prefer-offline \
 && mkdir -p server/node_modules

# ── Runtime ──
FROM node:26-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/server/public
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/server/node_modules server/node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist server/public
USER node
WORKDIR /app/server
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/index.js"]
