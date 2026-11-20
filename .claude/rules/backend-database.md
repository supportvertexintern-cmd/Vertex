---
paths:
  - "vertex_be/app/**/*.py"
  - "vertex_be/alembic/**/*.py"
  - "vertex_be/alembic.ini"
  - "vertex_be/requirements.txt"
---

# Backend and database rules

- The backend in `vertex_be/` owns PostgreSQL access, schema changes, migrations, and application data.
- Follow the existing FastAPI and SQLAlchemy patterns. Use Alembic migrations as the schema-change history; do not introduce Prisma or Django.
- Inspect the relevant SQLAlchemy model and migration history before proposing schema changes. Keep model and migration changes aligned.
- Do not infer that `vertex/docs/schema.sql` is the migration authority. It is a snapshot that must be compared with models and Alembic before use.
- Preserve role-based access, tenant/country scoping, audit behavior, and API response contracts. Trace authorization through the actual endpoint and service before changing it.
- Never print connection strings, credentials, or environment-variable values. Do not connect to a database or apply migrations without explicit authorization.
