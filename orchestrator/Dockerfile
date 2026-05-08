# Acumon orchestrator — Node + Playwright + Chromium.
# Built on Microsoft's official Playwright image so Chromium and all
# its system dependencies are pre-installed and version-pinned.
# The base image already runs as the non-root `pwuser` (UID 1000) which
# is the user permitted to execute the bundled Chromium binary — do
# NOT override with a different user, otherwise chromium.launch() hangs.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Make /app writable by pwuser before we drop privileges.
RUN chown -R pwuser:pwuser /app

# Install dependencies as pwuser so node_modules is owned correctly.
USER pwuser
COPY --chown=pwuser:pwuser package.json ./
RUN npm install --omit=dev

COPY --chown=pwuser:pwuser src ./src

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080
CMD ["node", "src/server.js"]
