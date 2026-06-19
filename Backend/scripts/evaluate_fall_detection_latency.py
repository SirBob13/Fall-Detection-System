#!/usr/bin/env python3
"""Evaluate wrist fall detection and alert latency on the training-style CSV.

Default fall tag mapping is intentionally configurable because the dataset uses
numeric activity tags. Pass --fall-tags with the official mapping when available.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import math
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from statistics import mean, median
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]

DETECTOR_PATH = ROOT / "Backend/app/services/wrist_fall_detector.py"
spec = importlib.util.spec_from_file_location("wrist_fall_detector", DETECTOR_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load detector from {DETECTOR_PATH}")
detector_module = importlib.util.module_from_spec(spec)
sys.modules["wrist_fall_detector"] = detector_module
spec.loader.exec_module(detector_module)
WristFallDetector = detector_module.WristFallDetector


DEFAULT_FALL_TAGS = {"1", "2", "3", "4", "5"}


@dataclass
class SegmentResult:
    key: tuple[str, str, str, str]
    label_is_fall: bool
    sample_count: int
    fall_start_s: float | None
    wrist_alarm_s: float | None
    product_alarm_s: float | None

    @property
    def wrist_latency_s(self) -> float | None:
        if self.fall_start_s is None or self.wrist_alarm_s is None:
            return None
        return max(0.0, self.wrist_alarm_s - self.fall_start_s)

    @property
    def product_latency_s(self) -> float | None:
        if self.fall_start_s is None or self.product_alarm_s is None:
            return None
        return max(0.0, self.product_alarm_s - self.fall_start_s)


def parse_timestamp(value: str) -> float:
    return datetime.fromisoformat(value).timestamp()


def magnitude(values: Iterable[float]) -> float:
    x, y, z = values
    return math.sqrt((x * x) + (y * y) + (z * z))


def is_product_severe_motion(acc_mag: float, gyro_mag: float) -> bool:
    return (
        (acc_mag >= 25.0 and gyro_mag >= 180.0)
        or acc_mag >= 35.0
        or (gyro_mag >= 420.0 and acc_mag >= 15.0)
    )


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, round((pct / 100.0) * (len(ordered) - 1))))
    return ordered[idx]


def evaluate_segment(rows: list[list[str]], fall_tags: set[str]) -> SegmentResult | None:
    if not rows:
        return None

    subject, activity, trial, tag = rows[0][43], rows[0][44], rows[0][45], rows[0][46]
    label_is_fall = tag in fall_tags
    detector = WristFallDetector(sample_rate_hz=20)
    first_timestamp = parse_timestamp(rows[0][0])
    fall_start_s: float | None = None
    wrist_alarm_s: float | None = None
    product_alarm_s: float | None = None

    for row in rows:
        timestamp_s = parse_timestamp(row[0]) - first_timestamp
        ax_g, ay_g, az_g = float(row[29]), float(row[30]), float(row[31])
        gx, gy, gz = float(row[32]), float(row[33]), float(row[34])

        ax, ay, az = ax_g * 9.81, ay_g * 9.81, az_g * 9.81
        acc_mag = magnitude((ax, ay, az))
        gyro_mag = magnitude((gx, gy, gz))
        severe_motion = is_product_severe_motion(acc_mag, gyro_mag)

        if label_is_fall and fall_start_s is None and severe_motion:
            fall_start_s = timestamp_s

        result = detector.update(ax, ay, az, gx, gy, gz, timestamp=timestamp_s)
        if wrist_alarm_s is None and result.get("fall_detected"):
            wrist_alarm_s = timestamp_s

        if product_alarm_s is None and (severe_motion or result.get("fall_detected")):
            product_alarm_s = timestamp_s

    if label_is_fall and fall_start_s is None:
        fall_start_s = 0.0

    return SegmentResult(
        key=(subject, activity, trial, tag),
        label_is_fall=label_is_fall,
        sample_count=len(rows),
        fall_start_s=fall_start_s,
        wrist_alarm_s=wrist_alarm_s,
        product_alarm_s=product_alarm_s,
    )


def load_segments(csv_path: Path) -> list[list[list[str]]]:
    segments: list[list[list[str]]] = []
    current_key: tuple[str, str, str, str] | None = None
    current_rows: list[list[str]] = []

    with csv_path.open(newline="") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        next(reader, None)
        for row in reader:
            if len(row) < 47 or not row[0]:
                continue
            key = (row[43], row[44], row[45], row[46])
            if current_key is not None and key != current_key:
                segments.append(current_rows)
                current_rows = []
            current_key = key
            current_rows.append(row)

    if current_rows:
        segments.append(current_rows)

    return segments


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate fall detector latency on AI/dataset/DataSet.csv")
    parser.add_argument("--csv", default=str(ROOT / "AI/dataset/DataSet.csv"), help="Dataset CSV path")
    parser.add_argument(
        "--fall-tags",
        default=",".join(sorted(DEFAULT_FALL_TAGS)),
        help="Comma-separated Tag values that represent falls",
    )
    parser.add_argument("--limit-segments", type=int, default=0, help="Optional segment limit for quick checks")
    args = parser.parse_args()

    csv_path = Path(args.csv)
    fall_tags = {value.strip() for value in args.fall_tags.split(",") if value.strip()}
    segments = load_segments(csv_path)
    if args.limit_segments > 0:
        segments = segments[: args.limit_segments]

    results = [result for rows in segments if (result := evaluate_segment(rows, fall_tags)) is not None]
    falls = [r for r in results if r.label_is_fall]
    normals = [r for r in results if not r.label_is_fall]

    tp = sum(1 for r in falls if r.product_alarm_s is not None)
    fn = len(falls) - tp
    fp = sum(1 for r in normals if r.product_alarm_s is not None)
    tn = len(normals) - fp
    latencies = [r.product_latency_s for r in falls if r.product_latency_s is not None]
    wrist_latencies = [r.wrist_latency_s for r in falls if r.wrist_latency_s is not None]

    print("Fall Detection Dataset Evaluation")
    print(f"CSV: {csv_path}")
    print(f"Fall tags: {', '.join(sorted(fall_tags))}")
    print(f"Segments: {len(results)} | fall={len(falls)} normal={len(normals)}")
    print(f"Confusion: TP={tp} FN={fn} FP={fp} TN={tn}")
    print(f"Recall: {(tp / len(falls) * 100.0) if falls else 0.0:.1f}%")
    print(f"False positive rate: {(fp / len(normals) * 100.0) if normals else 0.0:.1f}%")

    if latencies:
        print(
            "Product alarm latency: "
            f"mean={mean(latencies):.2f}s median={median(latencies):.2f}s "
            f"p90={percentile(latencies, 90):.2f}s max={max(latencies):.2f}s"
        )
    else:
        print("Product alarm latency: no detected fall segments")

    if wrist_latencies:
        print(
            "Confirmed wrist-detector latency: "
            f"mean={mean(wrist_latencies):.2f}s median={median(wrist_latencies):.2f}s "
            f"p90={percentile(wrist_latencies, 90):.2f}s max={max(wrist_latencies):.2f}s"
        )
    else:
        print("Confirmed wrist-detector latency: no confirmed wrist detections")

    missed = [r for r in falls if r.product_alarm_s is None][:10]
    if missed:
        print("Sample missed fall segment keys:")
        for item in missed:
            print(f"  subject={item.key[0]} activity={item.key[1]} trial={item.key[2]} tag={item.key[3]} samples={item.sample_count}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
