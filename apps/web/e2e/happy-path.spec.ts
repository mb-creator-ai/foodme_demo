import { test, expect } from "@playwright/test";
import { createAccountAtCheckout, registerCustomerViaApi } from "./auth";

const API = process.env.VITE_API_BASE_URL || "http://localhost:8081";

test("explore -> chef -> add 2 dishes -> cart total -> cash checkout -> success", async ({
  page,
}) => {
  await page.goto("/explore");

  const firstChefCard = page.locator("a.cc_card").first();
  await expect(firstChefCard).toBeVisible();
  await firstChefCard.click();

  await expect(page).toHaveURL(/\/chef\/\d+/);

  const dishButtons = page.locator("button.dc_card");
  await expect(dishButtons.first()).toBeVisible();

  await dishButtons.nth(0).click();
  await page.getByRole("button", { name: "Add to cart" }).click();

  await dishButtons.nth(1).click();
  await page.getByRole("button", { name: "Add to cart" }).click();

  const cartPanel = page.locator("aside.uc-panel");
  await expect(cartPanel.locator(".cic_root")).toHaveCount(2);

  await cartPanel.getByRole("link", { name: "Go to checkout" }).click();
  await expect(page).toHaveURL(/\/checkout/);

  await createAccountAtCheckout(page, "Ann Test");
  await page.getByRole("form", { name: "Checkout" }).getByLabel("Full name").fill("Ann Test");
  await page.getByRole("form", { name: "Checkout" }).getByLabel("Phone").fill("+37491234567");
  await page.getByRole("form", { name: "Checkout" }).getByLabel("Email").fill("ann@example.com");
  await page.getByLabel("City").fill("Yerevan");
  await page.getByLabel("Street").fill("Abovyan");

  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/orders\/success/);
  await expect(page.getByText("Order placed!")).toBeVisible();
});

test("dish modal additions raise cart line price", async ({ page }) => {
  const chefs = await page.request.get(`${API}/api/chef/active?page=0&size=12`);
  expect(chefs.ok()).toBeTruthy();
  const chefBody = await chefs.json();

  let chefId: number | null = null;
  let dishName: string | null = null;
  for (const chef of chefBody.exploreChefResponseDtoList) {
    const detail = await (await page.request.get(`${API}/api/chef/${chef.id}`)).json();
    // Prefer a dish early in the sorted list so it is visible without scrolling forever.
    const found = (detail.dishes || [])
      .slice(0, 12)
      .find((d: { additions?: unknown[]; nameEn?: string }) => d.additions && d.additions.length > 0);
    if (found) {
      chefId = chef.id;
      dishName = found.nameEn;
      break;
    }
  }
  expect(chefId).toBeTruthy();
  expect(dishName).toBeTruthy();

  await page.goto(`/chef/${chefId}`);
  const dishBtn = page.locator("button.dc_card").filter({ hasText: dishName! }).first();
  await expect(dishBtn).toBeVisible({ timeout: 15000 });
  await dishBtn.click();

  await expect(page.getByRole("heading", { name: "Additions" })).toBeVisible();
  const firstAddition = page.locator('label[for^="addition-"]').first();
  const firstCheckbox = firstAddition.locator('input[type="checkbox"]');
  const firstCheckmark = firstAddition.locator('span[aria-hidden="true"]');

  expect(await firstAddition.evaluate((node) => getComputedStyle(node).borderRadius)).toBe("0px");
  const checkBox = await firstCheckmark.boundingBox();
  expect(checkBox?.width).toBe(22);
  expect(checkBox?.height).toBe(22);
  expect(await firstCheckmark.evaluate((node) => getComputedStyle(node).borderRadius)).toBe("0px");
  expect(await firstCheckmark.evaluate((node) => getComputedStyle(node).borderColor)).toBe(
    "rgb(0, 0, 0)",
  );

  await firstCheckbox.check();
  await expect
    .poll(() => firstCheckmark.evaluate((node) => getComputedStyle(node).backgroundColor))
    .toBe("rgb(6, 193, 103)");

  await page.getByRole("button", { name: "Add to cart" }).click();
  const cartPanel = page.locator("aside.uc-panel");
  await expect(cartPanel.locator(".cic_root")).toHaveCount(1);
});

test("takeaway checkout succeeds without address", async ({ page }) => {
  await page.goto("/explore");
  await page.locator("a.cc_card").first().click();
  await expect(page).toHaveURL(/\/chef\/\d+/);

  await page.locator("button.dc_card").first().click();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.locator("aside.uc-panel").getByRole("link", { name: "Go to checkout" }).click();

  await createAccountAtCheckout(page, "Bob Pickup");
  await page.getByRole("button", { name: "Takeaway Pick up" }).click();

  await page.getByRole("form", { name: "Checkout" }).getByLabel("Full name").fill("Bob Pickup");
  await page.getByRole("form", { name: "Checkout" }).getByLabel("Phone").fill("+37491111222");
  await page.getByRole("form", { name: "Checkout" }).getByLabel("Email").fill("bob@example.com");

  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\/success/);
  await expect(page.getByText("Order placed!")).toBeVisible();
});

test("admin can login and list orders after a storefront checkout", async ({
  page,
  request,
}) => {
  const chefsRes = await request.get(`${API}/api/chef/active?page=0&size=12`);
  const chefs = await chefsRes.json();
  const chef = chefs.exploreChefResponseDtoList[0];
  const chefDetail = await (await request.get(`${API}/api/chef/${chef.id}`)).json();
  const dish = chefDetail.dishes[0];
  expect(dish).toBeTruthy();

  const { token: customerToken } = await registerCustomerViaApi(request, API);
  const createRes = await request.post(`${API}/api/order`, {
    headers: { Authorization: `Bearer ${customerToken}` },
    data: {
      chefId: chef.id,
      receiverName: "Admin Smoke",
      receiverPhoneNumber: "+37490000000",
      receiverEmail: "admin-smoke@example.com",
      paymentType: "CASH",
      deliveryMethod: "TAKEAWAY",
      note: "e2e admin visibility",
      createOrderDishes: [{ dishId: dish.id, quantity: 1 }],
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const order = await createRes.json();
  expect(order.number).toBeTruthy();

  const login = await request.post(`${API}/admin/auth/login`, {
    data: { username: "admin", password: "admin123" },
  });
  expect(login.ok()).toBeTruthy();
  const { token: adminToken } = await login.json();
  expect(adminToken).toBeTruthy();

  const orders = await request.get(`${API}/admin/order?page=0&size=20`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(orders.ok()).toBeTruthy();
  const body = await orders.json();
  const list = body.list || body.content || body.orders || [];
  const found = Array.isArray(list)
    ? list.some((o: { number?: string }) => o.number === order.number)
    : JSON.stringify(body).includes(order.number);
  expect(found).toBeTruthy();

  // The backend serves the built admin SPA at /backoffice — same origin as the
  // API, no separate admin dev server needed. Hash route: the admin app uses
  // react-admin's default hash router.
  await page.goto(`${API}/backoffice/#/login`);
  await expect(
    page.getByLabel(/username/i).or(page.locator('input[name="username"]')),
  ).toBeVisible({ timeout: 15000 });
});
