# FoodMe: agent instructions

FoodMe is a food-ordering demo used for a QA course. It deliberately contains
seeded bugs and flaky tests, so read "Seeded defects" before fixing anything.

This file is the shared source of truth for all coding agents. Claude Code loads
it through `CLAUDE.md`.

## Layout

| Path | What it is | Stack |
|---|---|---|
| `apps/web` | Customer storefront; the cart lives in the browser (IndexedDB) | React 19, TypeScript, Vite, Tailwind, TanStack Query, Dexie, Zod |
| `apps/admin` | Back office, served at `/backoffice` in production | React 18, JavaScript, react-admin, Material UI, Vite |
| `apps/backend` | REST API; its Dockerfile bundles both frontends into one image | Java 17, Spring Boot 3.3, Gradle, Spring Security + JWT, JPA, Flyway, PostgreSQL |
| `infra/monitoring` | Grafana, Prometheus and Loki stack | Docker |
| `render.yaml`, `render-monitoring.yaml` | Render blueprints; the app redeploys on every push to the tracked branch | |

There is no root `package.json`. Run npm commands inside `apps/web` or `apps/admin`.

## Commands

Gradle commands use the Windows form. On macOS or Linux use `./gradlew`.

| Task | Directory | Command |
|---|---|---|
| Run the backend (port 8081, needs PostgreSQL) | `apps/backend` | `.\gradlew.bat bootRun` |
| Backend tests (in-memory H2, no PostgreSQL needed) | `apps/backend` | `.\gradlew.bat test` |
| One backend test class | `apps/backend` | `.\gradlew.bat test --tests "am.foodme.backend.OrderControllerTest"` |
| Run the storefront | `apps/web` | `npm run dev` |
| Storefront E2E (backend must be running) | `apps/web` | `npm run test:e2e` |
| Storefront and admin E2E | `apps/web` | `npm run test:e2e:all` |
| Admin E2E (backend must be running) | `apps/admin` | `npm run test:e2e` |
| Type-check and build the storefront | `apps/web` | `npm run build` |
| Lint | `apps/web` or `apps/admin` | `npm run lint` |

Local PostgreSQL defaults: database, user and password are all `foodme`, on port
5432. Flyway creates the schema and seed data on first start.

## Testing overview

| Level | Backend | Web | Admin |
|---|---|---|---|
| Unit | JUnit 5 and Mockito are available; no tests exist yet | No test runner installed | No test runner installed |
| Integration | `@SpringBootTest` + MockMvc + H2 (4 classes) | None | None |
| E2E | Exercised through the UI | Playwright, `apps/web/e2e` | Playwright, `apps/admin/e2e` |

There is no CI pipeline in this repo, and the Docker build skips tests (`-x test`).
Run the relevant tests yourself before calling work done.

Use the `writing-unit-tests`, `writing-integration-tests` and `writing-e2e-tests`
skills when adding tests.

## Seeded defects

Comments such as `// FM-BUG-03` and `// FM-FLAKE-02` mark defects planted for the
course. They are exercises, not accidental mistakes.

- Don't fix an `FM-BUG-*` or `FM-FLAKE-*` marker unless the task asks for that one.
- Don't copy a flaky pattern into new code.
- Don't write a test that treats a seeded bug's behaviour as correct. If a new test
  exposes one, report it rather than bending the assertion to pass.
- A fix can be undone: `3cf66aa` restored FM-BUG-07 after `7e7280f` fixed it. Check
  the file's history when a "fixed" bug reappears.

## Working rules

- Keep changes scoped to the task. Don't refactor or reformat neighbouring code.
- Never commit or push unless asked. Don't commit straight to `main`.
- Merging to the tracked branch deploys to production through Render.
- A bug is fixed once it is verified on the deployed site, not when it is merged.
  The Vite build fingerprints bundles, so a changed `assets/index-*.js` name means
  a new build is live.
- Don't paste secrets into chat, tickets or commits. `application.properties` holds
  hardcoded JWT and internal API keys: don't repeat or reuse them.
- Jira is project `SCRUM`. Reference the issue key in commit messages.

## Known documentation gaps

- `.env.example` mentions `infra/docker-compose.yml` and `docs/deployment.md`.
  Neither exists in this repo.
- `README.md` is a deployment walkthrough for workshop students, not a developer guide.
