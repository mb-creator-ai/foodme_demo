---
name: writing-unit-tests
description: Write fast, isolated unit tests for FoodMe. Use when testing a single class or function without Spring, a database or a browser, such as backend service logic, DTO rules, or storefront helpers and Zod schemas. Not for API endpoint tests (writing-integration-tests) or browser flows (writing-e2e-tests).
---

# Writing unit tests

A unit test covers one class or function with its collaborators replaced. It starts no
Spring context, database or browser.

## Where unit tests are possible today

| App | Status | What to do |
|---|---|---|
| `apps/backend` | Ready. JUnit 5, Mockito and AssertJ come from `spring-boot-starter-test`. No unit tests exist yet. | Follow the backend steps below |
| `apps/web` | **No test runner installed** | Read "Frontend unit tests" first |
| `apps/admin` | **No test runner installed** | Read "Frontend unit tests" first |

## Backend steps

1. Pick logic that branches: the `service/` classes are the best targets, for example
   `OrderService.calculateDeliveryPrice`.
2. Create the test in a package matching the class under test:
   `apps/backend/src/test/java/am/foodme/backend/service/OrderServiceTest.java`.
   The existing tests sit in the root package because they are integration tests.
3. Use plain JUnit with `@ExtendWith(MockitoExtension.class)`. Don't add
   `@SpringBootTest`, `@ActiveProfiles` or MockMvc.
4. Mock repositories with `@Mock`, and build the service through its constructor.
5. Name methods `method_condition_expected`, the convention used across the test suite.
6. Run it from `apps/backend`:
   `.\gradlew.bat test --tests "am.foodme.backend.service.OrderServiceTest"`

```java
@ExtendWith(MockitoExtension.class)
class OrderServiceTest {

    @Mock private OrderRepository orderRepository;
    @Mock private ChefRepository chefRepository;
    @Mock private DishRepository dishRepository;
    @Mock private CustomerRepository customerRepository;

    private OrderService orderService;

    @BeforeEach
    void setUp() {
        orderService = new OrderService(orderRepository, chefRepository, dishRepository,
                customerRepository, new SimpleMeterRegistry());
    }

    @Test
    void calculateDeliveryPrice_unknownChef_throwsNotFound() {
        DeliveryPriceRequestDto request = new DeliveryPriceRequestDto();
        request.setChefId(99L);
        when(chefRepository.findById(99L)).thenReturn(Optional.empty());

        assertThrows(NotFoundException.class, () -> orderService.calculateDeliveryPrice(request));
    }
}
```

`OrderService` needs a `MeterRegistry`. Pass a real `SimpleMeterRegistry` rather than a
mock, because it's cheap and needs no stubbing.

## What to cover

- Each branch of the logic, and the boundary values (`>` versus `>=`).
- Failure paths: which exception is thrown and its message, because API tests assert on
  those messages.
- Null handling, for example a missing `subtotal`.

Skip trivial getters, Lombok-generated code and anything that only delegates.

## Seeded bugs

Several services contain `FM-BUG-*` markers. Assert the behaviour the product should
have. If the correct assertion fails because of a seeded bug, leave the test failing,
report it, and don't change the production code unless the task covers that bug.

## Frontend unit tests

Neither frontend has Vitest or Jest, so a unit test there means adding a dependency.
**Ask before doing that.** Until then, cover frontend behaviour with Playwright.

Good first targets once a runner is approved:

| Target | Notes |
|---|---|
| `apps/web/src/lib/utils.ts` (`formatAmd`, `translate`, `sameLabel`) | Pure functions |
| `apps/web/src/schemas/*.ts` | Zod schemas; test `safeParse` results |
| `apps/web/src/hooks/useCart.ts` | Needs `fake-indexeddb` as well, because Dexie uses IndexedDB |

If approved, for `apps/web`:

1. Run `npm install -D vitest` inside `apps/web`, and commit the `package-lock.json`
   change, because the Docker build uses `npm ci`.
2. Add a `"test": "vitest run"` script. Vitest reads `vite.config.ts`, so the `@/` alias
   works.
3. Keep test files out of the production type-check, or make sure they compile:
   `tsconfig.app.json` includes all of `src`, and `npm run build` runs `tsc -b`.

## Before finishing

- The test passes, and it fails when the logic is deliberately broken.
- It starts no Spring context, so it runs in milliseconds.
- No application code was changed unless the task asked for it.
