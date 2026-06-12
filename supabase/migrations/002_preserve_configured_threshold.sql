create or replace function public.record_price_monitor_tick(
  p_symbol text,
  p_price numeric,
  p_threshold_price numeric,
  p_worker_id text,
  p_event_at timestamptz
)
returns table (
  symbol text,
  current_status text,
  alert_event_id bigint,
  alert_type text,
  threshold_price numeric
)
language plpgsql
security invoker
as $$
declare
  v_symbol text := upper(p_symbol);
  v_previous_status text;
  v_next_status text;
  v_enabled boolean;
  v_threshold_price numeric;
  v_alert_version bigint;
  v_alert_type text;
  v_event_id bigint;
begin
  if p_price <= 0 then
    raise exception 'price must be positive';
  end if;

  if p_threshold_price <= 0 then
    raise exception 'threshold price must be positive';
  end if;

  insert into public.price_monitor_configs(symbol, threshold_price, enabled, alert_channel)
  values (v_symbol, p_threshold_price, true, 'feishu')
  on conflict on constraint price_monitor_configs_pkey do nothing;

  select price_monitor_configs.enabled, price_monitor_configs.threshold_price
  into v_enabled, v_threshold_price
  from public.price_monitor_configs
  where price_monitor_configs.symbol = v_symbol;

  if not v_enabled then
    return query select v_symbol, null::text, null::bigint, null::text, v_threshold_price;
    return;
  end if;

  v_next_status := case when p_price < v_threshold_price then 'below' else 'above' end;

  select last_status, alert_version
  into v_previous_status, v_alert_version
  from public.price_monitor_states
  where price_monitor_states.symbol = v_symbol
  for update;

  if not found then
    insert into public.price_monitor_states(symbol, last_price, last_status, last_event_at, worker_id)
    values (v_symbol, p_price, v_next_status, p_event_at, p_worker_id);

    return query select v_symbol, v_next_status, null::bigint, null::text, v_threshold_price;
    return;
  end if;

  if v_previous_status is not null and v_previous_status <> v_next_status then
    v_alert_type := case when v_next_status = 'below' then 'breach' else 'recovery' end;

    insert into public.price_monitor_alert_events(
      symbol,
      alert_type,
      price,
      threshold_price,
      previous_status,
      next_status,
      worker_id,
      dedupe_key
    )
    values (
      v_symbol,
      v_alert_type,
      p_price,
      v_threshold_price,
      v_previous_status,
      v_next_status,
      p_worker_id,
      v_symbol || ':' || v_previous_status || '->' || v_next_status || ':' || (v_alert_version + 1)::text
    )
    returning id into v_event_id;
  end if;

  update public.price_monitor_states
  set last_price = p_price,
      last_status = v_next_status,
      last_event_at = p_event_at,
      alert_version = alert_version + case when v_event_id is null then 0 else 1 end,
      worker_id = p_worker_id
  where price_monitor_states.symbol = v_symbol;

  return query select v_symbol, v_next_status, v_event_id, v_alert_type, v_threshold_price;
end;
$$;

revoke all on function public.record_price_monitor_tick(text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_price_monitor_tick(text, numeric, numeric, text, timestamptz) to service_role;
