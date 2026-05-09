import { describe, it, expect } from "vitest";
import { el, text } from "../src/jsdl.js";

describe("jsdl: el()", () => {
  it("collapses an empty children list to undefined", () => {
    const node = el("div", { style: { color: "red" } });
    expect(node.props.children).toBeUndefined();
    expect(node.type).toBe("div");
  });

  it("returns a single child unwrapped", () => {
    const node = el("div", {}, "hello");
    expect(node.props.children).toBe("hello");
  });

  it("returns multiple children as an array", () => {
    const node = el("div", {}, "a", "b", "c");
    expect(Array.isArray(node.props.children)).toBe(true);
    expect((node.props.children as string[]).length).toBe(3);
  });

  it("filters out null / undefined / false children", () => {
    const node = el("div", {}, "a", null, undefined, false, "b");
    expect(node.props.children).toEqual(["a", "b"]);
  });

  it("text() coerces numbers to strings", () => {
    expect(text(42)).toBe("42");
    expect(text("hi")).toBe("hi");
  });
});
