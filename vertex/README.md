# Vertex Web Application

The web client is a Next.js 16 App Router application using React 19 and
TypeScript. Its server routes call the FastAPI service in `../vertex_be`; the
backend owns application data, PostgreSQL access, and schema migrations.

## Local development

Install dependencies and run the web development server from this directory:

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. To use API-backed features, configure the
required environment values with a maintainer and run the FastAPI service; do
not add database credentials or direct database access to this application.
Keep local environment files out of version control (see
[`../docs/secrets.md`](../docs/secrets.md)).

## Checks

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
```

The integration and browser-test scripts use disposable local services and
require Docker and Git Bash:

```bash
sh scripts/test.sh
sh scripts/test-e2e.sh
```

See [`../README.md`](../README.md) for the repository overview and
[`../vertex_be/deploy/README.md`](../vertex_be/deploy/README.md) for the
documented deployment process.
