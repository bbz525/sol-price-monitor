import WebSocket from "ws";
import { z } from "zod";
import type { PriceTick } from "./types.js";

const miniTickerPayloadSchema = z.object({
  e: z.literal("24hrMiniTicker"),
  E: z.number(),
  s: z.string(),
  c: z.string(),
});

const tickerPayloadSchema = z.object({
  e: z.literal("24hrTicker"),
  E: z.number(),
  s: z.string(),
  c: z.string(),
});

export type PriceStreamOptions = {
  url: string;
  symbol: string;
  staleMessageMs: number;
  onTick: (tick: PriceTick) => Promise<void>;
  onLog?: (event: string, details?: Record<string, unknown>) => void;
};

export class BinancePriceStream {
  private readonly options: PriceStreamOptions;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private stopped = false;
  private staleTimer: NodeJS.Timeout | null = null;
  private rotationTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;

  constructor(options: PriceStreamOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }

    this.options.onLog?.("binance_connecting", { url: this.options.url });
    const ws = new WebSocket(this.options.url);
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempt = 0;
      this.lastMessageAt = Date.now();
      this.options.onLog?.("binance_connected");
      this.startTimers();
    });

    ws.on("ping", (data) => {
      ws.pong(data);
    });

    ws.on("message", (data) => {
      void this.handleMessage(data).catch((error: unknown) => {
        this.options.onLog?.("binance_message_error", { error: errorMessage(error) });
      });
    });

    ws.on("error", (error) => {
      this.options.onLog?.("binance_error", { error: error.message });
    });

    ws.on("close", (code, reason) => {
      this.clearTimers();
      this.options.onLog?.("binance_closed", {
        code,
        reason: reason.toString(),
      });
      this.scheduleReconnect();
    });
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    this.lastMessageAt = Date.now();
    const raw = JSON.parse(data.toString()) as unknown;

    if (isServerShutdown(raw)) {
      this.options.onLog?.("binance_server_shutdown");
      this.ws?.close();
      return;
    }

    const parsed = parsePricePayload(raw);
    if (parsed.symbol !== this.options.symbol) {
      return;
    }

    await this.options.onTick(parsed);
  }

  private startTimers(): void {
    this.clearTimers();
    this.staleTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > this.options.staleMessageMs) {
        this.options.onLog?.("binance_stale_connection", {
          lastMessageAt: new Date(this.lastMessageAt).toISOString(),
        });
        this.ws?.terminate();
      }
    }, Math.min(this.options.staleMessageMs, 30_000));

    this.rotationTimer = setTimeout(() => {
      this.options.onLog?.("binance_scheduled_rotation");
      this.ws?.close();
    }, 23 * 60 * 60 * 1000 + 50 * 60 * 1000);
  }

  private clearTimers(): void {
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }
    if (this.rotationTimer) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }

    this.reconnectAttempt += 1;
    const baseDelayMs = Math.min(60_000, 1000 * 2 ** Math.min(this.reconnectAttempt, 6));
    const jitterMs = Math.floor(Math.random() * 500);
    const delayMs = baseDelayMs + jitterMs;
    this.options.onLog?.("binance_reconnect_scheduled", { delayMs });
    setTimeout(() => this.connect(), delayMs);
  }
}

export function buildStreamUrl(baseUrl: string, streamName: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${streamName}`;
}

export function parsePricePayload(raw: unknown): PriceTick {
  const parsed = miniTickerPayloadSchema.safeParse(raw);
  const payload = parsed.success ? parsed.data : tickerPayloadSchema.parse(raw);
  const price = Number(payload.c);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`invalid Binance price: ${payload.c}`);
  }

  return {
    symbol: payload.s.toUpperCase(),
    price,
    eventTime: new Date(payload.E),
  };
}

function isServerShutdown(raw: unknown): boolean {
  return Boolean(raw && typeof raw === "object" && "e" in raw && raw.e === "serverShutdown");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
