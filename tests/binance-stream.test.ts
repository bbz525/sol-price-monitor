import { describe, expect, it } from "vitest";
import { buildStreamUrl, parsePricePayload } from "../src/binance-stream.js";

describe("binance stream helpers", () => {
  it("builds raw stream URL", () => {
    expect(buildStreamUrl("wss://stream.binance.com:9443/ws/", "solusdt@miniTicker")).toBe(
      "wss://stream.binance.com:9443/ws/solusdt@miniTicker",
    );
  });

  it("parses miniTicker payload", () => {
    const tick = parsePricePayload({
      e: "24hrMiniTicker",
      E: 1760000000000,
      s: "SOLUSDT",
      c: "119.55",
    });

    expect(tick.symbol).toBe("SOLUSDT");
    expect(tick.price).toBe(119.55);
  });

  it("parses ticker payload", () => {
    const tick = parsePricePayload({
      e: "24hrTicker",
      E: 1760000000000,
      s: "SOLUSDT",
      c: "120.01",
    });

    expect(tick.price).toBe(120.01);
  });

  it("rejects invalid prices", () => {
    expect(() =>
      parsePricePayload({
        e: "24hrMiniTicker",
        E: 1760000000000,
        s: "SOLUSDT",
        c: "0",
      }),
    ).toThrow("invalid Binance price");
  });
});
