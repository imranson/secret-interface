# syntax=docker/dockerfile:1

# ---- Build ----
FROM node:24-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && rm -rf .next/cache

# ---- Production dependencies only ----
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- Run ----
# A full node_modules rather than Next's standalone output: the calculator tool's worker loads mathjs at run time and
# the embedded database loads its WebAssembly files from its package, neither of which file tracing can see.
FROM node:24-slim AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATA_DIR=/app/data
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.ts ./
# Only used when DATABASE_URL is unset: the embedded database lives here. Mount a volume on it to keep it.
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
# `next start` listens on $PORT, which Railway sets.
CMD ["node_modules/.bin/next", "start"]
