# syntax=docker/dockerfile:1.6

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates tini wget \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system app && useradd --system --gid app --home-dir /app app
COPY --chown=app:app package.json package-lock.json ./
COPY --from=builder --chown=app:app /app/prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder --chown=app:app /app/dist ./dist
USER app
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "start"]
