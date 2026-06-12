import "./node-websocket-polyfill.js";

import { BinancePriceStream, buildStreamUrl } from "./binance-stream.js";
import { loadConfig } from "./config.js";
import { FeishuDirectNotifier, FeishuNotifier } from "./feishu-notifier.js";
import { logger } from "./logger.js";
import { SupabaseStateStore } from "./supabase-state-store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info(
    {
      symbol: config.symbol,
      thresholdPrice: config.thresholdPrice,
      priceStream: config.priceStream,
      workerId: config.workerId,
    },
    "starting price monitor",
  );

  const store = new SupabaseStateStore({
    supabaseUrl: config.supabaseUrl,
    supabaseServiceRoleKey: config.supabaseServiceRoleKey,
    symbol: config.symbol,
    thresholdPrice: config.thresholdPrice,
    workerId: config.workerId,
  });
  await store.ensureConfig();

  const notifier =
    config.feishuMode === "direct"
      ? new FeishuDirectNotifier({
          appId: config.feishuAppId,
          appSecret: config.feishuAppSecret,
          receiveIdType: config.feishuReceiveIdType,
          receiveId: config.feishuReceiveId,
        })
      : new FeishuNotifier({
          webhookUrl: config.feishuWebhookUrl,
          secret: config.feishuWebhookSecret,
        });

  const stream = new BinancePriceStream({
    url: buildStreamUrl(config.binanceWsBaseUrl, config.streamName),
    symbol: config.symbol,
    staleMessageMs: config.staleMessageMs,
    onLog: (event, details) => logger.info(details ?? {}, event),
    onTick: async (tick) => {
      const alert = await store.recordPriceTick(tick.price, tick.eventTime);
      logger.info(
        {
          symbol: tick.symbol,
          price: tick.price,
          eventTime: tick.eventTime.toISOString(),
          alertType: alert?.alertType ?? null,
        },
        "price tick recorded",
      );

      if (!alert) {
        return;
      }

      try {
        await notifier.send(alert);
        await store.markAlertSent(alert.eventId);
        logger.info({ eventId: alert.eventId, alertType: alert.alertType }, "alert sent");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ eventId: alert.eventId, error: message }, "alert delivery failed");
        await store.markAlertFailed(alert.eventId, message);
      }
    },
  });

  stream.start();

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logger.info({ signal }, "shutting down");
      stream.stop();
      process.exit(0);
    });
  }
}

main().catch((error: unknown) => {
  logger.fatal({ error: error instanceof Error ? error.message : String(error) }, "monitor crashed");
  process.exit(1);
});
