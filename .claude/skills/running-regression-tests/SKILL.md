---
name: running-regression-tests
description: Run the existing FoodMe regression suites for the backend, storefront and admin, then classify and report the results without changing code. Use when asked to run regression tests, check a branch or fix for regressions, or report suite health. Not for adding or changing tests (writing-unit-tests, writing-integration-tests, writing-e2e-tests).
---

# Running regression tests

A regression run measures the code as it stands. Your job is to run the suites, sort
every failure into a category, and report it. It is not to get the run green.

## What exists

| Area | Check | Size | Needs |
|---|---|---|---|
| Backend | Integration tests (JUnit 5, MockMvc, H2) | 16 tests, 4 classes | Java 17 |
| Web | Lint and type-check/build | Static checks, not tests | `npm ci` |
| Admin | Lint and build | Static checks, not tests | `npm ci` |
| Web E2E | Playwright, `apps/web/e2e` | 23 tests, 5 spec files | Full stack |
| Admin E2E | Playwright, `apps/admin/e2e` | 7 tests, 1 spec file | Full stack |

Web and admin have no unit test runner, so E2E is their only behavioural coverage. There
is no CI pipeline, and the Docker build skips tests, so nothing else will run these for you.

The sizes are a cross-check, not a contract. If a suite reports a different total, find
out why before trusting the run.

## Prerequisites

| Need | Details | Needed for |
|---|---|---|
| Java 17 | The Gradle toolchain requires it. If `java` isn't found, open a new terminal rather than reinstalling. | Backend, full stack |
| Node and npm | If `node` isn't found, open a new terminal rather than reinstalling. | Web, admin |
| Dependencies | Once per app, in `apps/web` and `apps/admin`: `npm ci`. Don't use `npm install`, which can rewrite the lockfile. | Web, admin |
| Browser | Once per app, after `npm ci`: `npx playwright install chromium`. The two apps can use different Playwright versions, so do both. | E2E |
| PostgreSQL | Running on 5432 with the `foodme` database, user and password. Flyway creates the schema and seed on first start. | E2E |
| Backend server | From `apps/backend`: `.\gradlew.bat bootRun`, in its own terminal. Playwright won't start it. It keeps running, so the Gradle progress never reaches 100%. | E2E |

Playwright starts the frontends itself: the storefront on 5180 and admin on 5174, reusing
a server that is already running.

Before E2E, `http://localhost:8081/actuator/health` must report `UP`.

### Use local services only

- Check that `SPRING_DATASOURCE_URL`, `DATABASE_URL`, `PLAYWRIGHT_BASE_URL`,
  `ADMIN_BASE_URL` and `VITE_API_BASE_URL` are unset, or point at localhost.
- E2E creates real customers and orders. Never aim it at the deployed site unless the
  user asks you to.
- Don't set `CI` locally. It turns on retries and stops Playwright reusing a running
  server, so the run no longer behaves like a local run.

## Execution order

Run from cheapest to most expensive, so setup problems surface early. Commands use the
Windows form; on macOS or Linux use `./gradlew`.

### 1. Record the baseline

From the repository root:

```
git status --short
git rev-parse --short HEAD
```

Keep this output. You'll compare `git status` at the end and quote the commit in the report.

### 2. Backend

From `apps/backend`:

```
.\gradlew.bat cleanTest test
```

Use `cleanTest` for a regression run. A plain `test` is skipped as `UP-TO-DATE` when
nothing changed, which reports success without running anything. A real run prints a
`PASSED`, `FAILED` or `SKIPPED` line for each test, so count them.

This uses in-memory H2, so PostgreSQL isn't needed. It doesn't exercise Flyway migrations;
`bootRun` in step 5 does.

### 3. Web static checks

From `apps/web`:

```
npm run lint
npm run build
```

`npm run build` runs `tsc -b`, then `vite build`.

### 4. Admin static checks

From `apps/admin`:

```
npm run lint
npm run build
```

Admin is JavaScript, so its build doesn't type-check.

### 5. Start the stack

Start PostgreSQL, start `bootRun`, and confirm the health check reports `UP`. If the
backend won't start, stop here and report an environment issue.

### 6. Web E2E

From `apps/web`:

```
npx playwright test --list
npm run test:e2e
```

`--list` runs nothing. It confirms the expected tests were collected.

### 7. Admin E2E

From `apps/admin`:

```
npx playwright test --list
npm run test:e2e
```

Run web and admin separately. Don't use `npm run test:e2e:all` for a regression run: it
joins them with `&&`, so any web failure skips admin. The known local failure below means
that happens on every local run, and admin would go unreported.

