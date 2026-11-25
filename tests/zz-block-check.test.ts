import { expect, test } from "vitest";

test("deliberate failure to prove main is protected", () => {
  expect(1).toBe(2);
});
