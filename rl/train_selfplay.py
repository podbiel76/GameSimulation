"""
rl.train_selfplay — trening self-play (kamień M5).

Przeciwnik jest prowadzony MIGAWKĄ samego agenta (nie skryptem), losowaną z puli
ostatnich migawek (stabilność). Na starcie, zanim powstanie pierwsza migawka,
przeciwnik gra skryptem "advance". Rozmiar (n na stronę) ustala się flagą — curriculum
1v1→2v2→3v3 realizujemy uruchamiając kolejno z --n 1, 2, 3.

    python -m rl.train_selfplay --steps 800000 --n 2 --ent-coef 0.02 \
        --terrain rl/terrain/data/region_otm.npz --terrain-patch --out rl/models/sp_2v2

Model abstrakcyjny — polityka symulacyjna, nie realne doradztwo taktyczne.
"""

from __future__ import annotations

import argparse
import copy
import random
import tempfile
from pathlib import Path


def make_env_fn(n, seed, terrain_path, terrain_patch):
    from rl.env import MicroBattleEnv
    from rl.terrain.grid import TerrainGrid
    grid = TerrainGrid.load(terrain_path) if terrain_path else None

    def _fn():
        # start: przeciwnik skryptowy "advance"; po 1. migawce → set_opponent_model
        return MicroBattleEnv(n_per_side=n, opponent_policy="advance", terrain=grid,
                              terrain_patch=terrain_patch, seed=seed)
    return _fn


def main() -> None:
    ap = argparse.ArgumentParser(description="Self-play PPO na MicroBattleEnv.")
    ap.add_argument("--steps", type=int, default=800_000)
    ap.add_argument("--n", type=int, default=2)
    ap.add_argument("--n-envs", type=int, default=1)
    ap.add_argument("--ent-coef", type=float, default=0.02)
    ap.add_argument("--snapshot-freq", type=int, default=60_000, help="co ile kroków migawka przeciwnika")
    ap.add_argument("--pool-size", type=int, default=5)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--terrain", default=None)
    ap.add_argument("--terrain-patch", action="store_true")
    ap.add_argument("--init-from", default=None, help="ścieżka modelu do warm-startu (ten sam n)")
    ap.add_argument("--out", type=Path, default=Path("rl/models/sp"))
    args = ap.parse_args()

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecNormalize
        from stable_baselines3.common.callbacks import BaseCallback
    except ImportError as e:
        raise SystemExit(f"Brak stable-baselines3/torch: {e}")

    env_fns = [make_env_fn(args.n, args.seed + i, args.terrain, args.terrain_patch)
               for i in range(args.n_envs)]
    base = DummyVecEnv(env_fns) if args.n_envs <= 1 else SubprocVecEnv(env_fns)
    vec = VecNormalize(base, norm_obs=True, norm_reward=True, clip_obs=10.0)
    raw_envs = base.envs  # MicroBattleEnv (DummyVecEnv bez Monitora)

    if args.init_from:
        model = PPO.load(args.init_from, env=vec, device="cpu")
    else:
        model = PPO("MlpPolicy", vec, verbose=1, seed=args.seed, n_steps=512, batch_size=512,
                    ent_coef=args.ent_coef, device="cpu")

    tmpdir = tempfile.mkdtemp(prefix="selfplay_")

    class SelfPlayCallback(BaseCallback):
        def __init__(self):
            super().__init__()
            self.pool: list[tuple[str, object]] = []
            self.last = 0

        def _refresh_opponent(self):
            path = str(Path(tmpdir) / f"snap_{self.num_timesteps}.zip")
            self.model.save(path)
            rms = copy.deepcopy(vec.obs_rms)
            self.pool.append((path, rms))
            if len(self.pool) > args.pool_size:
                old_path, _ = self.pool.pop(0)
                try:
                    Path(old_path).unlink(missing_ok=True)
                except OSError:
                    pass
            sel_path, sel_rms = random.choice(self.pool)
            opp = PPO.load(sel_path, device="cpu")
            for env in raw_envs:
                env.set_opponent_model(opp, sel_rms)
            if self.verbose:
                print(f"[SELF-PLAY] migawka @ {self.num_timesteps}, pula={len(self.pool)}")

        def _on_step(self) -> bool:
            if self.num_timesteps - self.last >= args.snapshot_freq:
                self.last = self.num_timesteps
                self._refresh_opponent()
            return True

    cb = SelfPlayCallback()
    cb.verbose = 1
    model.learn(total_timesteps=args.steps, callback=cb)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(args.out))
    vec.save(str(args.out) + "_vecnorm.pkl")
    print(f"Zapisano model -> {args.out}.zip (+ _vecnorm.pkl)")


if __name__ == "__main__":
    main()
