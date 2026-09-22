# ==============================================================================
# Stage 1: Build static documentation assets
# ==============================================================================
FROM node:22-bookworm-slim AS builder

# Set pnpm home directory
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install pnpm matching repo version (pnpm@11.25.0)
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

WORKDIR /app

# Copy root manifests and workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy all package manifests across workspace for lockfile integrity
COPY src/packages/components/package.json ./src/packages/components/
COPY src/apps/tendril-docs/package.json ./src/apps/tendril-docs/
COPY src/apps/tendril-app/package.json ./src/apps/tendril-app/
COPY src/extensions/vscode/package.json ./src/extensions/vscode/

# Install dependencies ONLY for tendril-docs and its workspace dependencies
# --ignore-scripts prevents pre-install hooks from running before sources are copied
RUN pnpm --filter @ivy-interactive/tendril-docs... install --frozen-lockfile --ignore-scripts

# Copy scripts and package sources required for building
COPY src/scripts ./src/scripts
COPY src/packages/components ./src/packages/components
COPY src/apps/tendril-docs ./src/apps/tendril-docs

# Build shared components package
RUN pnpm --filter @ivy-interactive/components build

# Build static documentation site
RUN pnpm --filter @ivy-interactive/tendril-docs build

# ==============================================================================
# Stage 2: Production web server (Caddy Alpine)
# ==============================================================================
FROM caddy:2-alpine AS runner

# Sliplane default port convention
ENV PORT=3000
EXPOSE 3000
EXPOSE 80

# Copy production Caddyfile
COPY src/apps/tendril-docs/Caddyfile /etc/caddy/Caddyfile

# Copy pre-rendered static assets and SPA shells from builder
COPY --from=builder /app/src/apps/tendril-docs/dist /usr/share/caddy

# Run Caddy
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
