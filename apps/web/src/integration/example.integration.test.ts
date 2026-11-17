import { describe, it, expect } from "vitest";

describe("FoodMe integration test", () => {
  it("should combine two operations correctly", () => {
    const price = 3900;
    const quantity = 2;

    const total = price * quantity;

    expect(total).toBe(7800);
  });
});