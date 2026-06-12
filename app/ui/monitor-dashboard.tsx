"use client";

import { Activity, Bell, CheckCircle2, RefreshCw, Save, ShieldAlert, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type MonitorConfig = {
  symbol: string;
  threshold_price: string | number;
  quote_asset: string;
  enabled: boolean;
  alert_channel: string;
  updated_at: string;
};

type MonitorState = {
  symbol: string;
  last_price: string | number | null;
  last_status: "above" | "below" | null;
  last_event_at: string | null;
  last_alert_at: string | null;
  updated_at: string;
  worker_id: string | null;
};

type AlertEvent = {
  id: number;
  symbol: string;
  alert_type: "breach" | "recovery";
  price: string | number;
  threshold_price: string | number;
  delivery_status: "pending" | "sent" | "failed";
  created_at: string;
  sent_at: string | null;
};

type MonitorPayload = {
  configs: MonitorConfig[];
  states: MonitorState[];
  alerts: AlertEvent[];
};

const tokenKey = "sol-monitor-admin-token";

export function MonitorDashboard() {
  const [token, setToken] = useState("");
  const [data, setData] = useState<MonitorPayload | null>(null);
  const [symbol, setSymbol] = useState("SOLUSDT");
  const [thresholdPrice, setThresholdPrice] = useState("120");
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("准备就绪");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedToken = window.localStorage.getItem(tokenKey) ?? "";
    setToken(savedToken);
    void load(savedToken);
  }, []);

  const stateBySymbol = useMemo(() => {
    const map = new Map<string, MonitorState>();
    for (const state of data?.states ?? []) {
      map.set(state.symbol, state);
    }
    return map;
  }, [data]);

  const activeConfig = data?.configs?.[0] ?? null;
  const activeState = activeConfig ? stateBySymbol.get(activeConfig.symbol) ?? null : null;

  async function load(nextToken = token) {
    setLoading(true);
    try {
      const response = await fetch("/api/monitor", {
        headers: nextToken ? { "x-admin-token": nextToken } : {},
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "读取失败");
      }
      setData(payload);
      const firstConfig = payload.configs?.[0];
      if (firstConfig) {
        setSymbol(firstConfig.symbol);
        setThresholdPrice(String(Number(firstConfig.threshold_price)));
        setEnabled(firstConfig.enabled);
      }
      setStatus("已同步最新状态");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    try {
      window.localStorage.setItem(tokenKey, token);
      const response = await fetch("/api/monitor", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(token ? { "x-admin-token": token } : {}),
        },
        body: JSON.stringify({ symbol, thresholdPrice: Number(thresholdPrice), enabled }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "保存失败");
      }
      setStatus("配置已保存，下一次价格 tick 会使用新阈值");
      await load(token);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="header">
        <div>
          <p className="eyebrow">Binance Spot Monitor</p>
          <h1>SOL 价格监控配置</h1>
        </div>
        <button className="iconButton" type="button" onClick={() => void load()} disabled={loading} title="刷新">
          <RefreshCw size={18} />
        </button>
      </section>

      <section className="statusGrid">
        <Metric icon={<Activity size={18} />} label="当前价格" value={formatPrice(activeState?.last_price)} />
        <Metric icon={<ShieldAlert size={18} />} label="阈值" value={formatPrice(activeConfig?.threshold_price)} />
        <Metric icon={<Wifi size={18} />} label="状态" value={activeState?.last_status ?? "-"} />
        <Metric icon={<Bell size={18} />} label="最近告警" value={formatTime(activeState?.last_alert_at)} />
      </section>

      <section className="workspace">
        <form className="panel" onSubmit={save}>
          <div className="panelHeader">
            <h2>参数</h2>
            <span className={enabled ? "pill ok" : "pill muted"}>{enabled ? "启用" : "暂停"}</span>
          </div>

          <label>
            <span>管理令牌</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ADMIN_TOKEN"
              autoComplete="current-password"
            />
          </label>

          <label>
            <span>交易对</span>
            <input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} />
          </label>

          <label>
            <span>跌破提醒价格</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={thresholdPrice}
              onChange={(event) => setThresholdPrice(event.target.value)}
            />
          </label>

          <label className="switchRow">
            <span>监控开关</span>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          </label>

          <button className="primary" type="submit" disabled={loading}>
            <Save size={17} />
            保存配置
          </button>
          <p className="formStatus">{status}</p>
        </form>

        <section className="panel">
          <div className="panelHeader">
            <h2>运行状态</h2>
            <CheckCircle2 size={18} />
          </div>
          <dl className="details">
            <div>
              <dt>Worker</dt>
              <dd>{activeState?.worker_id ?? "-"}</dd>
            </div>
            <div>
              <dt>最近 tick</dt>
              <dd>{formatTime(activeState?.last_event_at)}</dd>
            </div>
            <div>
              <dt>配置更新</dt>
              <dd>{formatTime(activeConfig?.updated_at)}</dd>
            </div>
            <div>
              <dt>状态更新</dt>
              <dd>{formatTime(activeState?.updated_at)}</dd>
            </div>
          </dl>
        </section>
      </section>

      <section className="panel">
        <div className="panelHeader">
          <h2>最近告警</h2>
        </div>
        <div className="table">
          <div className="row head">
            <span>类型</span>
            <span>价格</span>
            <span>阈值</span>
            <span>发送</span>
            <span>时间</span>
          </div>
          {(data?.alerts ?? []).map((alert) => (
            <div className="row" key={alert.id}>
              <span>{alert.alert_type}</span>
              <span>{formatPrice(alert.price)}</span>
              <span>{formatPrice(alert.threshold_price)}</span>
              <span>{alert.delivery_status}</span>
              <span>{formatTime(alert.created_at)}</span>
            </div>
          ))}
          {data?.alerts?.length === 0 ? <p className="empty">暂无告警记录</p> : null}
        </div>
      </section>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="metric">
      <div className="metricIcon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatPrice(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return "-";
  }
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
