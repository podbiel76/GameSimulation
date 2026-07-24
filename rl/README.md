# rl — agent decyzyjny (RL self-play) dla symulatora

Bezgłowe środowisko + trening agenta, który decyduje o ruchach jednostek, by wygrać
starcie. **Abstrakcyjna miara symulacyjna — nie realne doradztwo taktyczne.** Pełny plan:
`C:\Users\patry\.claude\plans\shimmering-stirring-fiddle.md`.

## Zasada: jedno źródło prawdy dla liczb

Wszystkie stałe modelu walki żyją w **`shared/combat_constants.json`**. Używają ich oba światy:
- TypeScript: `src/utils/combatPotential.ts`, `src/utils/attritionRules.ts`, `src/hooks/useLocalSimulation.ts`
- Python: `rl/constants.py` (loader + walidacja)

Logika (kształt wzorów) jest w obu implementacjach; **parity-testy** pilnują, by dawały
identyczne wyniki, więc liczby nie mogą się rozjechać.

## Status (kamienie milowe)

- [x] **M1** — ekstrakcja stałych do JSON + szkielet parity-testów
- [x] **M2** — port klasyfikatora terenu (parity z TS), format+loader siatki, eksporter
  z kafelków mapy *(pozostaje uruchomić eksport dla wybranego regionu — patrz niżej)*
- [x] **M3** — port walki+atrycji+ruchu (`rl/combat_model.py`, `rl/sim.py`) + Gymnasium env
  (`rl/env.py`); **parity vs TS** (potencjał + atrycja raw), `check_env` przechodzi
