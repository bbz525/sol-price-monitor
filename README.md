# SOL 价格监控

常驻 Node.js/TypeScript Worker，用 Binance Spot WebSocket 实时监听 `SOLUSDT` 价格，状态保存到 Supabase，在跌破阈值和恢复到阈值以上时通过飞书提醒。

## 架构

```text
Binance WebSocket -> Worker -> Supabase -> Feishu
```

Vercel 不承载实时监听。后续可以用 Vercel 做只读 dashboard/API，读取 Supabase 中的状态和告警事件。

## 本地配置

```bash
cp .env.example .env
```

填写：

- `SYMBOL`: 默认 `SOLUSDT`
- `PRICE_THRESHOLD`: 触发阈值，例如 `120`
- `SUPABASE_URL`: Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY`: 服务端 secret/service role key，不要暴露到前端
- `FEISHU_MODE`: `webhook` 或 `direct`
- `FEISHU_WEBHOOK_URL`: 群自定义机器人 webhook，`FEISHU_MODE=webhook` 时必填
- `FEISHU_WEBHOOK_SECRET`: 群自定义机器人签名密钥，可留空
- `FEISHU_APP_ID`: 飞书自建应用 App ID，`FEISHU_MODE=direct` 时必填
- `FEISHU_APP_SECRET`: 飞书自建应用 App Secret，`FEISHU_MODE=direct` 时必填
- `FEISHU_RECEIVE_ID_TYPE`: 个人直发接收 ID 类型，默认 `open_id`
- `FEISHU_RECEIVE_ID`: 个人直发接收 ID，例如你的 `open_id`

## Supabase 建表

在 Supabase SQL Editor 或 CLI 中执行：

```bash
supabase db push
```

核心 migration 位于：

```text
supabase/migrations/001_create_price_monitor_tables.sql
```

表会启用 RLS，并撤销 `anon` / `authenticated` 直接访问权限。Worker 使用服务端 key 调用 RPC。

## 运行

```bash
npm install
npm run dev
```

生产环境：

```bash
npm run build
npm start
```

## 告警规则

- 首次启动只初始化状态，不发送历史告警。
- 从 `above` 变为 `below` 时发送跌破提醒。
- 持续 `below` 不重复提醒。
- 从 `below` 变为 `above` 时发送恢复提醒。
- 飞书发送结果会写入 `price_monitor_alert_events`。

## 飞书发送模式

### 群机器人 webhook

适合发到一个告警群，配置最简单：

```bash
FEISHU_MODE=webhook
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/...
FEISHU_WEBHOOK_SECRET=
```

### 个人直发

适合只发给你个人。需要飞书开放平台自建应用开启机器人能力，并给应用开通消息发送权限。Worker 会用 `APP_ID/APP_SECRET` 获取 tenant token，然后调用飞书 IM 消息接口发给 `FEISHU_RECEIVE_ID`。

```bash
FEISHU_MODE=direct
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=...
FEISHU_RECEIVE_ID_TYPE=open_id
FEISHU_RECEIVE_ID=ou_xxx
```

如果使用 `direct` 模式，不需要配置 `FEISHU_WEBHOOK_URL`。

## 部署建议

实时 Worker 推荐部署到 Render、Fly.io、Railway 或 VPS，并先配置为单实例。后续要多实例时，可以继续基于 Supabase RPC 的行锁状态迁移扩展 worker lease 和告警重试。

Vercel 适合后续托管 dashboard，不适合作为 30 秒或实时 WebSocket 监听进程。

远程部署见：

```text
docs/DEPLOYMENT.md
```

## 验证

```bash
npm test
npm run typecheck
npm run build
```

不要在日志、README 或 Git 中提交真实 Supabase key、飞书 webhook 和飞书 secret。
