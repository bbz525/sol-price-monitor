import { z } from "zod";
import { adminSupabase, assertAdminToken } from "../../../web/admin-supabase.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configInput = z.object({
  symbol: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  thresholdPrice: z.coerce.number().positive(),
  enabled: z.boolean(),
});

export async function GET(request: Request) {
  const unauthorized = assertAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const { data: configs, error: configError } = await adminSupabase
    .from("price_monitor_configs")
    .select("symbol, threshold_price, quote_asset, enabled, alert_channel, updated_at")
    .order("symbol", { ascending: true });

  if (configError) {
    return Response.json({ error: configError.message }, { status: 500 });
  }

  const { data: states, error: stateError } = await adminSupabase
    .from("price_monitor_states")
    .select("symbol, last_price, last_status, last_event_at, last_alert_at, updated_at, worker_id")
    .order("symbol", { ascending: true });

  if (stateError) {
    return Response.json({ error: stateError.message }, { status: 500 });
  }

  const { data: alerts, error: alertError } = await adminSupabase
    .from("price_monitor_alert_events")
    .select("id, symbol, alert_type, price, threshold_price, delivery_status, created_at, sent_at")
    .order("created_at", { ascending: false })
    .limit(8);

  if (alertError) {
    return Response.json({ error: alertError.message }, { status: 500 });
  }

  return Response.json({ configs, states, alerts });
}

export async function PUT(request: Request) {
  const unauthorized = assertAdminToken(request);
  if (unauthorized) {
    return unauthorized;
  }

  const parsed = configInput.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "invalid input" }, { status: 400 });
  }

  const { symbol, thresholdPrice, enabled } = parsed.data;
  const { data, error } = await adminSupabase
    .from("price_monitor_configs")
    .upsert(
      {
        symbol,
        threshold_price: thresholdPrice,
        quote_asset: "USDT",
        enabled,
        alert_channel: "feishu",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "symbol" },
    )
    .select("symbol, threshold_price, quote_asset, enabled, alert_channel, updated_at")
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ config: data });
}
