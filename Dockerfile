# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# careOS — multi-stage, non-root image. The same image runs the API and the
# worker (different commands) and can run `prisma migrate deploy`.
# ---------------------------------------------------------------------------

FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system careos && useradd --system --gid careos --home /app careos

# Production dependencies only, then generated Prisma client + CLI for migrate.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/prisma ./node_modules/prisma

COPY --from=build /app/dist ./dist
COPY prisma ./prisma

USER careos
EXPOSE 3000
# Override CMD for the worker: node dist/worker.js
CMD ["node", "dist/main.js"]