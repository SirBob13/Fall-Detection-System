import math
import time
from collections import deque
from typing import Deque, Dict, List, Optional, Tuple


class WristFallDetector:
    """Stateful wrist-worn fall confirmation for MPU6050 bracelet telemetry."""

    def __init__(self, sample_rate_hz: int = 20):
        self.fs = sample_rate_hz
        self.dt = 1.0 / sample_rate_hz

        self.IMPACT_ACC = 28.0
        self.STRONG_IMPACT_ACC = 35.0
        self.HIGH_GYRO = 220.0
        self.STRONG_GYRO = 320.0
        self.JERK_THRESHOLD = 140.0

        self.POST_STILL_WINDOW = 2.5
        self.STILL_GYRO_MEAN = 35.0
        self.STILL_ACC_STD = 1.25
        self.ORIENTATION_CHANGE_DEG = 45.0

        self.CONFIRM_WINDOW = 3.0
        self.COOLDOWN = 6.0

        self.samples: Deque[Dict[str, float]] = deque(maxlen=int(sample_rate_hz * 8))
        self.state = "NORMAL"
        self.impact_time: Optional[float] = None
        self.impact_sample: Optional[Dict[str, float]] = None
        self.last_fall_time = -self.COOLDOWN
        self.prev_acc_mag: Optional[float] = None

    def mag(self, x: float, y: float, z: float) -> float:
        return math.sqrt((x * x) + (y * y) + (z * z))

    def angle_between_acc_vectors(self, a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
        ax, ay, az = a
        bx, by, bz = b
        ma = self.mag(ax, ay, az)
        mb = self.mag(bx, by, bz)
        if ma < 1e-6 or mb < 1e-6:
            return 0.0

        dot = (ax * bx) + (ay * by) + (az * bz)
        cos_theta = max(-1.0, min(1.0, dot / (ma * mb)))
        return math.degrees(math.acos(cos_theta))

    def get_recent_samples(self, seconds: float, now: float) -> List[Dict[str, float]]:
        return [s for s in self.samples if now - s["t"] <= seconds]

    def acc_std(self, values: List[float]) -> float:
        if len(values) < 2:
            return 999.0
        mean = sum(values) / len(values)
        var = sum((v - mean) ** 2 for v in values) / len(values)
        return math.sqrt(var)

    def is_post_fall_still(self, now: float) -> bool:
        recent = self.get_recent_samples(self.POST_STILL_WINDOW, now)
        if len(recent) < int(self.fs * 1.2):
            return False

        acc_mags = [s["acc_mag"] for s in recent]
        gyro_mags = [s["gyro_mag"] for s in recent]
        gyro_mean = sum(gyro_mags) / len(gyro_mags)
        acc_std = self.acc_std(acc_mags)
        return gyro_mean < self.STILL_GYRO_MEAN and acc_std < self.STILL_ACC_STD

    def orientation_changed_after_impact(self, now: float) -> bool:
        if self.impact_sample is None:
            return False

        recent = self.get_recent_samples(0.6, now)
        if len(recent) < 3:
            return False

        last = recent[-1]
        before_vec = (self.impact_sample["ax"], self.impact_sample["ay"], self.impact_sample["az"])
        after_vec = (last["ax"], last["ay"], last["az"])
        return self.angle_between_acc_vectors(before_vec, after_vec) >= self.ORIENTATION_CHANGE_DEG

    def repeated_hand_motion(self, now: float) -> bool:
        recent = self.get_recent_samples(2.0, now)
        if len(recent) < int(self.fs * 1.0):
            return False

        high_peaks = sum(
            1
            for s in recent
            if s["acc_mag"] > self.IMPACT_ACC or s["gyro_mag"] > self.HIGH_GYRO
        )
        return high_peaks >= 5

    def update(
        self,
        ax: float,
        ay: float,
        az: float,
        gx: float,
        gy: float,
        gz: float,
        timestamp: Optional[float] = None,
    ) -> Dict[str, object]:
        now = timestamp if timestamp is not None else time.time()
        acc_mag = self.mag(ax, ay, az)
        gyro_mag = self.mag(gx, gy, gz)
        jerk = 0.0 if self.prev_acc_mag is None else abs(acc_mag - self.prev_acc_mag) / self.dt
        self.prev_acc_mag = acc_mag

        sample = {
            "t": now,
            "ax": ax,
            "ay": ay,
            "az": az,
            "gx": gx,
            "gy": gy,
            "gz": gz,
            "acc_mag": acc_mag,
            "gyro_mag": gyro_mag,
            "jerk": jerk,
        }
        self.samples.append(sample)

        result: Dict[str, object] = {
            "fall_detected": False,
            "possible_fall": False,
            "confidence": 0.0,
            "state": self.state,
            "reason": "normal",
            "acc_mag": acc_mag,
            "gyro_mag": gyro_mag,
            "jerk": jerk,
        }

        if now - self.last_fall_time < self.COOLDOWN:
            result["reason"] = "cooldown"
            return result

        impact = acc_mag >= self.IMPACT_ACC
        strong_impact = acc_mag >= self.STRONG_IMPACT_ACC
        high_rotation = gyro_mag >= self.HIGH_GYRO
        strong_rotation = gyro_mag >= self.STRONG_GYRO
        high_jerk = jerk >= self.JERK_THRESHOLD

        if self.state == "NORMAL":
            if impact and (high_rotation or high_jerk):
                if self.repeated_hand_motion(now):
                    result["reason"] = "repeated_hand_motion"
                    return result

                self.state = "IMPACT_CANDIDATE"
                self.impact_time = now
                self.impact_sample = sample

                confidence = 0.45
                if strong_impact:
                    confidence += 0.15
                if strong_rotation:
                    confidence += 0.15
                if high_jerk:
                    confidence += 0.10

                result.update(
                    {
                        "possible_fall": True,
                        "confidence": min(confidence, 0.80),
                        "state": self.state,
                        "reason": "impact_rotation_or_jerk",
                    }
                )
                return result

        if self.state == "IMPACT_CANDIDATE":
            elapsed = now - (self.impact_time or now)
            if elapsed <= self.CONFIRM_WINDOW:
                still = self.is_post_fall_still(now)
                orient_changed = self.orientation_changed_after_impact(now)

                if still:
                    confidence = 0.70
                    if orient_changed:
                        confidence += 0.15
                    if self.impact_sample and self.impact_sample["acc_mag"] >= self.STRONG_IMPACT_ACC:
                        confidence += 0.10
                    if self.impact_sample and self.impact_sample["gyro_mag"] >= self.STRONG_GYRO:
                        confidence += 0.05

                    self.state = "NORMAL"
                    self.last_fall_time = now
                    self.impact_time = None
                    self.impact_sample = None

                    result.update(
                        {
                            "fall_detected": True,
                            "possible_fall": True,
                            "confidence": min(confidence, 0.98),
                            "state": "FALL_CONFIRMED",
                            "reason": "impact_then_stillness",
                        }
                    )
                    return result

                result.update(
                    {
                        "possible_fall": True,
                        "confidence": 0.55,
                        "state": self.state,
                        "reason": "waiting_for_stillness",
                    }
                )
                return result

            self.state = "NORMAL"
            self.impact_time = None
            self.impact_sample = None
            result.update(
                {
                    "fall_detected": False,
                    "possible_fall": False,
                    "confidence": 0.0,
                    "state": self.state,
                    "reason": "no_post_fall_stillness",
                }
            )
            return result

        result["state"] = self.state
        return result


_detectors: Dict[str, WristFallDetector] = {}


def update_wrist_fall_detector(
    key: str,
    ax: float,
    ay: float,
    az: float,
    gx: float,
    gy: float,
    gz: float,
    timestamp: Optional[float] = None,
) -> Dict[str, object]:
    detector = _detectors.get(key)
    if detector is None:
        detector = WristFallDetector()
        _detectors[key] = detector
    return detector.update(ax, ay, az, gx, gy, gz, timestamp)
