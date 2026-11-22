import { describe, expect, it } from "vitest";
import { fillTemplate, waLink, waNumber } from "./whatsapp";

describe("whatsapp", () => {
  it("adds +91 to 10-digit numbers", () => expect(waNumber("98765 43210")).toBe("919876543210"));
  it("accepts a leading 0", () => expect(waNumber("09876543210")).toBe("919876543210"));
  it("accepts +91 and 91 forms", () => {
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
    expect(waNumber("919876543210")).toBe("919876543210");
  });
  it("accepts other countries with +", () => expect(waNumber("+971501234567")).toBe("971501234567"));
  it("rejects wrong numbers", () => {
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("")).toBeNull();
    expect(waNumber(null)).toBeNull();
  });
  it("builds a link with the text encoded", () => expect(waLink("919876543210", "Hi & bye\nOK")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye%0AOK"));
  it("fills placeholders and keeps unknown ones", () => expect(fillTemplate("Hi {name} {x}", { name: "Ravi" })).toBe("Hi Ravi {x}"));
});
