# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for better layer caching
COPY package*.json ./

# Install ALL deps (including devDeps for any build steps)
RUN npm ci --prefer-offline

# Copy source
COPY . .

# ── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

# Non-root user for security
RUN addgroup -S botgroup && adduser -S botuser -G botgroup

WORKDIR /app

# Only copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Create logs directory with correct ownership
RUN mkdir -p logs && chown -R botuser:botgroup /app

USER botuser

# Expose the health-check port
EXPOSE 9090

# Health check — polls /health every 30 s
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:9090/health || exit 1

# Default: run sharding manager (override with `node index.js` for dev)
CMD ["node", "shard.js"]
