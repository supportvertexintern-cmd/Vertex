---
paths:
  - "vertex_app/**/*.dart"
  - "vertex_app/pubspec.yaml"
---

# Flutter mobile rules

- `vertex_app/` is the Flutter client. Use the Dart and Flutter versions and dependency conventions declared by `pubspec.yaml` and the installed project toolchain.
- Use the backend API for application data; do not create a second database owner or embed credentials in the client.
- Follow the existing navigation, state, networking, and widget patterns in the relevant feature before editing.
- Keep environment-specific API configuration consistent with the deployment documentation. Never put server secrets in a mobile bundle.
