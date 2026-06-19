#!/usr/bin/env python3
"""Evaluate deployed hybrid fall decisions: motion rules + wrist detector + AI batch inference.

Run with:
  Backend/.venv/bin/python Backend/scripts/evaluate_hybrid_fall_detection.py --step 10
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
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "Backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.services import ai_model  # noqa: E402

DETECTOR_PATH = ROOT / "Backend/app/services/wrist_fall_detector.py"
spec = importlib.util.spec_from_file_location("wrist_fall_detector_eval", DETECTOR_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Cannot load detector from {DETECTOR_PATH}")
detector_module = importlib.util.module_from_spec(spec)
sys.modules["wrist_fall_detector_eval"] = detector_module
spec.loader.exec_module(detector_module)
WristFallDetector = detector_module.WristFallDetector

FALL_TAGS = {"1", "2", "3", "4", "5"}


@dataclass
class Segment:
    key: tuple[str, str, str, str]
    samples: list[tuple[float, float, float, float, float, float, float]]


@dataclass
class Candidate:
    segment_index: int
    timestamp_s: float
    raw_window: np.ndarray
    severe_motion: bool
    wrist_fall: bool
    wrist_possible: bool
    wrist_confidence: float


def mag(x: float, y: float, z: float) -> float:
    return math.sqrt((x * x) + (y * y) + (z * z))


def is_severe_motion(acc_mag: float, gyro_mag: float) -> bool:
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


def load_segments(csv_path: Path) -> list[Segment]:
    segments: list[Segment] = []
    current_key: tuple[str, str, str, str] | None = None
    current_samples: list[tuple[float, float, float, float, float, float, float]] = []
    start_ts: float | None = None

    with csv_path.open(newline="") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        next(reader, None)

        for row in reader:
            if len(row) < 47 or not row[0]:
                continue

            key = (row[43], row[44], row[45], row[46])
            if current_key is not None and key != current_key:
                segments.append(Segment(current_key, current_samples))
                current_samples = []
                start_ts = None

            current_key = key
            ts = datetime.fromisoformat(row[0]).timestamp()
            if start_ts is None:
                start_ts = ts

            ax = float(row[29]) * 9.81
            ay = float(row[30]) * 9.81
            az = float(row[31]) * 9.81
            gx = float(row[32])
            gy = float(row[33])
            gz = float(row[34])
            current_samples.append((ts - start_ts, ax, ay, az, gx, gy, gz))

    if current_key is not None and current_samples:
        segments.append(Segment(current_key, current_samples))

    return segments


def collect_candidates(segments: list[Segment], step: int, candidate_only: bool) -> tuple[list[Candidate], list[float | None]]:
    candidates: list[Candidate] = []
    fall_starts: list[float | None] = []

    for segment_index, segment in enumerate(segments):
        detector = WristFallDetector(sample_rate_hz=20)
        window: list[list[float]] = []
        label_is_fall = segment.key[3] in FALL_TAGS
        fall_start: float | None = None

        for sample_index, (t, ax, ay, az, gx, gy, gz) in enumerate(segment.samples):
            acc_mag = mag(ax, ay, az)
            gyro_mag = mag(gx, gy, gz)
            severe = is_severe_motion(acc_mag, gyro_mag)

            if label_is_fall and fall_start is None and severe:
                fall_start = t

            wrist_result = detector.update(ax, ay, az, gx, gy, gz, timestamp=t)
            window.append([ax, ay, az, gx, gy, gz])
            if len(window) > ai_model.TIME_STEPS:
                window.pop(0)

            has_wrist_event = bool(wrist_result.get("fall_detected")) or bool(wrist_result.get("possible_fall"))
            should_eval = severe or has_wrist_event
            if not candidate_only:
                should_eval = should_eval or sample_index % max(1, step) == 0
            if not should_eval:
                continue

            candidates.append(
                Candidate(
                    segment_index=segment_index,
                    timestamp_s=t,
                    raw_window=np.asarray(window, dtype=np.float32),
                    severe_motion=severe,
                    wrist_fall=bool(wrist_result.get("fall_detected")),
                    wrist_possible=bool(wrist_result.get("possible_fall")),
                    wrist_confidence=float(wrist_result.get("confidence", 0.0) or 0.0),
                )
            )

        if label_is_fall and fall_start is None:
            fall_start = 0.0
        fall_starts.append(fall_start)

    return candidates, fall_starts


def prepare_batch(windows: list[np.ndarray]) -> np.ndarray:
    prepared: list[np.ndarray] = []
    expected_features = int(ai_model._model_metadata.get("features_count", 16))

    for raw in windows:
        features = ai_model.calculate_features_from_raw(raw)
        if features.shape[1] != expected_features:
            raise ValueError(f"Feature count mismatch: {features.shape[1]} != {expected_features}")
        if features.shape[0] < ai_model.TIME_STEPS:
            pad = np.zeros((ai_model.TIME_STEPS - features.shape[0], features.shape[1]), dtype=np.float32)
            features = np.vstack([pad, features])
        else:
            features = features[-ai_model.TIME_STEPS :]
        prepared.append(features.astype(np.float32))

    return np.stack(prepared, axis=0)


def predict_batch(candidates: list[Candidate], batch_size: int) -> list[dict[str, float]]:
    if not candidates:
        return []

    model, scaler = ai_model.load_model_and_scaler()
    if model is None or scaler is None:
        raise RuntimeError("AI model/scaler did not load")

    predictions: list[dict[str, float]] = []

    for start in range(0, len(candidates), batch_size):
        chunk = candidates[start : start + batch_size]
        x = prepare_batch([candidate.raw_window for candidate in chunk])
        x2d = x.reshape(-1, x.shape[-1])
        x_scaled = scaler.transform(x2d).reshape(x.shape)
        raw_predictions: Any = model.predict(x_scaled, verbose=0)

        if ai_model._model_metadata.get("output_format") == "dual":
            now_values = raw_predictions[0].reshape(-1)
            soon_values = raw_predictions[1].reshape(-1)
        else:
            now_values = raw_predictions.reshape(-1)
            soon_values = np.asarray([ai_model.estimate_fall_soon_probability(float(value)) for value in now_values])

        for now_prob, soon_prob in zip(now_values, soon_values):
            predictions.append(
                {
                    "fall_now_probability": float(np.clip(now_prob, 0.0, 1.0)),
                    "fall_soon_probability": float(np.clip(soon_prob, 0.0, 1.0)),
                }
            )

    return predictions


def hybrid_alarm(candidate: Candidate, prediction: dict[str, float]) -> tuple[bool, str]:
    ai_now = prediction["fall_now_probability"]
    ai_soon = prediction["fall_soon_probability"]

    if candidate.severe_motion:
        return True, "severe_motion"
    if candidate.wrist_fall:
        return True, "wrist_confirmed"
    if candidate.wrist_possible and (ai_now >= 0.62 or ai_soon >= 0.78):
        return True, "ai_motion_fusion"
    return False, "normal"


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate hybrid AI + wrist fall detection.")
    parser.add_argument("--csv", default=str(ROOT / "AI/dataset/DataSet.csv"))
    parser.add_argument("--step", type=int, default=10, help="Run AI every N samples plus every candidate event.")
    parser.add_argument("--candidate-only", action="store_true", help="Run AI only on motion/wrist candidate events.")
    parser.add_argument("--limit-segments", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=128)
    args = parser.parse_args()

    segments = load_segments(Path(args.csv))
    if args.limit_segments:
        segments = segments[: args.limit_segments]

    candidates, fall_starts = collect_candidates(segments, args.step, args.candidate_only)
    predictions = predict_batch(candidates, args.batch_size)

    alarm_by_segment: dict[int, tuple[float, str]] = {}
    for candidate, prediction in zip(candidates, predictions):
        decision, reason = hybrid_alarm(candidate, prediction)
        if decision and candidate.segment_index not in alarm_by_segment:
            alarm_by_segment[candidate.segment_index] = (candidate.timestamp_s, reason)

    results = []
    for index, segment in enumerate(segments):
        label_is_fall = segment.key[3] in FALL_TAGS
        alarm = alarm_by_segment.get(index)
        latency = None
        if label_is_fall and alarm and fall_starts[index] is not None:
            latency = max(0.0, alarm[0] - float(fall_starts[index]))
        results.append(
            {
                "key": segment.key,
                "label_is_fall": label_is_fall,
                "alarm": alarm is not None,
                "latency": latency,
                "reason": alarm[1] if alarm else None,
                "samples": len(segment.samples),
            }
        )

    falls = [r for r in results if r["label_is_fall"]]
    normals = [r for r in results if not r["label_is_fall"]]
    tp = sum(1 for r in falls if r["alarm"])
    fn = len(falls) - tp
    fp = sum(1 for r in normals if r["alarm"])
    tn = len(normals) - fp
    latencies = [float(r["latency"]) for r in falls if r["latency"] is not None]

    print("Hybrid Fall Detection Evaluation")
    print(
        f"Segments: {len(results)} | fall={len(falls)} normal={len(normals)} | "
        f"candidates={len(candidates)} | step={args.step} | candidate_only={args.candidate_only}"
    )
    print(f"Confusion: TP={tp} FN={fn} FP={fp} TN={tn}")
    print(f"Recall: {(tp / len(falls) * 100.0) if falls else 0.0:.1f}%")
    print(f"False positive rate: {(fp / len(normals) * 100.0) if normals else 0.0:.1f}%")
    if latencies:
        print(
            "Alarm latency: "
            f"mean={mean(latencies):.2f}s median={median(latencies):.2f}s "
            f"p90={percentile(latencies, 90):.2f}s max={max(latencies):.2f}s"
        )

    reason_counts: dict[str, int] = {}
    for item in results:
        if item["alarm"]:
            reason = str(item["reason"])
            reason_counts[reason] = reason_counts.get(reason, 0) + 1
    print(f"Alarm reasons: {reason_counts}")

    missed = [r for r in falls if not r["alarm"]][:10]
    if missed:
        print("Sample missed fall segment keys:")
        for item in missed:
            key = item["key"]
            print(f"  subject={key[0]} activity={key[1]} trial={key[2]} tag={key[3]} samples={item['samples']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
