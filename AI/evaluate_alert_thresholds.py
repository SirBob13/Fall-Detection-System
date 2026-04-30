import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET_PATH = ROOT / "AI" / "dataset" / "DataSet.csv"
FALL_CODES = {7, 8, 9, 10, 11}


def safe_div(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def print_confusion_metrics(title: str, tp: int, fp: int, fn: int, tn: int) -> None:
    precision = safe_div(tp, tp + fp)
    recall = safe_div(tp, tp + fn)
    f1 = safe_div(2 * precision * recall, precision + recall) if (precision + recall) else 0.0
    accuracy = safe_div(tp + tn, tp + fp + fn + tn)

    print(title)
    print(f"  TP: {tp}")
    print(f"  FP: {fp}")
    print(f"  FN: {fn}")
    print(f"  TN: {tn}")
    print(f"  Precision: {precision:.4f}")
    print(f"  Recall: {recall:.4f}")
    print(f"  F1: {f1:.4f}")
    print(f"  Accuracy: {accuracy:.4f}")


def load_wrist_rows(limit: int | None = None):
    rows: list[tuple[list[float], int]] = []
    with DATASET_PATH.open(newline="") as f:
        reader = csv.reader(f)
        next(reader, None)  # header
        next(reader, None)  # units row

        for row in reader:
            if len(row) < 47:
                continue
            try:
                sample = [
                    float(row[29]), float(row[30]), float(row[31]),
                    float(row[32]), float(row[33]), float(row[34]),
                ]
                tag = int(float(row[46])) if row[46] != "" else -1
            except Exception:
                continue

            rows.append((sample, tag))
            if limit and len(rows) >= limit:
                break
    return rows


def main():
    try:
        import numpy as np
    except Exception as exc:
        print("Failed to load numpy.")
        print(f"Reason: {exc}")
        print("Run this script from an environment that has numpy installed.")
        return

    sys.path.append(str(ROOT / "Backend"))
    try:
        from app.services.ai_model import TIME_STEPS, predict_fall  # type: ignore
        from app.config import FALL_ALERT_THRESHOLD, FALL_THRESHOLD_SOON  # type: ignore
    except Exception as exc:
        print("Failed to load model dependencies.")
        print(f"Reason: {exc}")
        print("Run this script from the backend training/runtime environment that has tensorflow and joblib installed.")
        print("Example:")
        print("  Backend/.venv/bin/python AI/evaluate_alert_thresholds.py --step 20")
        return

    parser = argparse.ArgumentParser(
        description="Evaluate confirmed fall and fall-risk windows using current backend thresholds."
    )
    parser.add_argument("--limit", type=int, default=0, help="Optional row limit for faster debugging.")
    parser.add_argument("--step", type=int, default=5, help="Sliding step size.")
    args = parser.parse_args()

    rows = load_wrist_rows(limit=args.limit or None)
    if len(rows) < TIME_STEPS:
        print("Not enough rows in dataset.")
        return

    confirmed = 0
    risk = 0
    normal = 0
    actual_fall_windows = 0
    total_windows = 0
    confirmed_tp = confirmed_fp = confirmed_fn = confirmed_tn = 0
    alert_tp = alert_fp = alert_fn = alert_tn = 0
    risk_on_fall_windows = 0
    risk_on_non_fall_windows = 0

    for start in range(0, len(rows) - TIME_STEPS + 1, max(1, args.step)):
        total_windows += 1
        window = rows[start:start + TIME_STEPS]
        raw = np.array([sample for sample, _ in window], dtype=np.float32)
        tags = [tag for _, tag in window]

        is_actual_fall = any(tag in FALL_CODES for tag in tags)
        if is_actual_fall:
            actual_fall_windows += 1

        prediction = predict_fall(raw)
        if not prediction.get("success"):
            continue

        fall_now_prob = float(prediction.get("fall_now_probability", 0.0))
        fall_soon_prob = float(prediction.get("fall_soon_probability", 0.0))
        is_confirmed = fall_now_prob >= FALL_ALERT_THRESHOLD
        is_risk = (not is_confirmed) and fall_soon_prob >= FALL_THRESHOLD_SOON
        has_any_alert = is_confirmed or is_risk

        if is_confirmed:
            confirmed += 1
        elif is_risk:
            risk += 1
            if is_actual_fall:
                risk_on_fall_windows += 1
            else:
                risk_on_non_fall_windows += 1
        else:
            normal += 1

        if is_confirmed and is_actual_fall:
            confirmed_tp += 1
        elif is_confirmed and not is_actual_fall:
            confirmed_fp += 1
        elif not is_confirmed and is_actual_fall:
            confirmed_fn += 1
        else:
            confirmed_tn += 1

        if has_any_alert and is_actual_fall:
            alert_tp += 1
        elif has_any_alert and not is_actual_fall:
            alert_fp += 1
        elif not has_any_alert and is_actual_fall:
            alert_fn += 1
        else:
            alert_tn += 1

    print("Dataset evaluation using wrist sensor columns")
    print(f"Dataset: {DATASET_PATH}")
    print(f"Rows loaded: {len(rows)}")
    print(f"Window size: {TIME_STEPS}")
    print(f"Step size: {args.step}")
    print(f"Confirmed fall threshold: {FALL_ALERT_THRESHOLD}")
    print(f"Fall risk threshold: {FALL_THRESHOLD_SOON}")
    print("---")
    print(f"Total windows: {total_windows}")
    print(f"Actual fall windows (contains fall tags): {actual_fall_windows}")
    print(f"Confirmed fall windows: {confirmed}")
    print(f"Fall risk windows: {risk}")
    print(f"Normal windows: {normal}")
    print(f"Fall risk on actual-fall windows: {risk_on_fall_windows}")
    print(f"Fall risk on non-fall windows: {risk_on_non_fall_windows}")
    print("---")
    print_confusion_metrics(
        "Confirmed fall metrics (fall_now only)",
        confirmed_tp,
        confirmed_fp,
        confirmed_fn,
        confirmed_tn,
    )
    print("---")
    print_confusion_metrics(
        "Alert coverage metrics (fall_now + fall_risk)",
        alert_tp,
        alert_fp,
        alert_fn,
        alert_tn,
    )


if __name__ == "__main__":
    main()
