# ────────────────────────────────────────────────────────────
# Vura Rider Backend — Google Cloud Run
# Build stage: compile TypeScript
# ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy source + TypeScript config
COPY tsconfig.json ./
COPY src/ src/

# Compile
RUN npx tsc && rm -rf src

# ────────────────────────────────────────────────────────────
# Run stage: minimal image
# ────────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Copy compiled output + prod deps from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Cloud Run provides PORT env var (usually 8080)
EXPOSE ${PORT:-8080}

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8080}/health || exit 1

# Use --env-file to pass .env on local runs; Cloud Run injects env vars natively
CMD ["node", "dist/index.js"]