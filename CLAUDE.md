# Vertex engineering instructions

@AGENTS.md

Use the source hierarchy in [the source authority register](vertex/docs/SOURCE_AUTHORITY.md). Current repository code and active configuration establish technical behavior; they do not approve new business requirements.

## Repository map

- `vertex/`: Next.js web application. It uses FastAPI for application data and has no direct database access.
- `vertex_be/`: FastAPI backend, SQLAlchemy models, PostgreSQL access, and Alembic migrations.
- `vertex_app/`: Flutter mobile application.
- `.github/workflows/`: CI, image build, promotion, local deployment, and production workflows.
- `vertex/docs/`: project documentation and source-authority records.

Read the relevant `.claude/rules/` file before changing a component or release workflow. Use `/requirements-engineering` or `/controlled-implementation` when the user explicitly requests those workflows.

`vertex/CLAUDE.md` is preserved as a historical record and excluded from Claude's loaded instructions by `.claude/settings.json`. Do not copy its old Prisma guidance or credential-like test data into active instructions.
