# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install production deps only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app

# Security: run as non-root user
RUN addgroup -S x402 && adduser -S x402 -G x402

# Copy only what is needed at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=x402:x402 server.js ./
COPY --chown=x402:x402 routes/ ./routes/
COPY --chown=x402:x402 lib/ ./lib/
COPY --chown=x402:x402 schemas/ ./schemas/
COPY --chown=x402:x402 openapi.json ./
COPY --chown=x402:x402 dashboard.html ./
COPY --chown=x402:x402 erc8004.js ./
COPY --chown=x402:x402 package.json ./

USER x402

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
