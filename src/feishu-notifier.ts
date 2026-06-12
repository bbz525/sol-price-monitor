import { createHmac } from "node:crypto";
import type { Notifier, PendingAlert } from "./types.js";

export type FeishuNotifierOptions = {
  webhookUrl: string;
  secret?: string | null;
  fetchImpl?: typeof fetch;
};

export type FeishuDirectNotifierOptions = {
  appId: string;
  appSecret: string;
  receiveIdType: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
  receiveId: string;
  fetchImpl?: typeof fetch;
};

export class FeishuNotifier implements Notifier {
  private readonly webhookUrl: string;
  private readonly secret: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FeishuNotifierOptions) {
    this.webhookUrl = options.webhookUrl;
    this.secret = options.secret ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(alert: PendingAlert): Promise<void> {
    const body = this.buildPayload(alert);
    const response = await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Feishu webhook failed with HTTP ${response.status}: ${truncate(text)}`);
    }

    const result = parseJson(text);
    if (result && typeof result === "object" && "code" in result && result.code !== 0) {
      throw new Error(`Feishu webhook rejected message: ${truncate(text)}`);
    }
  }

  private buildPayload(alert: PendingAlert): Record<string, unknown> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedFields = this.secret
      ? {
          timestamp,
          sign: signFeishuRequest(timestamp, this.secret),
        }
      : {};

    return {
      ...signedFields,
      msg_type: "text",
      content: {
        text: formatAlertMessage(alert),
      },
    };
  }
}

export class FeishuDirectNotifier implements Notifier {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly receiveIdType: FeishuDirectNotifierOptions["receiveIdType"];
  private readonly receiveId: string;
  private readonly fetchImpl: typeof fetch;
  private cachedToken: { token: string; expiresAtMs: number } | null = null;

  constructor(options: FeishuDirectNotifierOptions) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.receiveIdType = options.receiveIdType;
    this.receiveId = options.receiveId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send(alert: PendingAlert): Promise<void> {
    const token = await this.getTenantAccessToken();
    const response = await this.fetchImpl(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(this.receiveIdType)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          receive_id: this.receiveId,
          msg_type: "text",
          content: JSON.stringify({ text: formatAlertMessage(alert) }),
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Feishu direct message failed with HTTP ${response.status}: ${truncate(text)}`);
    }

    const result = parseJson(text);
    if (result && typeof result === "object" && "code" in result && result.code !== 0) {
      throw new Error(`Feishu direct message rejected: ${truncate(text)}`);
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAtMs > now + 60_000) {
      return this.cachedToken.token;
    }

    const response = await this.fetchImpl(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Feishu token request failed with HTTP ${response.status}: ${truncate(text)}`);
    }

    const result = parseJson(text);
    if (!result || typeof result !== "object" || !("code" in result) || result.code !== 0) {
      throw new Error(`Feishu token request rejected: ${truncate(text)}`);
    }

    const token = "tenant_access_token" in result ? result.tenant_access_token : null;
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Feishu token response did not include tenant_access_token");
    }

    const expireSeconds = "expire" in result && typeof result.expire === "number" ? result.expire : 3600;
    this.cachedToken = {
      token,
      expiresAtMs: now + expireSeconds * 1000,
    };

    return token;
  }
}

export function signFeishuRequest(timestamp: string, secret: string): string {
  return createHmac("sha256", `${timestamp}\n${secret}`).digest("base64");
}

export function formatAlertMessage(alert: PendingAlert): string {
  const title = alert.alertType === "breach" ? "价格跌破提醒" : "价格恢复提醒";
  const relation = alert.alertType === "breach" ? "低于" : "回到不低于";

  return [
    `[${title}]`,
    `交易对: ${alert.symbol}`,
    `当前价: ${alert.price}`,
    `阈值: ${alert.thresholdPrice}`,
    `状态: ${alert.status}`,
    `说明: 当前价格已${relation}阈值`,
    `时间: ${alert.eventTime.toISOString()}`,
    "数据源: Binance Spot WebSocket",
  ].join("\n");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function truncate(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
