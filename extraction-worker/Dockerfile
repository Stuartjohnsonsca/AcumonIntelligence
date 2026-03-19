FROM node:20-slim

WORKDIR /app

# Copy root-level shared files
COPY prisma/ ./prisma/
COPY lib/ ./lib/

# Copy worker files
COPY extraction-worker/package*.json ./extraction-worker/
COPY extraction-worker/tsconfig.json ./extraction-worker/
COPY extraction-worker/src/ ./extraction-worker/src/

# Install dependencies
WORKDIR /app/extraction-worker
RUN npm ci --production=false

# Generate Prisma client
RUN npx prisma generate --schema=../prisma/schema.prisma

# Build TypeScript
RUN npx tsc

# Run the worker
CMD ["node", "dist/index.js"]
