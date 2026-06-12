import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  SYMBOL: z.string().trim().min(1).default("SOLUSDT"),
  PRICE_THRESHOLD: z.coerce.number().positive(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  FEISHU_MODE: z.enum(["webhook", "direct"]).default("webhook"),
  FEISHU_WEBHOOK_URL: z.string().optional().default(""),
  FEISHU_WEBHOOK_SECRET: z.string().optional().default(""),
  FEISHU_APP_ID: z.string().optional().default(""),
  FEISHU_APP_SECRET: z.string().optional().default(""),
  FEISHU_RECEIVE_ID_TYPE: z.enum(["open_id", "user_id", "union_id", "email", "chat_id"]).default("open_id"),
  FEISHU_RECEIVE_ID: z.string().optional().default(""),
  BINANCE_WS_BASE_URL: z.string().url().default("wss://data-stream.binance.vision/ws"),
  PRICE_STREAM: z.enum(["miniTicker", "ticker"]).default("miniTicker"),
  WORKER_ID: z.string().trim().min(1).default("local-worker"),
  STALE_MESSAGE_SECONDS: z.coerce.number().int().positive().default(90),
}).superRefine((env, ctx) => {
  if (env.FEISHU_MODE === "webhook" && !isConfigured(env.FEISHU_WEBHOOK_URL)) {
    ctx.addIssue({
      code: "custom",
      path: ["FEISHU_WEBHOOK_URL"],
      message: "FEISHU_WEBHOOK_URL is required when FEISHU_MODE=webhook",
    });
  }

  if (env.FEISHU_MODE === "direct") {
    for (const key of ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_RECEIVE_ID"] as const) {
      if (!isConfigured(env[key])) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when FEISHU_MODE=direct`,
        });
      }
    }
  }
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.parse(env);
  const symbol = parsed.SYMBOL.toUpperCase();
  const streamName = `${symbol.toLowerCase()}@${parsed.PRICE_STREAM}`;

  return {
    symbol,
    thresholdPrice: parsed.PRICE_THRESHOLD,
    supabaseUrl: parsed.SUPABASE_URL,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    feishuMode: parsed.FEISHU_MODE,
    feishuWebhookUrl: parsed.FEISHU_WEBHOOK_URL,
    feishuWebhookSecret: parsed.FEISHU_WEBHOOK_SECRET || null,
    feishuAppId: parsed.FEISHU_APP_ID,
    feishuAppSecret: parsed.FEISHU_APP_SECRET,
    feishuReceiveIdType: parsed.FEISHU_RECEIVE_ID_TYPE,
    feishuReceiveId: parsed.FEISHU_RECEIVE_ID,
    binanceWsBaseUrl: parsed.BINANCE_WS_BASE_URL.replace(/\/+$/, ""),
    priceStream: parsed.PRICE_STREAM,
    streamName,
    workerId: parsed.WORKER_ID,
    staleMessageMs: parsed.STALE_MESSAGE_SECONDS * 1000,
  };
}

function isConfigured(value: string): boolean {
  return value.trim().length > 0 && !value.startsWith("REPLACE_WITH");
}
