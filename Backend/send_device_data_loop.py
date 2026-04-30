#!/usr/bin/env python3
"""
Send randomized device-data payloads in a loop for realtime testing.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from datetime import datetime, timezone
from typing import Any
from urllib import error, request


def build_payload(user_id: int, device_id: str, iteration: int) -> dict[str, Any]:
    now = time.time()
    phase = now + iteration

    acc_x = math.sin(phase / 2.4) * 0.4 + random.uniform(-0.05, 0.05)
    acc_y = math.cos(phase / 2.1) * 0.35 + random.uniform(-0.05, 0.05)
    acc_z = 9.8 + math.sin(phase / 1.7) * 0.25 + random.uniform(-0.04, 0.04)

    gyro_x = math.sin(phase / 1.3) * 18 + random.uniform(-2, 2)
    gyro_y = math.cos(phase / 1.6) * 22 + random.uniform(-2, 2)
    gyro_z = math.sin(phase / 1.9) * 16 + random.uniform(-2, 2)

    heart_rate = 76 + math.sin(phase / 5.2) * 7 + random.uniform(-1.5, 1.5)
    spo2 = 97.5 + math.sin(phase / 6.7) * 0.8 + random.uniform(-0.15, 0.15)
    body_temp = 36.7 + math.sin(phase / 7.3) * 0.18 + random.uniform(-0.04, 0.04)
    respiration_rate = 16 + math.cos(phase / 4.8) * 1.2 + random.uniform(-0.25, 0.25)
    systolic = 122 + math.sin(phase / 8.1) * 4 + random.uniform(-1, 1)
    diastolic = 79 + math.cos(phase / 8.9) * 3 + random.uniform(-1, 1)
    battery = max(35.0, min(98.0, 92.0 - iteration * 0.03))

    timestamp = datetime.now(timezone.utc).isoformat()

    return {
        "device_id": device_id,
        "user_id": user_id,
        "timestamp": timestamp,
        "battery_level": round(battery, 1),
        "firmware_version": "realtime-test-1.0.0",
        "motion": {
            "acc_x": round(acc_x, 4),
            "acc_y": round(acc_y, 4),
            "acc_z": round(acc_z, 4),
            "gyro_x": round(gyro_x, 4),
            "gyro_y": round(gyro_y, 4),
            "gyro_z": round(gyro_z, 4),
            "temperature": round(body_temp, 2),
            "timestamp": timestamp,
        },
        "vitals": {
            "heart_rate": round(heart_rate, 1),
            "blood_pressure_systolic": round(systolic, 1),
            "blood_pressure_diastolic": round(diastolic, 1),
            "oxygen_saturation": round(spo2, 1),
            "body_temperature": round(body_temp, 2),
            "respiration_rate": round(respiration_rate, 1),
            "timestamp": timestamp,
        },
    }


def post_json(url: str, payload: dict[str, Any], timeout: float) -> tuple[int, str]:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=timeout) as response:
        return response.status, response.read().decode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Send randomized /device-data payloads in a loop.")
    parser.add_argument("--base-url", default="https://fall-detection.ddns.net/api/v1", help="API base URL")
    parser.add_argument("--user-id", type=int, required=True, help="Target user_id")
    parser.add_argument("--device-id", required=True, help="Target device_id")
    parser.add_argument("--count", type=int, default=30, help="Number of payloads to send")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between payloads")
    parser.add_argument("--timeout", type=float, default=10.0, help="Per-request timeout")
    args = parser.parse_args()

    endpoint = f"{args.base_url.rstrip('/')}/device-data"
    print(f"Sending {args.count} randomized payloads to {endpoint}")
    print(f"user_id={args.user_id} device_id={args.device_id} interval={args.interval}s")

    for iteration in range(1, args.count + 1):
        payload = build_payload(args.user_id, args.device_id, iteration)
        started = time.perf_counter()
        try:
            status, response_text = post_json(endpoint, payload, args.timeout)
            elapsed_ms = (time.perf_counter() - started) * 1000
            print(f"[{iteration:03d}/{args.count:03d}] status={status} latency_ms={elapsed_ms:.1f}")
            if status != 200:
                print(response_text[:500])
        except error.HTTPError as exc:
            print(f"[{iteration:03d}/{args.count:03d}] http_error={exc.code} body={exc.read().decode('utf-8', errors='replace')[:500]}")
        except Exception as exc:
            print(f"[{iteration:03d}/{args.count:03d}] request_failed={exc}")

        if iteration != args.count:
            time.sleep(args.interval)

    return 0


if __name__ == "__main__":
    sys.exit(main())