### 8. Confirm nothing changed

From the repository root, run `git status --short` and compare it with step 1. Stop any
server you started.

### When a step fails

Keep going unless the failure blocks later steps. A backend test failure doesn't stop
E2E. Only an environment problem that later steps depend on, such as a backend that won't
start, ends the run. List anything you couldn't run as **not run**, never as passed.

### Running part of the suite

When the user asks for one area only, run its steps and state what you left out:

| Scope | Steps |
|---|---|
| Backend | 1, 2, 8 |
| Storefront | 1, 3, 5, 6, 8 |
| Admin | 1, 4, 5, 7, 8 |

## Where the results are

| Output | Location |
|---|---|
| Backend HTML report | `apps/backend/build/reports/tests/test/index.html` |
| Backend XML results | `apps/backend/build/test-results/test/` |
| Playwright HTML report | `playwright-report/` in each app; open with `npx playwright show-report` |
| Playwright failure output | `test-results/` in each app |

All of these are gitignored. `build/` can hold results from earlier runs, including test
classes that no longer exist, so only trust a report produced by the run you just did.

Locally `retries` is 0, and `trace` is `on-first-retry`, so Playwright records no traces
and a flaky test appears as a plain failure. Don't change the config to get traces.

## Classifying failures

Work through these in order for each failure.

1. **Did the suite actually execute?** If it stopped before running tests, or the total
   is wrong, it's an environment issue.
2. **Where did it fail?** An error while starting, connecting or launching points to the
   environment. A failed assertion in the test body points to the code or the test.
3. **How wide is it?** Many unrelated tests failing with one identical connection or
   startup error points to the environment. A single test or feature points to the code.
4. **Is it already known?** Check "Known failures and flakes" below, the test's own file
   for a marker, and the code it exercises for an `FM-BUG-*` comment.
5. **Does it repeat?** Rerun only that test, several times, with the commands below.

| Category | Meaning | Typical evidence |
|---|---|---|
| Environment/setup | The test never got a fair chance | See the table below; other tests also fail the same way; fixed by repairing setup with no code change |
| Regression | Behaviour that should work no longer does | Assertion failure that repeats, with a clear expected and actual value, and no marker |
| Seeded defect | A planted `FM-BUG-*` | Repeats, and the failing code carries the marker |
| Flaky | The result changes with no code change | Passes and fails across reruns, often with an `FM-FLAKE-*` marker |
| Known local failure | Expected in this environment | Matches "Known failures and flakes" exactly |

If you can't place a failure with evidence, report it as **unclassified** with what you
checked. Don't guess, and don't call something flaky or unrelated without a rerun or a
marker to back it up.

### Environment/setup signatures

| Symptom | Likely cause |
|---|---|
| `ECONNREFUSED` or `ERR_CONNECTION_REFUSED` on port 8081 | Backend isn't running |
| Health check isn't `UP`, or a connection to port 5432 is refused during `bootRun` | PostgreSQL is down or its credentials are wrong |
| Flyway errors during `bootRun` | Database state or a migration. Report it; don't edit the migration or the database |
| Playwright says a browser executable doesn't exist | `npx playwright install chromium` wasn't run for that app |
| Playwright times out on `config.webServer` | The dev server couldn't start, or the port is taken |
| `Cannot find module`, or `playwright` isn't recognised | `npm ci` wasn't run for that app |
| `java`, `node` or `npm` isn't recognised | Stale PATH; open a new terminal |
| Gradle can't find a Java 17 toolchain | Java 17 is missing or not visible to Gradle |
| Gradle can't download the distribution or dependencies | Network or proxy problem |
| Every admin test fails at login | Check the backend and its seed data before suspecting the admin code |

Fix setup problems only by installing or starting the things listed under Prerequisites.
Then rerun the affected step, and say in the report that you did. If that doesn't work,
report the blocker and stop.

### Rerunning one test

Backend, from `apps/backend`:

```
.\gradlew.bat cleanTest test --tests "am.foodme.backend.OrderControllerTest"
```

Backend tests share one H2 database and Spring context. A test that fails in the full
suite but passes alone may depend on run order, so also repeat the full `cleanTest test`.

Playwright, from `apps/web`, or `apps/admin` for admin specs:

```
npx playwright test e2e/storefront-flows.spec.ts -g "cart minus"
npx playwright test e2e/storefront-flows.spec.ts -g "cart minus" --repeat-each=5
```

