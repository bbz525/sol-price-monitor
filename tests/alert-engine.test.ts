import { describe, expect, it } from "vitest";
import { decideAlert, getPriceStatus } from "../src/alert-engine.js";

describe("alert engine", () => {
  it("classifies prices below and above the threshold", () => {
    expect(getPriceStatus(119.99, 120)).toBe("below");
    expect(getPriceStatus(120, 120)).toBe("above");
    expect(getPriceStatus(121, 120)).toBe("above");
  });

  it("does not alert on initial state", () => {
    expect(decideAlert(null, 119, 120)).toEqual({ nextStatus: "below", alertType: null });
  });

  it("alerts once when price breaches below threshold", () => {
    expect(decideAlert("above", 119, 120)).toEqual({
      nextStatus: "below",
      alertType: "breach",
    });
  });

  it("does not repeat while staying below threshold", () => {
    expect(decideAlert("below", 110, 120)).toEqual({
      nextStatus: "below",
      alertType: null,
    });
  });

  it("alerts when price recovers to threshold or above", () => {
    expect(decideAlert("below", 120, 120)).toEqual({
      nextStatus: "above",
      alertType: "recovery",
    });
  });

  it("rejects invalid numbers", () => {
    expect(() => getPriceStatus(0, 120)).toThrow("price must be");
    expect(() => getPriceStatus(100, 0)).toThrow("thresholdPrice must be");
  });
});
