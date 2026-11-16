"""EVA astronaut model. SIMULATION PARAMETERS, not flight data and not a physiological model.

Metabolic rate drives oxygen use (indirect calorimetry rule of thumb: ~20 kJ per litre of O2,
O2 density ~1.43 g/L, i.e. ~14 kJ per gram of O2). Walking cost rises with uphill grade.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

KJ_PER_G_O2 = 14.0


@dataclass(frozen=True)
class AstronautParams:
    radius_m: float = 0.5
    max_slope_deg: float = 20.0       # walking limit in this model (suited crew are more conservative than rovers)
    walk_speed_mps: float = 1.1       # sped-up EVA pace for playability
    rest_w: float = 110.0             # metabolic rate at rest in the suit
    walk_w: float = 260.0             # metabolic rate walking on flat ground
    grade_w_per_unit: float = 900.0   # extra watts per unit uphill grade (0.1 grade -> +90 W)
    suit_o2_g: float = 560.0          # usable suit oxygen (simulation parameter)
    suit_power_wh: float = 300.0      # suit battery
    suit_power_w: float = 35.0        # fans, radio, displays, heaters
    reserve_fraction: float = 0.25    # oxygen that must remain on return to the habitat


ASTRONAUT = AstronautParams()


def walking_power_w(grade: float, p: AstronautParams = ASTRONAUT) -> float:
    return p.walk_w + max(0.0, grade) * p.grade_w_per_unit


def o2_grams(power_w: float, seconds: float) -> float:
    return power_w * seconds / 1000.0 / KJ_PER_G_O2


def segment_o2_g(dist_m: float, dh_m: float, p: AstronautParams = ASTRONAUT) -> float:
    if dist_m <= 0:
        return 0.0
    grade = dh_m / dist_m
    t = dist_m / p.walk_speed_mps
    return o2_grams(walking_power_w(grade, p), t)


def params_dict() -> dict:
    return asdict(ASTRONAUT)
