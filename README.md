# Xpand-Elearning

Student portal and secure assessment platform for Xpand CS Academy.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): design, data model, access-control rules
- [docs/API.md](docs/API.md): every API endpoint, by role, with exam endpoints in their own section
- [docs/BACKEND_PLAN.md](docs/BACKEND_PLAN.md): backend phases B0–B4 (structure, RBAC, catalog, assignment, infrastructure)
- [docs/FRONTEND_GUIDE.md](docs/FRONTEND_GUIDE.md): frontend rules and screens for the next phases
- [docs/TEST_PLAN.md](docs/TEST_PLAN.md): test cases (M0 now, checklists for M1/M2)
- [docs/DEPLOY.md](docs/DEPLOY.md): EC2 deployment, HTTPS, logs, backups and restore tests, upgrades

The legacy Google Apps Script version (`frontend.html`, `frontend.js`, `portal.json`, `test/`) is kept as a reference until the new app reaches feature parity.

## Local development

Requires Node 24+ and Docker.

```sh
cp .env.example .env        # then set DATABASE_URL=postgresql://xpand:xpand-dev@localhost:5433/xpand, COOKIE_SECURE=false
docker compose -f docker-compose.dev.yml up -d   # Postgres on localhost:5433
npm install
npm run db:migrate -w server
npm run create-super-admin -w server -- --username admin --name "Your Name"
npm run dev:server          # API on :8080
npm run dev:web             # React on :5173 (proxies /api)
```

Tests:

```sh
npm test                         # unit tests
npm run test:int                 # integration tests (database xpand_test, created by docker-compose.dev.yml)
npm run test:coverage -w server  # both, with coverage gates (as in CI)
npm run lint && npm run format:check
```

Schema changes: edit `server/prisma/schema.prisma`, then run `npm run db:migrate -w server -- --name <change>` **in an interactive terminal**. It may ask for confirmation, and while waiting it holds a database lock; never run it from scripts or CI. Review the generated SQL before committing; hand-written constraints go at the end of the migration file.

## Deploying on EC2

See [docs/DEPLOY.md](docs/DEPLOY.md): Caddy terminates HTTPS in front of the app, a one-shot `migrate` container applies migrations before the app starts, and there are nightly backups to S3 with a restore test each release.

## Importing students

Prepare a CSV with the columns `username,fullName,email,mobile,group,groupIntakeDate,joinDate` (dates as `YYYY-MM-DD`; `joinDate` is optional), put it in `imports/` (ignored by git), then run:

```sh
npm run import-users -w server -- --file ../imports/students.csv
# inside the container: docker compose exec app node dist/scripts/import-users.js --file <path> --out <dir>
```

Every imported user gets a new temporary password, written to `imports/credentials-*.csv`. Hand them out, then delete the file. Passwords from the legacy portal must **not** be reused, because they are visible in its page source.
