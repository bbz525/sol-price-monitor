#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/sol-price-monitor}"
REPO_URL="${REPO_URL:-https://github.com/bbz525/sol-price-monitor.git}"
BRANCH="${BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-sol-price-monitor}"

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "missing $APP_DIR/.env" >&2
  exit 1
fi

if [ ! -d .git ]; then
  git init
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

chmod 600 .env
npm ci
npm run build

systemctl restart "$SERVICE_NAME"
systemctl is-active "$SERVICE_NAME"
journalctl -u "$SERVICE_NAME" --since "2 minutes ago" --no-pager | tail -n 40
