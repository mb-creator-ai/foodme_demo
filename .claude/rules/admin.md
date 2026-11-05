---
paths:
  - "apps/admin/**"
---

# Admin rules

- This app is JavaScript (`.jsx`), not TypeScript, and uses React 18. Don't apply
  storefront patterns or React 19 APIs here. Its Playwright specs are the one
  exception and are written in TypeScript.
- UI is built with react-admin and Material UI.
- Production builds use the `/backoffice/` base path; `npm run dev` serves from `/`.
- Routing uses react-admin's default hash router, so URLs look like `/#/login`. Don't
  add a `basename`; the comment in `src/App.jsx` explains why.
- The backend's `/admin/**` paths are the JWT-protected API, not this app.
- Lint with `npm run lint` (ESLint).
