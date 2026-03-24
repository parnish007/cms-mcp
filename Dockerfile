# ─── Stage 1: Build ───────────────────────────────────────────────────────────
# Use Alpine-based Node for minimal final image size (<50 MB).
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (layer cache: only invalidated when package files change)
COPY package*.json ./
RUN npm ci

# Compile TypeScript
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Prune to production deps only (removes tsx, typescript, @types/*)
RUN npm ci --omit=dev

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine

# Install dumb-init for proper PID 1 signal handling
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy production deps + compiled output from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
COPY package.json ./

# Run as non-root user (built into node:alpine image)
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "build/index.js"]
