#!/usr/bin/env bash
set -euo pipefail

SITE_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
node "$SITE_REPO/scripts/frozen_source_guard.mjs" "旧式网站快照" >/dev/null 2>&1 || {
  echo "DSH 数据已固定封存；旧式网站快照生成已停用。" >&2
  exit 78
}
SOURCE_REPO="$SITE_REPO/../dsh-archive"
RAW_MESSAGES="$SOURCE_REPO/evidence/wechat/raw-messages.local.json"
WECHAT_CONFIG="$SOURCE_REPO/.local/wechat-automation/config.local.json"
WECHAT_RUNTIME="$SOURCE_REPO/.local/wechat-cli"
BEIJING_DATE="$(TZ=Asia/Shanghai date +%F)"
PREVIOUS_DATE="$(TZ=Asia/Shanghai python3 -c 'import datetime as d; print((d.date.today()-d.timedelta(days=1)).isoformat())')"
OUTPUT_DIR="$SOURCE_REPO/.local/site-snapshots"
OUTPUT_FILE="$OUTPUT_DIR/$BEIJING_DATE.json"
PREVIOUS_FILE="$SITE_REPO/snapshots/$PREVIOUS_DATE.json"

if [[ ! -f "$WECHAT_CONFIG" || ! -x "$WECHAT_RUNTIME/.venv/bin/python" ]]; then
  echo "本机微信采集配置或运行环境缺失；不生成网站快照。" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_REPO/scripts/extract_wechat_group.py" || ! -f "$SOURCE_REPO/scripts/build_group_data.py" ]]; then
  echo "群聊采集或筛选脚本缺失；不生成网站快照。" >&2
  exit 1
fi
if [[ ! -d "$SITE_REPO/snapshots" ]]; then
  echo "目标网站仓库缺少 snapshots 目录；不生成网站快照。" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cd "$SOURCE_REPO"

PYTHONPATH="$WECHAT_RUNTIME" "$WECHAT_RUNTIME/.venv/bin/python" \
  scripts/extract_wechat_group.py \
  --config "$WECHAT_CONFIG" \
  --output "$RAW_MESSAGES"

python3 scripts/build_group_data.py "$RAW_MESSAGES" --output group-data.json
python3 .github/workflows/refresh_issues.py

snapshot_args=(
  --group "$SOURCE_REPO/group-data.json"
  --issues "$SOURCE_REPO/issues.json"
  --output "$OUTPUT_FILE"
  --date "$BEIJING_DATE"
)
if [[ -f "$PREVIOUS_FILE" ]]; then
  snapshot_args+=(--previous "$PREVIOUS_FILE")
fi
python3 "$SITE_REPO/scripts/build_snapshot_json.py" "${snapshot_args[@]}"

cd "$SITE_REPO"
npm run export:corpus -- \
  --group "$RAW_MESSAGES" \
  --issues "$SOURCE_REPO/issues.json" \
  --date "$BEIJING_DATE"

echo "已生成待发布网站快照：$OUTPUT_FILE"
