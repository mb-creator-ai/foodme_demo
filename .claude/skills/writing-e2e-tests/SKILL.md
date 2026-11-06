---
name: writing-e2e-tests
description: Write Playwright end-to-end tests for the FoodMe storefront (apps/web/e2e) and admin (apps/admin/e2e) that drive a real browser against a running backend. Use for user flows such as browsing, cart, checkout, login and admin screens, and for regression tests of UI bugs. Not for API-only checks (writing-integration-tests) or isolated logic (writing-unit-tests).
---

# Writing E2E tests

## Prerequisites

| Need | Details |
|---|---|
| PostgreSQL | Running on 5432 with the `foodme` database, user and password |
| Backend | Start it yourself from `apps/backend` with `.\gradlew.bat bootRun`. Playwright won't. |
| Frontend | Playwright starts it: storefront on 5180, admin on 5174, reusing a running server |
| Dependencies | Once per app, in `apps/web` and `apps/admin`: `npm ci` |
| Browser | Once per app, after `npm ci`: `npx playwright install chromium` |

Check the backend first: `http://localhost:8081/actuator/health` should report `UP`.
Playwright only runs Chromium.

## Commands

Run from `apps/web`, or from `apps/admin` for admin specs:

```
npx playwright test e2e/storefront-flows.spec.ts -g "cart minus"
npx playwright test
npx playwright show-report
```

`npm run test:e2e:all` in `apps/web` runs both apps.

Environment overrides: `PLAYWRIGHT_BASE_URL` (web), `ADMIN_BASE_URL` (admin) and
`VITE_API_BASE_URL` (API). `layout.spec.ts` hardcodes port 8081 and ignores the last one.

## Where tests go

| Flow | File |
|---|---|
| Storefront flows, cart, account | `apps/web/e2e/storefront-flows.spec.ts` |
| Full checkout journeys | `apps/web/e2e/happy-path.spec.ts` |
| Page structure and responsive layout | `apps/web/e2e/layout.spec.ts` |
| Admin | `apps/admin/e2e/admin-flows.spec.ts` |

Add to these files. The `flake-*.spec.ts` files are course exercises, so don't add
to them.

## Locators

Prefer roles and labels; use the app's existing classes for elements that have none.

| Element | Locator |
|---|---|
| Chef card | `page.locator("a.cc_card")` |
| Dish card (opens the modal) | `page.locator("button.dc_card")` |
| Quick add on a dish | `page.getByRole("button", { name: "Add <dish> to cart" })` |
| Add in the dish modal | `page.getByRole("button", { name: "Add to cart" })` |
| Cart panel | `page.locator("aside.uc-panel")` |
| Cart line | `cart.locator(".cic_root")` |
| Quantity value | `cart.locator(".fm-qty-grp p")` |
| Quantity buttons | `cart.getByRole("button", { name: "Increase quantity" })`, `"Decrease quantity"` |
| Remove line | `cart.getByRole("button", { name: "Remove item" })` |

Scope to the cart panel, because the page can contain matching text elsewhere.

## Reusable pieces

- `apps/web/e2e/auth.ts`: `createAccountAtCheckout(page, name)` and
  `registerCustomerViaApi(request, apiBase)`.
- `addFirstDishToCart(page)` in `storefront-flows.spec.ts` gets to a one-item cart and
  returns the cart locator.
- `loginAsAdmin(page)` and `createOrderViaApi(request)` in `admin-flows.spec.ts`.

## Timing

The backend adds a random 200–1500 ms delay to every API call outside the test profile,
and E2E runs against that real delay.

- Never use `page.waitForTimeout`. That is the `FM-FLAKE-01` mistake.
- Use web-first assertions, which retry: `await expect(locator).toHaveText("2")`.
- After every action that changes state, assert the result before the next action.
  Clicks can land before the UI has caught up, so a quick second "add" can apply late.
- Wait for the cart to update before reloading, because the write to IndexedDB is
  asynchronous. See `FM-FLAKE-05` in `flake-cart-persistence.spec.ts`.

## Data and isolation

- The storefront runs `fullyParallel`, and all tests share one backend database. Create
  unique accounts with the helpers.
- Each test gets a fresh browser context, so the IndexedDB cart starts empty.
- E2E uses the Flyway seed, not `data.sql`: dish and chef names differ from the backend
  integration tests. Find data through the UI or API instead of hardcoding ids.
- Don't assert exact chef counts. `layout.spec.ts` explains why (`FM-BUG-02`).

## Known local failure

`happy-path.spec.ts`, "admin can login and list orders after a storefront checkout",
opens `/backoffice` on the backend. That path exists only in the Docker image, so it
returns 404 under `bootRun`. Expect this failure locally and report it as such.

## Regression tests for UI bugs

1. Write the test from the ticket's steps to reproduce.
2. Confirm it fails with the bug, and passes with the fix. Restore the fix afterwards.
3. Cover the boundary on both sides. For SCRUM-5 that meant one test at quantity 2 and
   one at quantity 1.

## Before finishing

- Run the new test, then the whole spec file.
- Report the full result, including failures you believe are unrelated, with the reason.