- [x] **M4** — trening PPO 1v1 vs baseline: agent **0.82** > hold 0.73 (`rl/train.py`, `rl/eval.py`)
- [x] **M5** — self-play (`rl/train_selfplay.py`, pula migawek) + curriculum 1v1/2v2/3v3.
  Wyniki vs skrypt „advance": 1v1 **0.82**, 2v2 **0.80**, 3v3 **0.67** (po 2M kroków, 6 env;
  ≈ hold 0.68 — większa przestrzeń akcji 9^n skaluje się trudniej). Wniosek: *vs skrypt* daje
  mocne liczby na konkretnym przeciwniku, *self-play* daje odporność (head-to-head: dwa myślące
  agenty najczęściej grają na pat — realistyczne „obrońca vs obrońca").
- [ ] M5 — self-play + curriculum 2v2→3v3
- [x] **M6** — serwowanie: `rl/serve.py` (`/agent/decide`) + proxy `/agent`→8008 +
  przełącznik „Agent AI" w UI + marsz zbliżania. Agent zwraca trasy → istniejący ruch je wykonuje.
- [x] **M7** — percepcja: detektor YOLO → typ/szczebel/strona (`rl/perception.py`,
  `server/app/presumed.py`); wykryty wróg dostaje **domniemaną logistykę** (siła z typu/szczebla,
  bo detekcja jej nie podaje) → jest zdolny do walki. Dane w `shared/combat_constants.json` (`presumed`).
- [x] **M8** — guardrail/framing: widoczny disclaimer w UI, nota w `/agent/decide`, nagłówki
  modułów, audyt zgodności w `rl/GUARDRAIL.md` (brak doktryny / internetu w runtime / pełnego modelu walki).

## Setup

```bash
pip install -r rl/requirements.txt
python -m rl.constants          # self-check: wczytuje i waliduje stałe
```

## Parity (TS ↔ Python)

```bash
# 1) zrzut referencji z PRAWDZIWEGO modelu TS:
npx tsx rl/parity/generate_golden.ts        # -> rl/parity/golden_potential.json
# 2) porównanie portu Pythona z referencją:
pytest rl/parity/test_parity.py
```

Dopóki port Pythona (`rl/combat_model.py`, M3) nie istnieje, `test_potential_parity`
jest pomijany (skip). `generate_golden.ts` testuje deterministyczną część modelu
(`computeUnitPotential`); parity atrycji (losowy `stochRound`) dochodzi w M3 wraz z
seedowalnym RNG.

## Teren (M2)

Siatka terenu (`rl/terrain/grid.py::TerrainGrid`) pokrywa prostokąt w EPSG:3857 i dla
punktu zwraca klasę terenu (`class_at(x, y)`), używaną przez env. Klasyfikacja pikseli
jest portem `src/utils/terrainClassifier.ts` (`rl/terrain/classifier.py`) — parity:

```bash
npx tsx rl/parity/generate_golden_terrain.ts
pytest rl/parity/test_terrain_parity.py
```

Realny eksport z kafelków mapy (ten sam styl co basemap w grze — domyślnie OSM):

```bash
pip install Pillow
python -m rl.terrain.export_terrain --bbox MINLON MINLAT MAXLON MAXLAT \
    --zoom 16 --window 16 --out rl/terrain/data/<region>
```

Do czasu wybrania regionu env może użyć `TerrainGrid.synthetic(bbox)` (deterministyczne
płaty) — wyłącznie do odblokowania rozwoju, nie do finalnego treningu.

## Widok 3D (CesiumJS, Faza 3)

Przełącznik **2D / 3D** (prawy-górny róg mapy) → `src/map/Globe3D.tsx` (helpery `cesiumScene.ts`):
glob 3D, jednostki jako symbole APP-6A, AO i trasy na terenie, **oś czasu ze smugami** (rejestrator
przebiegu w `App.tsx` → `SampledPositionProperty` + `path` + widgety czasu Cesium), **efekty**
(puls starcia, ✕ przy zniszczeniu) i **heatmapa zagrożenia** (🔥, canvas potencjału wrogów).
Relief terenu: ustaw darmowy token w `.env` → `VITE_CESIUM_ION_TOKEN=...` (bez tokena glob jest
płaski). Mechanika sim/agenta nietknięta — to warstwa wizualizacji.

## Zobaczyć agenta w grze (M6)

Trzy procesy (każdy w swoim oknie):
```bash
# 1) backend gry (FastAPI) — port 3002
cd server && uvicorn app.main:app --port 3002 --reload
# 2) serwis agenta RL (SB3+torch) — port 8008
python -m rl.serve
# 3) frontend (Vite) — port 5173 (po zmianie proxy /agent wymaga świeżego startu)
npm run dev
```
W aplikacji: postaw jednostki obu stron → **Uruchom symulację** → panel **„Agent AI"**
(lewy-górny róg mapy) → wybierz stronę (Sojusz./Wrogie/**Oba — AI vs AI**). Co 3 s agent
pobiera trasy z `/agent/decide` i jednostki ruszają się po mapie. Model dobierany po liczbie
jednostek sterowanej strony (1→1v1, 2→2v2, 3→3v3).

**Odporność serwisu (po nauczce z testów w grze):**
- *Orientacja* — modele `_rot` trenowane z **losową orientacją** spawnu → agent orientuje się
  względem wroga w dowolnym układzie (nie tylko „wróg na wschodzie", co wcześniej dawało
  pozorną „ucieczkę"). 1v1_rot ≈ 0.79, 2v2_rot ≈ 0.70 vs hold ~0.65.
- *Skala* — obserwacja liczona w oknie o stałym rozmiarze (jak w treningu) wokół własnych sił;
  gdy najbliższy wróg jest dalej niż ~2.5 km, jednostka **maszeruje wprost na niego** (marsz
  zbliżania), a wyuczona taktyka przejmuje w zwarciu. Bez tego daleko rozstawione jednostki
  rozłaziły się (poza zasięgiem/dystrybucją treningu).
- Modele `_rot` (odporne na orientację): 1v1 ≈ 0.79, 2v2 ≈ 0.70, 3v3 ≈ 0.66.

### Model taktyczny (`ppo_tactics`) — SERWOWANY DOMYŚLNIE

Jeden model (3 sloty, obsługuje 1–3 jedn. i nierówne siły) trenowany z **asymetrią sił** +
**nagrodą taktyczną** (`--asymmetric --tactical-reward`): `+0.5` za eliminację wroga (koncentracja),
`−0.5` za stratę własnej jednostki + pat≠porażka (zachowanie sił / odwrót). Walidacja behawioralna
(`rl/behavior_check.py`):
- **3v1**: winrate **100%**, własni ocaleni **2.98/3**, wróg 0/1 → eksploatuje przewagę (koncentracja).
- **1v3**: **100% ruchu „od wroga"** na średnim dystansie → wycofuje się zamiast szarżować.
- 2v2: ~52% (równy bój).

Serwis (`rl/serve.py`) używa tego jednego modelu dla wszystkich liczebności (padding do 3 slotów).

### Faza 2 — tryb doradczy + polityka attention (SERWOWANY: `ppo_attn`)

**Tryb doradczy (human-in-the-loop):** panel „Agent AI" ma przełącznik **Doradza / Steruje**.
W trybie *Doradza* `/agent/decide` zwraca per jednostkę **etykietę** (natarcie / trzymaj / odwrót /
flankowanie) + **uzasadnienie** (stosunek sił, teren); UI pokazuje listę rekomendacji + „Zastosuj",
a mapa rysuje fioletowego „ducha" trasy. W *Steruje* — agent rusza sam (jak w M6).

**Polityka attention (`rl/policy.py::UnitAttentionExtractor`):** obserwacja to **zbiór tokenów-
jednostek** (env `token_obs=True`, `(2n, F)`); self-attention sprawia, że każda jednostka „widzi"
wszystkie, pooling po wrogach jest permutacyjnie-niezmienniczy. **Skaluje do 6 na stronę i
zmiennych/nierównych sił.** Trening: `--attention --asymmetric --tactical-reward` (GPU, bez
VecNormalize — transformer ma LayerNorm). Walidacja (`rl/behavior_check.py`):
- **3v1** winrate 98% (≈0 strat), **5v3** 98% (4.9/5 ocalonych) → eksploatacja przewagi,
- **1v3** 100% „od wroga", **3v5** trzymaj/odwrót → zachowanie sił,
- **5v5** ~52% → obsługuje skalę, której stary 3-slotowy model w ogóle nie reprezentował.

## Środowisko i trening (M3/M4)

- `rl/sim.py` — bezgłowy silnik (ruch, nakładanie AO, role, atrycja, porażki).
- `rl/env.py` — `MicroBattleEnv` (Gymnasium): agent steruje jedną stroną (≤3 jedn.),
  akcja per jednostka = 0 trzymaj / 1..8 kierunek; nagroda = Δ potencjałów + ±1 terminalne.
- `rl/train.py` — PPO (Stable-Baselines3), `rl/eval.py` — winrate vs baseline.

```bash
pip install stable-baselines3 torch        # cięższe zależności treningu
python -m rl.train --steps 300000 --n 1 --opponent advance --out rl/models/ppo_1v1
python -m rl.eval  --policy model --model rl/models/ppo_1v1 --episodes 200 --n 1
```

### Wynik 1v1 (realny teren OTM, przeciwnik „advance")

Baseline: losowa ≈ 0.58, „trzymaj pozycję" ≈ 0.73. **Trenowany agent PPO: ≈ 0.77 (500k kroków),
≈ 0.82 (1M kroków)**, polityka stanowo-zależna (pełne spektrum manewrów, nie zdegenerowana) —
bije oba baseline'y i niemal nie ma nierozstrzygnięć.

Działająca konfiguracja:
```bash
python -m rl.train --steps 500000 --n 1 --ent-coef 0.02 \
    --terrain rl/terrain/data/region_otm.npz --terrain-patch --out rl/models/ppo_1v1
python -m rl.eval --policy model --model rl/models/ppo_1v1 --episodes 300 --n 1 \
    --terrain rl/terrain/data/region_otm.npz --terrain-patch
```

### Wnioski z dostrajania (ważne — nie powtarzać błędów)

1. **Skala ruchu musi być w skali areny.** Najpierw jednostka przejeżdżała ~1000 jedn./epizod
   przy AO 1500 i rozstawie 2700 → akcje nie zmieniały wyniku → brak gradientu → polityka
   kolapsowała do jednej akcji. Fix: arena ~1800, AO ~400, rozstaw ~900 (env `arena_size`,
   `ao_half`, `spawn_sep`), losowana w obrębie siatki co epizod.
2. **Symetryczna logistyka obu stron.** Losowa przewaga sił dominowała nad taktyką (szum > sygnał).
   Stała, równa logistyka → wynik zależy od pozycji/terenu/roli, czyli od decyzji agenta.
3. **VecNormalize (normalizacja obserwacji).** Bez niej PPO kolapsował; statystyki zapisywane
   jako `*_vecnorm.pkl` i wczytywane w `rl.eval`.
4. **`ent_coef` > 0** (SB3 ma domyślnie 0.0) — bez tego polityka traci eksplorację.
5. **`device="cpu"`** — dla małego MLP szybsze niż GPU.
6. **Skan terenu** (`--terrain-patch`): 8 kierunków mod. obronnego wokół jednostki → agent
   „widzi", gdzie jest las, i może tam manewrować.
```
