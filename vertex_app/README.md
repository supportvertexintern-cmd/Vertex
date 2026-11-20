# Vertex Flutter Client

The Flutter application provides mobile and web interfaces for Vertex. It
uses the Next.js service for sign-in and FastAPI for application API requests.
Some routes are placeholders and some client data stores remain local/mock
implementations; check the relevant feature before assuming it is fully
connected to the backend.

## Development

From this directory, install dependencies and run the app on a configured
Flutter device or emulator:

```bash
flutter pub get
flutter run
```

By default, local development uses the web service at
`http://localhost:3001` for authentication and the FastAPI service at
`http://localhost:8001/api/v1`. Override these for native builds with
`--dart-define=AUTH_BASE_URL=...` and `--dart-define=API_BASE_URL=...`.
Flutter web reads runtime settings from `/config.json` when served by the
deployment container.

## Checks

```bash
flutter analyze --no-fatal-infos --no-fatal-warnings
flutter test
```

The same checks are defined in the repository's CI workflow. See the root
[`README.md`](../README.md) for the architecture overview and
[`../vertex_be/deploy/README.md`](../vertex_be/deploy/README.md) for the
documented deployment process.
