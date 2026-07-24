"""
rl.policy — ekstraktor cech z self-attention nad jednostkami (Faza 2, B2).

Obserwacja to zbiór tokenów-jednostek (B, T, F): pierwsze n = własne (z 8-kier. skanem),
kolejne n = wrogie. Cecha [1] ("alive") służy jako maska (token nieobecny = padding).

Self-attention sprawia, że KAŻDA jednostka „widzi" wszystkie pozostałe (sojuszników i wrogów),
a pooling po wrogach jest permutacyjnie-niezmienniczy → lepsze, skalowalne decyzje (zmienne N).

Model abstrakcyjny — polityka symulacyjna, nie realne doradztwo.
"""

from __future__ import annotations

import torch
import torch.nn as nn
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor


class UnitAttentionExtractor(BaseFeaturesExtractor):
    def __init__(self, observation_space, d_model: int = 64, nhead: int = 4, layers: int = 2):
        t, f = observation_space.shape          # (T, F)
        n_own = t // 2
        features_dim = d_model * (n_own + 1)     # global + n_own embeddingów własnych
        super().__init__(observation_space, features_dim)
        self.n_own = n_own
        self.embed = nn.Linear(f, d_model)
        enc = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=d_model * 2,
            batch_first=True, dropout=0.0,
        )
        self.encoder = nn.TransformerEncoder(enc, num_layers=layers)

    def forward(self, obs: torch.Tensor) -> torch.Tensor:
        # obs: (B, T, F); cecha alive = kolumna 1
        alive = obs[:, :, 1]                      # (B, T)
        pad = alive < 0.5                          # True = padding (ignorowane przez attention)
        # zabezpieczenie: token-zapytanie w pełni zamaskowanego wiersza dałby NaN
        all_pad = pad.all(dim=1)
        if all_pad.any():
            pad = pad.clone(); pad[all_pad, 0] = False

        x = self.embed(obs)                        # (B, T, d)
        z = self.encoder(x, src_key_padding_mask=pad)   # (B, T, d)

        valid = (~pad).float().unsqueeze(-1)       # (B, T, 1)
        glob = (z * valid).sum(1) / valid.sum(1).clamp(min=1.0)   # masked mean (B, d)

        own_valid = (~pad[:, :self.n_own]).float().unsqueeze(-1)
        own = (z[:, :self.n_own, :] * own_valid).reshape(z.size(0), -1)   # (B, n_own*d)
        return torch.cat([glob, own], dim=1)
