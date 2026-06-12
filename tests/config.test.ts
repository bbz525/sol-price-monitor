import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const baseEnv = {
  PRICE_THRESHOLD: "120",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "secret",
  FEISHU_MODE: "webhook",
  FEISHU_WEBHOOK_URL: "https://open.feishu.cn/open-apis/bot/v2/hook/test",
};

describe("config", () => {
  it("normalizes symbol and builds stream name", () => {
    const config = loadConfig({ ...baseEnv, SYMBOL: "solusdt" });

    expect(config.symbol).toBe("SOLUSDT");
    expect(config.streamName).toBe("solusdt@miniTicker");
    expect(config.thresholdPrice).toBe(120);
  });

  it("supports full ticker stream", () => {
    const config = loadConfig({ ...baseEnv, PRICE_STREAM: "ticker" });

    expect(config.streamName).toBe("solusdt@ticker");
  });

  it("rejects missing secrets and invalid thresholds", () => {
    expect(() => loadConfig({ ...baseEnv, PRICE_THRESHOLD: "0" })).toThrow();
    expect(() => loadConfig({ PRICE_THRESHOLD: "120" })).toThrow();
  });

  it("supports direct Feishu messages", () => {
    const config = loadConfig({
      ...baseEnv,
      FEISHU_MODE: "direct",
      FEISHU_WEBHOOK_URL: "",
      FEISHU_APP_ID: "cli_a",
      FEISHU_APP_SECRET: "secret",
      FEISHU_RECEIVE_ID_TYPE: "open_id",
      FEISHU_RECEIVE_ID: "ou_xxx",
    });

    expect(config.feishuMode).toBe("direct");
    expect(config.feishuReceiveId).toBe("ou_xxx");
  });
});
