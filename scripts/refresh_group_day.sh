#!/usr/bin/env bash
set -euo pipefail

SITE_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE_REPO="$SITE_REPO/../dsh-archive"
WECHAT_CONFIG="$SOURCE_REPO/.local/wechat-automation/config.local.json"
WECHAT_RUNTIME="$SOURCE_REPO/.local/wechat-cli"
RUNTIME_DIR="$SITE_REPO/.local/runtime"
RAW_MESSAGES="$RUNTIME_DIR/raw-messages.local.json"
TARGET_DATE="${1:-$(TZ=Asia/Shanghai python3 -c 'import datetime as d; print((d.date.today()-d.timedelta(days=1)).isoformat())')}"
TODAY="$(TZ=Asia/Shanghai date +%F)"

if [[ ! "$TARGET_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "日期必须是 YYYY-MM-DD。" >&2
  exit 1
fi
if [[ ! -f "$WECHAT_CONFIG" || ! -x "$WECHAT_RUNTIME/.venv/bin/python" ]]; then
  echo "本机微信采集配置或运行环境缺失；未修改线上数据。" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
cd "$SOURCE_REPO"
PYTHONPATH="$WECHAT_RUNTIME" "$WECHAT_RUNTIME/.venv/bin/python" \
  scripts/extract_wechat_group.py \
  --config "$WECHAT_CONFIG" \
  --output "$RAW_MESSAGES" >/dev/null

cd "$SITE_REPO"
node scripts/export_group_day.mjs --input "$RAW_MESSAGES" --date "$TARGET_DATE"
SYNC_ARGS=(--date "$TARGET_DATE")
if [[ "$TARGET_DATE" == "$TODAY" ]]; then
  SYNC_ARGS+=(--partial-current-day)
fi
node scripts/sync_group_data.mjs "${SYNC_ARGS[@]}"

if [[ "$TARGET_DATE" == "$TODAY" ]]; then
  echo "群聊今日实时版已验证并激活：${TARGET_DATE}（未完结）"
else
  echo "群聊自然日已验证并激活：$TARGET_DATE"
fi
