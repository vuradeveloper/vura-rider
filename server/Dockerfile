# ────────────────────────────────────────────────────────────
# Vura Rider Backend — Docker (AWS Beanstalk / Cloud Run)
# Build stage: compile TypeScript
# ────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install ALL dependencies (including dev for TypeScript compilation)
COPY package.json package-lock.json ./
RUN npm ci

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

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Install only production dependencies fresh (no devDeps)
RUN npm ci --omit=dev

# AWS Beanstalk uses PORT 8080 by default
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]