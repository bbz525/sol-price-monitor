import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AlertType, PendingAlert, PriceStatus } from "./types.js";

export type PriceTickResult = {
  symbol: string;
  current_status: PriceStatus;
  alert_event_id: number | null;
  alert_type: AlertType | null;
  threshold_price: string | number;
};

export type StateStoreOptions = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  symbol: string;
  thresholdPrice: number;
  workerId: string;
};

export class SupabaseStateStore {
  private readonly client: SupabaseClient;
  private readonly options: StateStoreOptions;

  constructor(options: StateStoreOptions, client?: SupabaseClient) {
    this.options = options;
    this.client =
      client ??
      createClient(options.supabaseUrl, options.supabaseServiceRoleKey, {
        auth: { persistSession: false },
      });
  }

  async ensureConfig(): Promise<void> {
    const { error } = await this.client.from("price_monitor_configs").upsert(
      {
        symbol: this.options.symbol,
        threshold_price: this.options.thresholdPrice,
        enabled: true,
        alert_channel: "feishu",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "symbol", ignoreDuplicates: true },
    );

    if (error) {
      throw new Error(`failed to upsert monitor config: ${error.message}`);
    }
  }

  async recordPriceTick(price: number, eventTime: Date): Promise<PendingAlert | null> {
    const { data, error } = await this.client.rpc("record_price_monitor_tick", {
      p_symbol: this.options.symbol,
      p_price: price,
      p_threshold_price: this.options.thresholdPrice,
      p_worker_id: this.options.workerId,
      p_event_at: eventTime.toISOString(),
    });

    if (error) {
      throw new Error(`failed to record price tick: ${error.message}`);
    }

    const result = Array.isArray(data) ? (data[0] as PriceTickResult | undefined) : undefined;
    if (!result || result.alert_event_id === null || result.alert_type === null) {
      return null;
    }

    return {
      eventId: result.alert_event_id,
      symbol: result.symbol,
      alertType: result.alert_type,
      price,
      thresholdPrice: Number(result.threshold_price),
      status: result.current_status,
      eventTime,
    };
  }

  async markAlertSent(eventId: number): Promise<void> {
    const { error } = await this.client.rpc("mark_price_monitor_alert_sent", {
      p_event_id: eventId,
    });

    if (error) {
      throw new Error(`failed to mark alert sent: ${error.message}`);
    }
  }

  async markAlertFailed(eventId: number, deliveryError: string): Promise<void> {
    const { error } = await this.client.rpc("mark_price_monitor_alert_failed", {
      p_event_id: eventId,
      p_delivery_error: deliveryError.slice(0, 1000),
    });

    if (error) {
      throw new Error(`failed to mark alert failed: ${error.message}`);
    }
  }
}
