---
name: writing-integration-tests
description: Write FoodMe backend integration tests that run the real Spring context, security, services and repositories against in-memory H2 through MockMvc. Use when testing API endpoints, authentication, validation, status codes or JSON response shapes. Not for isolated class tests (writing-unit-tests) or browser flows (writing-e2e-tests).
---

# Writing integration tests

These tests send HTTP requests through MockMvc into the real application: security
filters, controllers, services and JPA, on an in-memory database. All existing backend
tests are this kind.

## Setup

Copy this shape. Tests live in the root test package as `<Feature>ControllerTest.java`:
`apps/backend/src/test/java/am/foodme/backend/`.

```java
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChefControllerTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void getChef_unknownId_returnsNotFound() throws Exception {
        mockMvc.perform(get("/api/chef/9999"))
                .andExpect(status().isNotFound());
    }
}
```

Run from `apps/backend`:

```
.\gradlew.bat test --tests "am.foodme.backend.ChefControllerTest"
.\gradlew.bat test
```

## The test environment

- `src/main/resources/application-test.properties` configures the `test` profile. It
  sits in `main`, not `test`.
- The database is H2 in PostgreSQL mode. The schema comes from JPA entities, and Flyway
  is off, so migrations are **not** exercised.
- Seed data comes from `src/test/resources/data.sql`, which is much smaller than the
  production seed.
- Simulated latency, HTTP logging and the flaky heartbeat job are off under this profile.

| Seed data | Values |
|---|---|
| Chefs | `1` and `2` ACTIVE, `3` INACTIVE |
| Dishes | `1`, `2` for chef 1; `3` for chef 2; `4` INACTIVE on chef 1 |
| Admin | id `1`, username `admin` |

## Authentication

Register a customer and use the returned token, with a unique email each time:

```java
private String customerToken() throws Exception {
    String email = "feature-test-" + UUID.randomUUID() + "@example.com";
    String response = mockMvc.perform(post("/api/auth/register")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(objectMapper.writeValueAsString(Map.of(
                            "fullName", "Ann",
                            "email", email,
                            "phoneNumber", "+37491234567",
                            "password", "secret123"))))
            .andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
    return objectMapper.readTree(response).get("token").asText();
}
```

Send it with `.header("Authorization", "Bearer " + token)`.

Access rules are in `security/SecurityConfig.java`:

| Path | Access |
|---|---|
| `/api/auth/**` | Public |
| `/api/customer/**`, `POST /api/order` | Customer role |
| Other `/api/**` | Public |
| `/admin/auth/login`, `GET /admin/dish/**` | Public |
| Other `/admin/**` | Any authenticated user; the rule has no role check |

No backend test logs in as an admin yet. `data.sql` seeds an `admin` user, but confirm
that its password hash works before relying on it.

## What to cover for an endpoint

- The success path: status plus the fields that matter, using `jsonPath`.
- Validation failures: `400` and the exact `$.message`.
- Not found: `404`.
- Access: `401` without a token, and the wrong role where that applies.
- Persisted effects: read the data back through the API, as
  `createOrder_cashPayment_succeeds` does.

## Isolation

The H2 database and Spring context are shared across test classes and nothing rolls
back, so data from one test is visible to the next.

- Use unique emails, and read the generated ids and order numbers from responses.
- Never assert global counts or a specific generated value.
- Scope list assertions to a customer you just created.
- Create data through the API rather than adding rows to `data.sql`, because other
  tests assert on those rows.

## Don't copy these flaky patterns

These exist on purpose, as course exercises. Leave them alone unless the task targets them.

| Marker | Problem | Do this instead |
|---|---|---|
| `FM-FLAKE-02` | Hardcodes `FM-100001` and relies on `@Order` and a shared sequence | Read the number from the response; never use `@TestMethodOrder` |
| `FM-FLAKE-03` | Asserts `[0]` of a list whose sort has ties | Assert membership, or give the data a distinct sort value |
| `FM-FLAKE-04` | Compares a stored time with `LocalDate.now()`, which can differ around midnight or by time zone | Assert a range, or use a fixed clock |

## Before finishing

- Run the whole suite, not just the new class, because state is shared.
- If you changed the schema, also run `bootRun` against PostgreSQL. These tests can't
  catch a broken migration.
- Report any seeded `FM-BUG-*` that a correct test exposes. Don't adjust the assertion
  to hide it.
