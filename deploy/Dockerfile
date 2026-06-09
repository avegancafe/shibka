# Dockerfile — Shibka production image (built natively on the arm64 box).
#
# Build context is the repo ROOT (this file lives in deploy/), so the image gets
# the static game (index.html, css/, js/, vendor/, assets/) AND the server/. The
# Node app serves the static game from the repo root and the JSON API from /api.
#
# Unlike the schedule app, Shibka has NO native modules (pg is pure JS, password
# hashing uses Node's built-in scrypt) and NO build step — so plain alpine is
# fine and small. State lives in Neon, so there's no volume to mount.

ARG NODE_VERSION=22

# ---- deps: install server dependencies (cached unless package*.json change) --
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- runner: minimal production image ----------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Non-root user.
RUN addgroup -S nodejs -g 1001 && adduser -S nodejs -u 1001 -G nodejs

# App source (static game at the root + server/). node_modules is excluded by
# .dockerignore, so the host's copy never leaks in; we add the clean deps next.
COPY --chown=nodejs:nodejs . .
COPY --from=deps --chown=nodejs:nodejs /app/server/node_modules ./server/node_modules

USER nodejs
EXPOSE 3000

# In-container health check (the alpine base has no curl/wget; node has fetch).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
# Run the idempotent migration, then start the server. Safe on every boot.
CMD ["sh", "-c", "node migrate.js && node server.js"]
