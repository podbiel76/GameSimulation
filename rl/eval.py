"""
rl.eval — ocena polityki: winrate przeciw baseline'owi skryptowemu.

    python -m rl.eval --model rl/models/ppo_1v1 --episodes 200 --n 1
    python -m rl.eval --policy random --episodes 200 --n 1     # baseline losowy (kontrola)

Bramka jakości (plan): winrate trenowanego agenta > baseline. Model abstrakcyjny.
"""

from __future__ import annotations

import argparse

import numpy as np

from rl.env import MicroBattleEnv


def _act(policy, model, obs, action_space, rng, obs_rms=None):
    if policy == "model":
        if obs_rms is not None:
            obs = np.clip((obs - obs_rms.mean) / np.sqrt(obs_rms.var + 1e-8), -10.0, 10.0)
        a, _ = model.predict(obs, deterministic=True)
        return a
    if policy == "random":
        return action_space.sample()
    if policy == "hold":
        return np.zeros(action_space.shape, dtype=action_space.dtype)
    raise ValueError(policy)


def evaluate(policy: str, model_path: str | None, episodes: int, n: int,
             opponent: str, seed: int, terrain_path: str | None = None,
             terrain_patch: bool = False) -> dict:
    model = None
    obs_rms = None
    if policy == "model":
        from stable_baselines3 import PPO
        model = PPO.load(model_path)
        # Wczytaj statystyki normalizacji obserwacji (jeśli zapisane przy treningu).
        import os, pickle
        vn_path = str(model_path) + "_vecnorm.pkl"
        if os.path.exists(vn_path):
            with open(vn_path, "rb") as fh:
                obs_rms = pickle.load(fh).obs_rms

    grid = None
    if terrain_path:
        from rl.terrain.grid import TerrainGrid
        grid = TerrainGrid.load(terrain_path)

    rng = np.random.default_rng(seed)
    wins = losses = draws = trunc = 0
    for ep in range(episodes):
        env = MicroBattleEnv(n_per_side=n, opponent_policy=opponent, terrain=grid,
                             terrain_patch=terrain_patch, seed=seed + ep)
        obs, _ = env.reset(seed=seed + ep)
        done = False
        info = {}
        while not done:
            action = _act(policy, model, obs, env.action_space, rng, obs_rms)
            obs, _r, terminated, truncated, info = env.step(action)
            done = terminated or truncated
        w = info.get("winner")
        if truncated and w is None:
            trunc += 1
        elif w == env.controlled_side:
            wins += 1
        elif w == env.enemy_side:
            losses += 1
        else:
            draws += 1

    total = max(1, episodes)
    return {
        "episodes": episodes, "wins": wins, "losses": losses,
        "draws": draws, "truncated": trunc,
        "winrate": round(wins / total, 3),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Winrate polityki vs baseline.")
    ap.add_argument("--policy", default="model", choices=["model", "random", "hold"])
    ap.add_argument("--model", default="rl/models/ppo", help="ścieżka modelu (dla --policy model)")
    ap.add_argument("--episodes", type=int, default=200)
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--opponent", default="advance", choices=["advance", "static"])
    ap.add_argument("--seed", type=int, default=10_000)
    ap.add_argument("--terrain", default=None, help="ścieżka siatki terenu (.npz)")
    ap.add_argument("--terrain-patch", action="store_true", help="lokalny skan terenu w obserwacji")
    args = ap.parse_args()

    res = evaluate(args.policy, args.model, args.episodes, args.n, args.opponent, args.seed,
                   args.terrain, args.terrain_patch)
    print(f"policy={args.policy} n={args.n} opponent={args.opponent}")
    print(f"  winrate={res['winrate']}  (W={res['wins']} L={res['losses']} "
          f"D={res['draws']} trunc={res['truncated']} / {res['episodes']})")


if __name__ == "__main__":
    main()
