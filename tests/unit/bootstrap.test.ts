import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("bootstrap", () => {
  it("runs vitest with zod", () => {
    expect(z.string().parse("ok")).toBe("ok");
  });
});
