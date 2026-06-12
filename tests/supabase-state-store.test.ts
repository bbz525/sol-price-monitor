import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseStateStore } from "../src/supabase-state-store.js";

function createStore(client: unknown) {
  return new SupabaseStateStore(
    {
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "secret",
      symbol: "SOLUSDT",
      thresholdPrice: 120,
      workerId: "test-worker",
    },
    client as SupabaseClient,
  );
}

describe("supabase state store", () => {
  it("upserts monitor config", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: vi.fn(() => ({ upsert })),
    };

    await createStore(client).ensureConfig();

    expect(client.from).toHaveBeenCalledWith("price_monitor_configs");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: "SOLUSDT",
        threshold_price: 120,
      }),
      { onConflict: "symbol" },
    );
  });

  it("returns pending alert from RPC result", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            symbol: "SOLUSDT",
            current_status: "below",
            alert_event_id: 10,
            alert_type: "breach",
            threshold_price: "120.00000000",
          },
        ],
        error: null,
      }),
    };

    const alert = await createStore(client).recordPriceTick(119, new Date("2026-06-11T00:00:00Z"));

    expect(alert).toMatchObject({
      eventId: 10,
      symbol: "SOLUSDT",
      alertType: "breach",
      price: 119,
      thresholdPrice: 120,
      status: "below",
    });
  });

  it("returns null when RPC produces no alert event", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            symbol: "SOLUSDT",
            current_status: "above",
            alert_event_id: null,
            alert_type: null,
            threshold_price: "120.00000000",
          },
        ],
        error: null,
      }),
    };

    await expect(
      createStore(client).recordPriceTick(121, new Date("2026-06-11T00:00:00Z")),
    ).resolves.toBeNull();
  });

  it("throws readable errors when RPC fails", async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "database unavailable" },
      }),
    };

    await expect(
      createStore(client).recordPriceTick(119, new Date("2026-06-11T00:00:00Z")),
    ).rejects.toThrow("failed to record price tick: database unavailable");
  });

  it("marks delivery success and failure", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const store = createStore({ rpc });

    await store.markAlertSent(1);
    await store.markAlertFailed(2, "x".repeat(1200));

    expect(rpc).toHaveBeenNthCalledWith(1, "mark_price_monitor_alert_sent", {
      p_event_id: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "mark_price_monitor_alert_failed", {
      p_event_id: 2,
      p_delivery_error: "x".repeat(1000),
    });
  });
});
