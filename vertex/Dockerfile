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
RUN npm run build && npm prune --omit=dev


FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma

USER node
EXPOSE 3000

# The schema is owned by the backend's Alembic migrations; this container
# never runs `prisma migrate`.
CMD ["npm", "run", "start"]

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1
