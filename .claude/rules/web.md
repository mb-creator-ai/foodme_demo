---
paths:
  - "apps/web/**"
---

# Storefront rules

- TypeScript with the `@/` alias for `src/`. The codebase has no `../` imports, so
  keep it that way.
- API calls live in `src/api`, and pages read them through TanStack Query. Form
  validation uses Zod schemas in `src/schemas`.
- The cart is local: Dexie stores it in IndexedDB (`src/lib/db.ts`) and
  `src/hooks/useCart.ts` holds its logic. It never goes through the backend until
  checkout.
- UI text is hardcoded in components. i18next is installed, but no component uses
  `useTranslation`. E2E tests match on this text, so changing it can break them.
- `npm run build` runs `tsc -b`, and `tsconfig.app.json` includes all of `src`, so any
  file placed there must compile.
- Lint with `npm run lint` (oxlint).
