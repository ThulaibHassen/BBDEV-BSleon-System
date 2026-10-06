# Production image — used by Railway and by `docker compose --profile app up`.
# Multi-stage: deps → build → a slim runtime holding only the standalone server.

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
# the standalone server, static assets and public files
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# migrations + the migrate/seed scripts run as Railway's pre-deploy step
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/scripts/dist ./scripts
# the local-disk storage driver (used only when no bucket keys are set) writes
# under ./.storage; /app itself belongs to root, so create it for the app user
RUN mkdir -p .storage && chown app:app .storage
USER app
EXPOSE 3000
# On every start: apply pending migrations, run the idempotent seed, then serve.
# Done here rather than in a platform pre-deploy hook, so a fresh database is
# always ready before the first request, wherever the image runs.
CMD ["/bin/sh", "-c", "node scripts/migrate.js && node scripts/seed.js && exec node server.js"]