Reruns are for classifying a failure. A pass on rerun doesn't cancel the failure: report
both results.

## Known failures and flakes

| Item | Where | What to expect |
|---|---|---|
| Local-only failure | `happy-path.spec.ts`, "admin can login and list orders after a storefront checkout" | Opens `/backoffice` on the backend, which exists only in the Docker image, so it gets a 404 under `bootRun` |
| `FM-FLAKE-01` | `flake-dish-modal.spec.ts` | A fixed `waitForTimeout` races the modal |
| `FM-FLAKE-02` | `OrderControllerTest` | Hardcodes `FM-100001` and depends on test order and a shared sequence |
| `FM-FLAKE-03` | `DishControllerTest` | Asserts `[0]` of a list whose sort has ties |
| `FM-FLAKE-04` | `OrderControllerTest` | Compares a stored time with `LocalDate.now()`, so it can fail around midnight or across time zones |
| `FM-BUG-02` | `ChefService`, noted in `layout.spec.ts` | The chef list drops one on the last page. The test deliberately asserts only a minimum |

`FM-FLAKE-05` in `flake-cart-persistence.spec.ts` is marked as fixed, so a failure there
needs investigating rather than dismissing.

Other seeded bugs carry `FM-BUG-*` comments in the code, so search for the marker rather
than relying on this table. A marker can be missing even when the bug is present:
`FM-BUG-07` has no comment in the code at the time of writing, and `AGENTS.md` explains it
has been fixed and restored before. Check the file's history before calling something new.

A known item still goes in the report. It just gets its category instead of being treated
as a new regression. If a known failure *passes*, report that too, because something changed.

The storefront runs `fullyParallel` against one shared database, so a failure caused by
leftover data or by another test running alongside it is possible. E2E data also stays in
PostgreSQL between runs. There is no reset script, so don't drop or edit the database
without asking.

The backend logs `Heartbeat job '...' failed (demo)` warnings on purpose. Random backend
delays of 200–1500 ms are also deliberate. Neither is a failure on its own.

## Don't change the code

A regression run is read-only for tracked files.

- Don't edit application code, tests, `data.sql`, migrations, Playwright or Gradle config,
  or `package.json` or lockfiles, even for a one-line fix.
- Don't make a run pass by skipping, deleting or loosening a test, adding `test.only`,
  raising timeouts, or adding retries.
- Don't fix an `FM-BUG-*` or `FM-FLAKE-*`, and don't apply patch files found in the repo.
- Don't use `git stash`, `checkout`, `reset` or `clean` to tidy up, and don't commit or push.

These are fine: `npm ci`, browser installs, starting and stopping local services, and the
gitignored output that runs create (`build/`, `dist/`, `playwright-report/`, `test-results/`).

If the final `git status --short` differs from the baseline, say so in the report and
list the files. Don't revert them without asking.

If the user wants a failure fixed, report first and treat the fix as a separate task.

## Reporting

Report every run in this shape, even a clean one:

```
Regression run: <branch> @ <commit>, <date>, local

| Stage       | Result              | Passed | Failed | Skipped | Not run |
|-------------|---------------------|--------|--------|---------|---------|
| Backend     |                     |        |        |         |         |
| Web static  |                     |   n/a  |   n/a  |   n/a   |         |
| Admin static|                     |   n/a  |   n/a  |   n/a   |         |
| Web E2E     |                     |        |        |         |         |
| Admin E2E   |                     |        |        |         |         |

Failures
- <test name> (<file>)
  Category: Regression | Seeded defect | Flaky | Known local failure | Environment/setup | Unclassified
  Expected / actual: <from the output>
  Evidence: <rerun results, marker, or error signature>
  Report: <path to the HTML report or failure output>

Environment fixes applied: <what you installed or started, or none>
Skipped or not run: <what and why>
Working tree: unchanged | changed (<files>)
```

- Lead with what matters most: real regressions, then anything that couldn't run.
- Give exact counts from the tool output, not estimates.
- Quote the shortest part of the error that proves the point.
- Don't paste secrets. That includes values from `application.properties` and credentials
  in test files or logs.
- Jira is project `SCRUM`. Only create or update an issue if the user asks, and include
  the steps to reproduce, the commit and the expected and actual results.

## Before finishing

- Every stage shows a result or is listed as not run, with the reason.
- Totals match "What exists", or the difference is explained.
- The backend ran for real, with no `UP-TO-DATE` skip.
- Every failure has a category backed by evidence.
- The working tree matches the baseline, and the servers you started are stopped.
