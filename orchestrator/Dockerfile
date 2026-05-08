# Acumon orchestrator — Node + Playwright + Chromium.
# Built on Microsoft's official Playwright image so Chromium and all
# its system dependencies are pre-installed and version-pinned.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install dependencies first so we cache the layer.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Run as non-root.
RUN useradd -m -d /home/app appuser && chown -R appuser:appuser /app
USER appuser

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]
