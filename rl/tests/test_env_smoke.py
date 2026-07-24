"""Smoke-test środowiska Gymnasium: zgodność API + losowy rollout kończy epizod."""

from __future__ import annotations

import numpy as np

from rl.env import MicroBattleEnv


def test_env_api_and_rollout():
    env = MicroBattleEnv(n_per_side=1, seed=0)
    obs, info = env.reset(seed=0)
    assert env.observation_space.contains(obs), "obs poza observation_space"

    rng = np.random.default_rng(0)
    terminated = truncated = False
    steps = 0
    while not (terminated or truncated):
        action = env.action_space.sample()
        obs, reward, terminated, truncated, info = env.step(action)
        assert env.observation_space.contains(obs)
        assert np.isfinite(reward)
        steps += 1
    print(f"epizod zakończony po {steps} decyzjach; winner={info['winner']}")
    assert terminated or truncated


def test_check_env():
    try:
        from gymnasium.utils.env_checker import check_env
    except Exception:
        return
    check_env(MicroBattleEnv(n_per_side=2, seed=1), skip_render_check=True)


if __name__ == "__main__":
    test_env_api_and_rollout()
    test_check_env()
    print("OK")
