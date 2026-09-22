# The docs site as a container: build the static site, serve it with Caddy.
#
# Build from the repository root - the site depends on the components workspace package:
#
#   docker build -f src/apps/tendril-docs/Dockerfile -t tendril-docs .
#   docker run --rm -p 8080:8080 tendril-docs     # http://localhost:8080/docs/
#
# On Sliplane: Dockerfile path `src/apps/tendril-docs/Dockerfile`, context `.`, health check `/healthz`.

FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

WORKDIR /repo

# Manifests first, so the dependency layer is reused until one of them changes. Every workspace
# package's manifest is needed for the frozen lockfile to resolve, even the ones not built here.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY src/packages/components/package.json src/packages/components/
COPY src/apps/tendril-docs/package.json src/apps/tendril-docs/
COPY src/apps/tendril-app/package.json src/apps/tendril-app/
COPY src/extensions/vscode/package.json src/extensions/vscode/

# Only the docs site and what it depends on. --ignore-scripts because the components package's
# `prepare` runs a Windows-only patch from sources that are not copied in yet, and nothing the
# docs build needs has an install script.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter "@ivy-interactive/tendril-docs..." install --frozen-lockfile --ignore-scripts

COPY src/scripts src/scripts
COPY src/packages/components src/packages/components
COPY src/apps/tendril-docs src/apps/tendril-docs

RUN pnpm --filter @ivy-interactive/components build \
 && pnpm --filter @ivy-interactive/tendril-docs build


FROM caddy:2-alpine

# The site is built with base `/docs/`, so it is served from /srv/docs.
COPY src/apps/tendril-docs/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/src/apps/tendril-docs/dist /srv/docs

EXPOSE 8080
