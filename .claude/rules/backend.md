---
paths:
  - "apps/backend/**"
---

# Backend rules

- Layering is controller → service → repository. Controllers are split into
  `controller/api` (public and customer) and `controller/admin` (JWT-protected).
- Services use explicit constructor injection. Follow that in new code.
- Raise `BadRequestException` or `NotFoundException`. `GlobalExceptionHandler` turns
  them into `ErrorResponseDto` responses.
- Schema changes need a new Flyway migration in `src/main/resources/db/migration`,
  named `V<n>__description.sql`. Never edit a migration that has already been applied.
- Production uses `ddl-auto=validate`, so entities and migrations must match. The test
  profile builds the schema from entities with Flyway off, so `.\gradlew.bat test`
  won't catch a mismatch. After a schema change, also start the app with `bootRun`
  against PostgreSQL.
- All tables live in the `foodme` schema.
- Access rules are in `security/SecurityConfig.java`. Check them when adding an endpoint.
