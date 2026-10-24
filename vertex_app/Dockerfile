# Flutter web build served by nginx.
# The SDK is cloned at the exact version used locally (no maintained image
# carries it); the layer is cached, so only the first build pays for it.

FROM debian:bookworm-slim AS build

ARG FLUTTER_VERSION=3.47.2

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl git unzip xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /flutter
ENV PATH="/flutter/bin:${PATH}"
RUN flutter config --no-analytics --enable-web && flutter precache --web

WORKDIR /src
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get

COPY . .
RUN flutter build web --release


FROM nginx:1.31-alpine
# Current Alpine security fixes (OpenSSL and others; Trivy, Phase 12).
RUN apk upgrade --no-cache

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/build/web /usr/share/nginx/html

# Rendered into /config.json at container start (see nginx.conf.template).
ENV API_BASE_URL=http://localhost:8001/api/v1 \
    AUTH_BASE_URL=http://localhost:3001 \
    APP_ENV=development

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=6 \
    CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
