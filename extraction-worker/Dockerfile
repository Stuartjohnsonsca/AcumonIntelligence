FROM node:20-slim

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install root-level Prisma (pinned to match main project)
COPY prisma/ ./prisma/
RUN npm init -y && npm install @prisma/client@5.22.0 prisma@5.22.0
RUN npx prisma generate --schema=./prisma/schema.prisma

# Install worker dependencies
COPY extraction-worker/package.json ./extraction-worker/
WORKDIR /app/extraction-worker
RUN npm install

# Copy worker source
COPY extraction-worker/src/ ./src/

# Compile TypeScript
RUN npx tsc --outDir dist --esModuleInterop --skipLibCheck --module commonjs --target ES2022 --moduleResolution node --resolveJsonModule src/index.ts src/xero-pipeline.ts

# NODE_PATH ensures @prisma/client resolves from /app/node_modules (where it was generated)
ENV NODE_PATH=/app/node_modules

CMD ["node", "dist/index.js"]
