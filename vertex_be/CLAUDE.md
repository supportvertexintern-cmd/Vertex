# Backend component guidance

`vertex_be/` is the FastAPI service and owns application data, PostgreSQL access, SQLAlchemy models, and Alembic migrations. Follow the root `AGENTS.md` and `.claude/rules/backend-database.md` before backend changes.

Do not add Prisma or Django, connect to a database, apply migrations, or change deployed environments without explicit user authorization.
