# 远程部署

这个项目的监控核心是常驻 Worker，不适合部署到 Vercel Functions 或 Vercel Cron。推荐部署到支持长进程的远程运行环境：Render Background Worker、Railway Service、Fly.io Machine、VPS 或任意 Docker Host。

## 环境变量

远程平台只需要配置运行时环境变量，不要上传 `.env` 文件：

```text
SYMBOL=SOLUSDT
PRICE_THRESHOLD=120
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
FEISHU_MODE=direct
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_RECEIVE_ID_TYPE=open_id
FEISHU_RECEIVE_ID=...
BINANCE_WS_BASE_URL=wss://data-stream.binance.vision/ws
PRICE_STREAM=miniTicker
WORKER_ID=remote-worker-1
STALE_MESSAGE_SECONDS=90
```

`SUPABASE_SERVICE_ROLE_KEY` 和 `FEISHU_APP_SECRET` 必须只放在远程平台的 secret/env 管理里，不要提交到 Git。

`BINANCE_WS_BASE_URL` 推荐使用 `wss://data-stream.binance.vision/ws`。在腾讯云上海轻量服务器实测，`wss://stream.binance.com:9443/ws` 可能反复以 `1006` 关闭连接；切换到 market-data-only endpoint 后可以稳定收到 `SOLUSDT` miniTicker。

## Docker 部署

构建镜像：

```bash
docker build -t sol-price-monitor .
```

运行：

```bash
docker run --env-file .env --name sol-price-monitor sol-price-monitor
```

生产环境建议在云平台用环境变量面板配置，不使用 `--env-file`。

## Render

使用 Background Worker 类型：

```text
Environment: Docker
Dockerfile Path: ./Dockerfile
Start Command: 留空，使用 Dockerfile CMD
```

配置所有环境变量后部署。保持单实例运行，避免多实例重复消费同一价格流。

## Railway

创建新服务并连接仓库，Railway 会使用 Dockerfile 构建。配置所有环境变量后部署。保持 replica 数量为 1。

## Fly.io

可以用 Dockerfile 创建单实例 app。确保没有配置对外 HTTP 端口要求；这是一个纯后台 Worker。

## VPS

在服务器安装 Docker 后：

```bash
git clone <repo-url>
cd <repo>
docker build -t sol-price-monitor .
docker run -d --restart unless-stopped --env-file .env --name sol-price-monitor sol-price-monitor
```

## 腾讯云 Lighthouse + systemd

这次实际部署使用腾讯云轻量应用服务器的 OrcaTerm 远程终端，未在本机 macOS 安装 LaunchAgent 或本地守护进程。

服务器侧步骤：

```bash
dnf install -y nodejs npm
mkdir -p /opt/sol-price-monitor
tar -xzf /tmp/sol-price-monitor-src.tar.gz -C /opt/sol-price-monitor --strip-components=1
cd /opt/sol-price-monitor
npm ci
npm run build
```

把真实环境变量写到 `/opt/sol-price-monitor/.env` 后，锁定权限：

```bash
chmod 600 /opt/sol-price-monitor/.env
```

创建 `/etc/systemd/system/sol-price-monitor.service`：

```ini
[Unit]
Description=SOL price monitor worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/sol-price-monitor
EnvironmentFile=/opt/sol-price-monitor/.env
ExecStart=/usr/bin/node /opt/sol-price-monitor/dist/index.js
Restart=always
RestartSec=10
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

启用并检查：

```bash
systemctl daemon-reload
systemctl enable --now sol-price-monitor
systemctl is-active sol-price-monitor
journalctl -u sol-price-monitor --since "2 minutes ago" --no-pager
```

正常日志应包含 `starting price monitor`、`binance_connected` 和持续的 `price tick recorded`。

## 验证

部署后检查三件事：

- Worker 日志出现 `starting price monitor` 和 Binance WebSocket 连接日志。
- Supabase `price_monitor_states.updated_at` 持续更新。
- 手动把 `PRICE_THRESHOLD` 临时设到高于当前 SOL 价格，只触发一次个人飞书提醒；验证后改回真实阈值。

## 回滚

停止远程 Worker 或将实例数改为 0。Supabase 状态会保留，重新启动后不会因为重启而重复发送历史告警。
