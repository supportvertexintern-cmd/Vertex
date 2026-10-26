FROM node:22-alpine AS build

# Prisma's engines need OpenSSL on Alpine.
RUN apk add --no-cache openssl

WORKDIR /app

# The Prisma schema must exist before `npm ci`, whose postinstall runs
# `prisma generate`.
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Only production dependencies ship (equivalent to `npm ci --omit=dev`).
# The dev-only ESLint chain's `braces` (exception E1) must not be among them.
RUN npm run build && npm prune --omit=dev  && if [ -e node_modules/braces ]; then echo "E1: braces in the production image" >&2; exit 1; fi


FROM node:22-alpine

# Current Alpine security fixes, and no npm/npx/yarn at runtime: the app
# doesn't need a package manager, and npm's own bundled packages were most
# of the image's findings (Trivy, Phase 12).
# SECURITY_REFRESH (the build date, set by build.yml and ci.yml) makes the
# upgrade below run again each day instead of coming from the layer cache,
# which would keep shipping yesterday's packages (CVE-2026-92392, curl).
ARG SECURITY_REFRESH=
RUN echo "security refresh: ${SECURITY_REFRESH}" && apk upgrade --no-cache && apk add --no-cache openssl \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
           /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/package.json /app/next.config.ts ./
# `next start` compiles next.config.ts again, so every file it imports must
# be here too (next-config-imports.test.ts checks this list).
COPY --from=build /app/src/lib/csp.ts ./src/lib/csp.ts
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma

USER node
EXPOSE 3000

# The schema is owned by the backend's Alembic migrations; this container
# never runs `prisma migrate`.
CMD ["node", "node_modules/next/dist/bin/next", "start"]

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
