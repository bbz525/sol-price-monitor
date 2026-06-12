import { describe, expect, it, vi } from "vitest";
import {
  FeishuDirectNotifier,
  FeishuNotifier,
  formatAlertMessage,
  signFeishuRequest,
} from "../src/feishu-notifier.js";
import type { PendingAlert } from "../src/types.js";

const alert: PendingAlert = {
  eventId: 1,
  symbol: "SOLUSDT",
  alertType: "breach",
  price: 119,
  thresholdPrice: 120,
  status: "below",
  eventTime: new Date("2026-06-11T00:00:00.000Z"),
};

describe("feishu notifier", () => {
  it("formats alert messages", () => {
    expect(formatAlertMessage(alert)).toContain("价格跌破提醒");
    expect(formatAlertMessage(alert)).toContain("SOLUSDT");
    expect(formatAlertMessage(alert)).toContain("119");
  });

  it("signs requests deterministically", () => {
    expect(signFeishuRequest("1234567890", "secret")).toBe(
      signFeishuRequest("1234567890", "secret"),
    );
  });

  it("sends text payload to webhook", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ code: 0, msg: "ok" }), { status: 200 }),
    );
    const notifier = new FeishuNotifier({
      webhookUrl: "https://example.com/hook",
      fetchImpl,
    });

    await notifier.send(alert);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      msg_type: "text",
    });
  });

  it("throws on webhook failure", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 500 }));
    const notifier = new FeishuNotifier({
      webhookUrl: "https://example.com/hook",
      fetchImpl,
    });

    await expect(notifier.send(alert)).rejects.toThrow("Feishu webhook failed");
  });

  it("sends direct message with tenant token", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: "ok", data: { message_id: "om_xxx" } }), {
          status: 200,
        }),
      );

    const notifier = new FeishuDirectNotifier({
      appId: "cli_a",
      appSecret: "secret",
      receiveIdType: "open_id",
      receiveId: "ou_xxx",
      fetchImpl,
    });

    await notifier.send(alert);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [messageUrl, messageInit] = fetchImpl.mock.calls[1]!;
    expect(String(messageUrl)).toContain("receive_id_type=open_id");
    expect(JSON.parse(String(messageInit?.body))).toMatchObject({
      receive_id: "ou_xxx",
      msg_type: "text",
    });
  });
});
