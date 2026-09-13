#!/usr/bin/env python3
"""Compute Pi model activity and autoscaling interval totals."""

from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import Counter
from pathlib import Path


def merge_intervals(intervals: list[tuple[float, float]]) -> list[list[float]]:
    if not intervals:
        return []
    ordered = sorted(intervals)
    merged = [list(ordered[0])]
    for start, end in ordered[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def iso_seconds(value: str) -> float:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def hours(intervals: list[list[float]] | list[tuple[float, float]]) -> float:
    return sum(end - start for start, end in intervals) / 3600


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=Path.home() / ".pi" / "agent" / "sessions",
    )
    parser.add_argument(
        "--idle-tail",
        type=int,
        action="append",
        default=[],
        help="Scale-down delay in seconds; may be repeated",
    )
    parser.add_argument(
        "--max-request-seconds",
        type=float,
        default=7200,
        help="Reject implausibly long request intervals",
    )
    args = parser.parse_args()

    tails = sorted(set(args.idle_tail or [300, 900]))
    intervals: list[tuple[float, float]] = []
    session_ranges: list[tuple[float, float]] = []
    models: Counter[tuple[str | None, str | None]] = Counter()
    files = list(args.root.rglob("*.jsonl"))
    bad_lines = 0

    for path in files:
        event_times: list[float] = []
        with path.open(errors="ignore") as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    bad_lines += 1
                    continue

                if event.get("timestamp"):
                    try:
                        event_times.append(iso_seconds(event["timestamp"]))
                    except (TypeError, ValueError):
                        pass

                message = event.get("message", {})
                if event.get("type") != "message" or message.get("role") != "assistant":
                    continue

                models[(message.get("provider"), message.get("model"))] += 1
                start_ms = message.get("timestamp")
                try:
                    end = iso_seconds(event["timestamp"])
                    start = float(start_ms) / 1000
                except (KeyError, TypeError, ValueError):
                    continue
                duration = end - start
                if 0 <= duration < args.max_request_seconds:
                    intervals.append((start, end))

        if event_times:
            session_ranges.append((min(event_times), max(event_times)))

    output = {
        "session_files": len(files),
        "sessions_with_timestamps": len(session_ranges),
        "assistant_calls": len(intervals),
        "bad_json_lines": bad_lines,
        "earliest_utc": dt.datetime.fromtimestamp(
            min(start for start, _ in session_ranges), dt.timezone.utc
        ).isoformat()
        if session_ranges
        else None,
        "latest_utc": dt.datetime.fromtimestamp(
            max(end for _, end in session_ranges), dt.timezone.utc
        ).isoformat()
        if session_ranges
        else None,
        "summed_request_hours": round(hours(intervals), 4),
        "union_request_hours": round(hours(merge_intervals(intervals)), 4),
        "union_session_span_hours": round(hours(merge_intervals(session_ranges)), 4),
        "models": [
            {"provider": key[0], "model": key[1], "calls": count}
            for key, count in models.most_common()
        ],
    }
    output["idle_tail_union_hours"] = {
        str(tail): round(
            hours(merge_intervals([(start, end + tail) for start, end in intervals])), 4
        )
        for tail in tails
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
