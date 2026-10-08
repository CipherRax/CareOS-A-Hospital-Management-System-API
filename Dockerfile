# careOS web — production image.
#
# Two stages: dependencies are installed once on the full toolchain, then only
# the self-contained standalone bundle (src/lib/env.ts, next.config.ts
# `output: 'standalone'`, ADR-008) is copied into a slim runtime image. The
# runtime image holds no sources, no dev dependencies and no .net cache needed
# to build again.
#
# Build (from the repo root):
#   docker build -t careos-web .
#
# Run (see docs/deployment.md):
#   docker run --rm -p 3000:3000 \
#     -e API_INTERNAL_URL=https://api.careos.example \
#     careos-web

# --- Build stage ---------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app

# Install first, on the lockfile alone, so the layer cache survives source edits.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# A sandbox `.env` never reaches the image (.dockerignore), so mocks default
# off anyway; pin the flag anyway so the build is independent of the host.
RUN NEXT_PUBLIC_ENABLE_MOCKS=false npm run build

# --- Runtime stage -------------------------------------------------------------

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Non-root: the process handles sessions and must not run as root on the box.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# postbuild already copied `.next/static` and `public` inside the standalone
# bundle (scripts/copy-standalone-assets.mjs), so the whole directory ships.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]