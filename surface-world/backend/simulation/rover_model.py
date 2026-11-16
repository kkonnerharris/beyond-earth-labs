"""Rover and astronaut resource models.

These are SIMULATION PARAMETERS chosen to be plausible and easy to inspect. They are not the
specification of any real rover. Every number shown in the UI that depends on them is labeled
as simulated, and docs/SIMULATION_MODEL.md lists them.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass

G_MARS = 3.71  # m/s^2, surface gravity of Mars (physical constant)


@dataclass(frozen=True)
class RoverParams:
    mass_kg: float = 1025.0            # order of magnitude of a large Mars rover
    radius_m: float = 1.6              # footprint radius used for collision clearance
    max_slope_deg: float = 25.0        # traversability limit in this model
    max_speed_mps: float = 4.0         # sped up for playability; real rovers drive ~0.04 m/s
    battery_wh: float = 2400.0         # usable battery capacity (simulation parameter)
    rtg_charge_w: float = 100.0        # continuous charging, RTG-style (simulation parameter)
    flat_wh_per_m: float = 0.35        # driving energy on flat firm ground
    drivetrain_eff: float = 0.5        # fraction of electrical energy that becomes lift work
    sand_energy_factor: float = 1.6    # extra energy in loose regolith
    rock_energy_factor: float = 1.25   # extra energy in boulder fields
    hotel_w: float = 60.0              # avionics/heaters while operating


ROVER = RoverParams()


def segment_energy_wh(dist_m: float, dh_m: float, terrain_factor: float = 1.0, p: RoverParams = ROVER) -> float:
    """Energy to drive one segment: rolling/driving cost scaled by terrain, plus climbing work.
    Descents recover nothing in this model (no regenerative braking)."""
    if dist_m <= 0:
        return 0.0
    grade = abs(dh_m) / dist_m
    rolling = dist_m * p.flat_wh_per_m * terrain_factor * (1.0 + 2.0 * grade)
    climb = max(0.0, dh_m) * p.mass_kg * G_MARS / p.drivetrain_eff / 3600.0
    return rolling + climb


def params_dict() -> dict:
    return asdict(ROVER)
