"""
rl.train — trening agenta PPO na MicroBattleEnv (kamień M4: 1v1 vs baseline skryptowy).

    pip install -r rl/requirements.txt   # potrzebne: stable-baselines3, torch
    python -m rl.train --steps 300000 --n 1 --out rl/models/ppo_1v1

Self-play i curriculum 2v2→3v3 dochodzą w M5. Tu przeciwnik jest skryptowy ("advance"),
co daje stabilny, mierzalny baseline do oceny (rl.eval).

Model abstrakcyjny — polityka symulacyjna, nie realne doradztwo taktyczne.
"""

from __future__ import annotations

import argparse
from pathlib import Path


def make_env_fn(n: int, opponent: str, seed: int, terrain_path: str | None, terrain_patch: bool,
                asymmetric: bool = False, tactical_reward: bool = False, token_obs: bool = False):
    from rl.env import MicroBattleEnv
    from rl.terrain.grid import TerrainGrid

    grid = TerrainGrid.load(terrain_path) if terrain_path else None

    def _fn():
        return MicroBattleEnv(n_per_side=n, opponent_policy=opponent, terrain=grid,
                              terrain_patch=terrain_patch, asymmetric=asymmetric,
                              tactical_reward=tactical_reward, token_obs=token_obs, seed=seed)
    return _fn


def main() -> None:
    ap = argparse.ArgumentParser(description="Trening PPO na MicroBattleEnv.")
    ap.add_argument("--steps", type=int, default=300_000)
    ap.add_argument("--n", type=int, default=1, help="jednostek na stronę")
    ap.add_argument("--opponent", default="advance", choices=["advance", "static"])
    ap.add_argument("--n-envs", type=int, default=8)
    ap.add_argument("--ent-coef", type=float, default=0.01, help="premia entropii (eksploracja)")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--terrain", default=None, help="ścieżka siatki terenu (.npz); brak = syntetyczny")
    ap.add_argument("--terrain-patch", action="store_true", help="lokalny skan terenu w obserwacji")
    ap.add_argument("--asymmetric", action="store_true", help="losowa, różna liczba jednostek per strona")
    ap.add_argument("--tactical-reward", action="store_true", help="nagroda za eliminacje/zachowanie sił")
    ap.add_argument("--attention", action="store_true", help="obserwacja tokenowa + polityka attention")
    ap.add_argument("--tb-log", default="rl/runs", help="katalog logów TensorBoard")
    ap.add_argument("--eval-every", type=int, default=25_000, help="co ile kroków liczyć winrate")
    ap.add_argument("--eval-episodes", type=int, default=40)
    ap.add_argument("--out", type=Path, default=Path("rl/models/ppo"))
    args = ap.parse_args()

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import SubprocVecEnv, DummyVecEnv, VecNormalize
        from stable_baselines3.common.callbacks import BaseCallback
    except ImportError as e:
        raise SystemExit(
            "Brak stable-baselines3/torch. Zainstaluj:\n"
            "  pip install stable-baselines3 torch\n"
            f"(szczegóły: {e})"
        )

    env_fns = [make_env_fn(args.n, args.opponent, args.seed + i, args.terrain, args.terrain_patch,
                           args.asymmetric, args.tactical_reward, args.attention)
               for i in range(args.n_envs)]
    base = DummyVecEnv(env_fns) if args.n_envs <= 1 else SubprocVecEnv(env_fns)
    # Attention: obserwacja tokenowa z maską "alive" — NIE normalizujemy obserwacji
    # (psułoby maskę i flagi); transformer ma własny LayerNorm. Płaski model: VecNormalize.
    if args.attention:
        vec = VecNormalize(base, norm_obs=False, norm_reward=True, clip_obs=10.0)
        policy_kwargs = dict(features_extractor_class=__import__("rl.policy", fromlist=["UnitAttentionExtractor"]).UnitAttentionExtractor,
                             features_extractor_kwargs=dict(d_model=64, nhead=4, layers=2),
                             net_arch=[128])
    else:
        vec = VecNormalize(base, norm_obs=True, norm_reward=True, clip_obs=10.0)
        policy_kwargs = None

    # ── Callback: winrate vs baseline w trakcie treningu (najważniejszy sygnał „czy idzie dobrze") ──
    import numpy as np
    from rl.env import MicroBattleEnv
    from rl.terrain.grid import TerrainGrid
    eval_grid = TerrainGrid.load(args.terrain) if args.terrain else None

    class WinrateCallback(BaseCallback):
        def __init__(self):
            super().__init__()
            self.last = 0

        def _winrate(self) -> float:
            rms = vec.obs_rms if vec.norm_obs else None
            wins = 0
            for ep in range(args.eval_episodes):
                e = MicroBattleEnv(n_per_side=args.n, opponent_policy=args.opponent,
                                   terrain=eval_grid, terrain_patch=args.terrain_patch,
                                   asymmetric=args.asymmetric, token_obs=args.attention, seed=10**6 + ep)
                obs, _ = e.reset(seed=10**6 + ep); done = False; info = {}
                while not done:
                    o = obs if rms is None else np.clip(
                        (obs - rms.mean) / np.sqrt(rms.var + 1e-8), -10.0, 10.0).astype(np.float32)
                    act, _ = self.model.predict(o, deterministic=True)
                    obs, _r, term, trunc, info = e.step(act); done = term or trunc
                if info.get("winner") == e.controlled_side:
                    wins += 1
            return wins / max(1, args.eval_episodes)

        def _on_step(self) -> bool:
            if self.num_timesteps - self.last >= args.eval_every:
                self.last = self.num_timesteps
                wr = self._winrate()
                self.logger.record("eval/winrate_vs_baseline", wr)
                print(f"[EVAL] kroki={self.num_timesteps}  winrate_vs_{args.opponent}={wr:.3f}")
            return True

    # ent_coef > 0 zapobiega kolapsowi polityki do jednej akcji.
    # device: dla attention GPU może pomóc; dla małego MLP CPU jest szybsze.
    device = "cuda" if (args.attention and __import__("torch").cuda.is_available()) else "cpu"
    model = PPO("MlpPolicy", vec, verbose=1, seed=args.seed, n_steps=512, batch_size=512,
                ent_coef=args.ent_coef, device=device, tensorboard_log=args.tb_log,
                policy_kwargs=policy_kwargs)
    model.learn(total_timesteps=args.steps, callback=WinrateCallback(),
                tb_log_name=args.out.name)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    model.save(str(args.out))
    if vec.norm_obs:
        vec.save(str(args.out) + "_vecnorm.pkl")
    print(f"Zapisano model -> {args.out}.zip" + (" (+ _vecnorm.pkl)" if vec.norm_obs else ""))


if __name__ == "__main__":
    main()
