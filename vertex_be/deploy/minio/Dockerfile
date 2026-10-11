# MinIO (object storage, S3 API) for the local stacks. The community edition
# is distributed as source only, so this builds the server and the `mc`
# client from pinned release tags. Bump the tags deliberately.
#
# The S3 API is the same one AWS S3 speaks: the app uses the AWS SDK, so
# moving to S3 later is a configuration change (endpoint, keys, bucket).

# Go 1.27: the standard library's own security fixes (Trivy, Phase 12).
ARG GO_VERSION=1.27

FROM golang:${GO_VERSION}-alpine AS build
ARG MINIO_RELEASE=RELEASE.2025-10-15T17-29-55Z
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ENV CGO_ENABLED=0 GOTOOLCHAIN=auto
RUN apk add --no-cache git
WORKDIR /src
# HTTP/1.1 and retries: a slow or flaky link otherwise aborts the clone.
RUN git config --global http.version HTTP/1.1 \
 && fetch() { for i in 1 2 3; do git clone --depth 1 --branch "$2" "https://github.com/minio/$1.git" && return 0; rm -rf "$1"; sleep $((i * 10)); done; return 1; } \
 && fetch minio "${MINIO_RELEASE}" && fetch mc "${MC_RELEASE}"
COPY ldflags.sh /usr/local/bin/ldflags.sh
# The release tags pin dependency versions with known vulnerabilities
# (Trivy, Phase 12: grpc, amqp, thrift, jose, x/crypto, x/net...). Raise
# them to their current releases before building; `go build` fails if an
# update breaks the API, so a bad bump can't ship.
ARG MINIO_DEP_UPDATES="google.golang.org/grpc github.com/rabbitmq/amqp091-go github.com/apache/thrift github.com/buger/jsonparser github.com/go-jose/go-jose/v4 github.com/prometheus/prometheus go.opentelemetry.io/otel/sdk golang.org/x/crypto golang.org/x/net golang.org/x/text"
ARG MC_DEP_UPDATES="google.golang.org/grpc github.com/prometheus/prometheus golang.org/x/crypto golang.org/x/net golang.org/x/text"
RUN cd minio && for m in ${MINIO_DEP_UPDATES}; do go get "$m@latest"; done && go mod tidy
RUN cd mc && for m in ${MC_DEP_UPDATES}; do go get "$m@latest"; done && go mod tidy
RUN cd minio && go build -trimpath -ldflags "$(sh /usr/local/bin/ldflags.sh minio "${MINIO_RELEASE}")" -o /out/minio .
RUN cd mc && go build -trimpath -ldflags "$(sh /usr/local/bin/ldflags.sh mc "${MC_RELEASE}")" -o /out/mc .

FROM alpine:3.22
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates \
 && adduser -D -H -u 1000 minio \
 && mkdir -p /data && chown minio /data
COPY --from=build /out/minio /out/mc /usr/local/bin/
USER minio
EXPOSE 9000
HEALTHCHECK --interval=10s --timeout=5s --retries=12 \
  CMD wget -q --spider http://127.0.0.1:9000/minio/health/live || exit 1
ENTRYPOINT ["minio"]
CMD ["server", "/data"]
