create table if not exists public.price_monitor_configs (
  symbol text primary key,
  threshold_price numeric(20, 8) not null check (threshold_price > 0),
  quote_asset text not null default 'USDT',
  enabled boolean not null default true,
  alert_channel text not null default 'feishu' check (alert_channel in ('feishu')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (symbol = upper(symbol)),
  check (quote_asset = upper(quote_asset))
);

create table if not exists public.price_monitor_states (
  symbol text primary key references public.price_monitor_configs(symbol) on delete cascade,
  last_price numeric(20, 8) check (last_price is null or last_price > 0),
  last_status text check (last_status in ('above', 'below')),
  last_event_at timestamptz,
  last_alert_at timestamptz,
  alert_version bigint not null default 0 check (alert_version >= 0),
  worker_id text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.price_monitor_alert_events (
  id bigserial primary key,
  symbol text not null references public.price_monitor_configs(symbol) on delete cascade,
  alert_type text not null check (alert_type in ('breach', 'recovery')),
  price numeric(20, 8) not null check (price > 0),
  threshold_price numeric(20, 8) not null check (threshold_price > 0),
  previous_status text check (previous_status in ('above', 'below')),
  next_status text not null check (next_status in ('above', 'below')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sent', 'failed')),
  delivery_error text,
  worker_id text,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists idx_price_monitor_configs_enabled
  on public.price_monitor_configs(enabled)
  where enabled = true;

create index if not exists idx_price_monitor_states_locked_until
  on public.price_monitor_states(locked_until);

create index if not exists idx_price_monitor_states_last_event_at
  on public.price_monitor_states(last_event_at desc);

create index if not exists idx_price_monitor_alert_events_symbol_created_at
  on public.price_monitor_alert_events(symbol, created_at desc);

create index if not exists idx_price_monitor_alert_events_delivery_status
  on public.price_monitor_alert_events(delivery_status, created_at)
  where delivery_status in ('pending', 'failed');

alter table public.price_monitor_configs enable row level security;
alter table public.price_monitor_states enable row level security;
alter table public.price_monitor_alert_events enable row level security;

revoke all on public.price_monitor_configs from anon, authenticated;
revoke all on public.price_monitor_states from anon, authenticated;
revoke all on public.price_monitor_alert_events from anon, authenticated;
revoke all on sequence public.price_monitor_alert_events_id_seq from anon, authenticated;

grant select, insert, update, delete on public.price_monitor_configs to service_role;
grant select, insert, update, delete on public.price_monitor_states to service_role;
grant select, insert, update, delete on public.price_monitor_alert_events to service_role;
grant usage, select on sequence public.price_monitor_alert_events_id_seq to service_role;

create or replace function public.set_price_monitor_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_price_monitor_configs_updated_at on public.price_monitor_configs;
create trigger set_price_monitor_configs_updated_at
before update on public.price_monitor_configs
for each row execute function public.set_price_monitor_updated_at();

drop trigger if exists set_price_monitor_states_updated_at on public.price_monitor_states;
create trigger set_price_monitor_states_updated_at
before update on public.price_monitor_states
for each row execute function public.set_price_monitor_updated_at();

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
  on conflict on constraint price_monitor_configs_pkey do update
    set threshold_price = excluded.threshold_price,
        updated_at = now();

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

create or replace function public.mark_price_monitor_alert_sent(p_event_id bigint)
returns void
language plpgsql
security invoker
as $$
declare
  v_symbol text;
begin
  update public.price_monitor_alert_events
  set delivery_status = 'sent',
      delivery_error = null,
      sent_at = now()
  where id = p_event_id
  returning symbol into v_symbol;

  if v_symbol is not null then
    update public.price_monitor_states
    set last_alert_at = now()
    where price_monitor_states.symbol = v_symbol;
  end if;
end;
$$;

create or replace function public.mark_price_monitor_alert_failed(
  p_event_id bigint,
  p_delivery_error text
)
returns void
language sql
security invoker
as $$
  update public.price_monitor_alert_events
  set delivery_status = 'failed',
      delivery_error = left(p_delivery_error, 1000)
  where id = p_event_id;
$$;

revoke all on function public.set_price_monitor_updated_at() from public, anon, authenticated;
revoke all on function public.record_price_monitor_tick(text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_price_monitor_alert_sent(bigint) from public, anon, authenticated;
revoke all on function public.mark_price_monitor_alert_failed(bigint, text) from public, anon, authenticated;

grant execute on function public.record_price_monitor_tick(text, numeric, numeric, text, timestamptz) to service_role;
grant execute on function public.mark_price_monitor_alert_sent(bigint) to service_role;
grant execute on function public.mark_price_monitor_alert_failed(bigint, text) to service_role;
