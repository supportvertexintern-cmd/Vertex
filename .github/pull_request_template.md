## What changed

<!-- One or two sentences. Title follows Conventional Commits, e.g. "feat(cases): add milestone reminder" -->

## Why

## How it was tested

- [ ] Tests added or updated
- [ ] Ran locally (`docker compose up`, relevant test commands)

## Checklist

- [ ] No secrets, `.env` files, database dumps or candidate documents in the diff
- [ ] Database change? Alembic migration **and** matching `prisma/schema.prisma` update, backward compatible for one release
- [ ] New columns classified in `readonly-columns.sql`
- [ ] Touches auth, payments, migrations or deploy scripts? Re-read the diff the next day before merging
- [ ] Rollback: deploying the previous image tag is enough (or explain below)

## Rollback notes
