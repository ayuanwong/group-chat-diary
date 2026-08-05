#!/usr/bin/env python3
"""Build one atomic DSH site snapshot JSON without generating a daily HTML."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
from zoneinfo import ZoneInfo


BEIJING = ZoneInfo("Asia/Shanghai")


def read_json(path: pathlib.Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def validate(group: dict, issues: dict) -> None:
    if group.get("version") != 3 or group.get("source", {}).get("group") != "【官方】DSH内测群":
        raise ValueError("group snapshot is not the audited DSH internal group format")
    if not isinstance(group.get("signals"), list) or not isinstance(group.get("members"), list):
        raise ValueError("group snapshot is incomplete")
    if issues.get("version") != 2 or not isinstance(issues.get("issues"), list):
        raise ValueError("issue snapshot is incomplete")


def build_comparison(group: dict, issues: dict, previous: dict | None,
                     snapshot_date: str) -> dict:
    current_date = dt.date.fromisoformat(snapshot_date)
    current_label = current_date.strftime("%m%d")
    previous_label = (current_date - dt.timedelta(days=1)).strftime("%m%d")
    if previous is None:
        return {
            "version": 1,
            "status": "unavailable",
            "currentLabel": current_label,
            "previousLabel": previous_label,
        }

    previous_group = previous["group"]
    previous_issues = previous["issues"]
    previous_issue_numbers = {item.get("n") for item in previous_issues.get("issues", [])}
    new_issue_numbers = [
        item.get("n") for item in issues.get("issues", [])
        if item.get("n") not in previous_issue_numbers
    ]
    cutoff = previous_group.get("stats", {}).get("date_end") or ""
    previous_signal_ids = {item.get("message_id") for item in previous_group.get("signals", [])}
    new_signal_ids = [
        item.get("message_id") for item in group.get("signals", [])
        if item.get("message_id") not in previous_signal_ids
        and (not cutoff or item.get("timestamp", "") > cutoff)
    ]
    previous_topics = {
        item.get("t"): int(item.get("n", 0))
        for item in previous_group.get("group_topic_words", [])
    }
    topic_deltas = []
    for item in group.get("group_topic_words", []):
        label = item.get("t")
        current_count = int(item.get("n", 0))
        previous_count = previous_topics.get(label, 0)
        delta = current_count - previous_count
        if delta > 0:
            topic_deltas.append({
                "label": label,
                "delta": delta,
                "current": current_count,
                "previous": previous_count,
            })
    topic_deltas.sort(key=lambda item: (-item["delta"], item["label"] or ""))

    current_messages = int(group.get("stats", {}).get("accepted_messages", 0))
    previous_messages = int(previous_group.get("stats", {}).get("accepted_messages", 0))
    return {
        "version": 1,
        "status": "ready",
        "currentLabel": current_label,
        "previousLabel": previous_label,
        "previousGeneratedAt": previous.get("generatedAt"),
        "previousCutoff": cutoff,
        "currentCutoff": group.get("stats", {}).get("date_end"),
        "previousMessageCount": previous_messages,
        "currentMessageCount": current_messages,
        "newMessageCount": max(0, current_messages - previous_messages),
        "newIssueNumbers": new_issue_numbers,
        "newSignalMessageIds": new_signal_ids,
        "topicDeltas": topic_deltas,
    }


def read_previous(path: pathlib.Path | None) -> dict | None:
    if path is None or not path.is_file():
        return None
    previous = read_json(path)
    validate(previous.get("group", {}), previous.get("issues", {}))
    return previous


def build(group_path: pathlib.Path, issues_path: pathlib.Path,
          output_path: pathlib.Path, previous_path: pathlib.Path | None,
          snapshot_date: str) -> dict:
    group = read_json(group_path)
    issues = read_json(issues_path)
    validate(group, issues)
    generated_at = dt.datetime.now(BEIJING).replace(microsecond=0).isoformat()
    previous = read_previous(previous_path)
    comparison = build_comparison(group, issues, previous, snapshot_date)
    snapshot = {
        "snapshotDate": snapshot_date,
        "group": group,
        "issues": issues,
        "comparison": comparison,
        "generatedAt": generated_at,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(output_path)
    return {
        "output": str(output_path),
        "snapshot_date": snapshot_date,
        "generated_at": generated_at,
        "group_messages": group.get("stats", {}).get("accepted_messages", 0),
        "signals": len(group.get("signals", [])),
        "members": len(group.get("members", [])),
        "issues": len(issues.get("issues", [])),
        "chronicles": len(group.get("chronicles", [])),
        "new_messages": comparison.get("newMessageCount", 0),
        "new_issues": len(comparison.get("newIssueNumbers", [])),
        "new_signals": len(comparison.get("newSignalMessageIds", [])),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--group", type=pathlib.Path, required=True)
    parser.add_argument("--issues", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--previous", type=pathlib.Path)
    parser.add_argument(
        "--date",
        default=dt.datetime.now(BEIJING).date().isoformat(),
        help="Snapshot date in YYYY-MM-DD (Asia/Shanghai by default)",
    )
    args = parser.parse_args()
    result = build(args.group, args.issues, args.output, args.previous, args.date)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
