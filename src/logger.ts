import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "supabaseServiceRoleKey",
      "feishuWebhookUrl",
      "feishuWebhookSecret",
      "*.supabaseServiceRoleKey",
      "*.feishuWebhookUrl",
      "*.feishuWebhookSecret"
    ],
    censor: "[redacted]"
  }
});
