"""Smoke-test silnika symulacji: 1v1 dochodzi do rozstrzygnięcia bez wyjątków."""

from __future__ import annotations

import numpy as np

from rl.sim import Simulation, SimUnit
from rl.terrain.grid import TerrainGrid


def _company(uid, side, x, y, personnel=120, sa=4000, speed=10):
    return SimUnit(
        id=uid, side=side, x=x, y=y, unit_type="infantry",
        echelon="company_battery_troop", base_speed_kmh=speed,
        logistics={
            "personnel_total": personnel, "personnel_available": personnel,
            "ammo_small_arms": sa, "ammo_at": 20, "ammo_mortar": 250,
            "fuel_liters": 2000, "combat_effectiveness_percent": 100,
        },
        ao_half=1500.0,
    )


def test_1v1_resolves():
    terrain = TerrainGrid.synthetic((0.0, 0.0, 10000.0, 10000.0), ncols=64, nrows=64, seed=1)
    rng = np.random.default_rng(0)
    # AO nakładają się od startu (odległość < 2*ao_half)
    friendly = _company("F1", "friendly", 5000, 5000)
    hostile = _company("H1", "hostile", 6500, 5000, personnel=80, sa=1500)
    sim = Simulation([friendly, hostile], terrain, rng)

    winner = None
    for _ in range(20000):  # max ~ wystarczająco
        sim.step_tick()
        winner = sim.winner()
        if winner is not None:
            break

    assert winner is not None, "Starcie nie rozstrzygnęło się w limicie ticków"
    # Silniejsza/lepiej zaopatrzona strona (friendly) powinna zwykle wygrać.
    assert winner in ("friendly", "hostile", "draw")
    print(f"winner={winner} po {sim.tick} tickach; "
          f"F.personel={friendly.logistics['personnel_available']:.0f} "
          f"H.personel={hostile.logistics['personnel_available']:.0f}")


if __name__ == "__main__":
    test_1v1_resolves()
