# GeoTactical — audyt architektoniczny

Spojrzenie „nowego seniora": rekonstrukcja architektury z kodu, potem lista problemów.
**Żadnych zmian w kodzie nie wprowadzono.**

---

## 1. Zrekonstruowana architektura

### 1.1 Cztery procesy

| Proces | Port | Plik startowy | Rola |
|---|---|---|---|
| Vite dev server (SPA) | 5173 | `vite.config.ts` | serwuje React, proxy do pozostałych |
| Express proxy | 3001 | `server/proxy.mjs` | proxy WMTS Geoportal + cache capabilities + mock GeoJSON + generyczny `/api/*` → 3002 |
| FastAPI backend | 3002 | `server/app/main.py` | jednostki, hierarchia, AO, logistyka, teren, YOLO, symulacja serwerowa |
| Agent RL (inferencja) | 8008 | `rl/serve.py` | `POST /agent/decide`, `GET /agent/health` |

Ruch sieciowy w dev jest **trzyskokowy** i niespójnie prefiksowany:

```
przeglądarka → :5173 (vite proxy)
                ├── /api/map-proxy → :3001 (Express) → mapy.geoportal.gov.pl
                ├── /api/*         → :3002 (FastAPI)      ← ale Express też ma catch-all /api → :3002
                ├── /agent/*       → :8008 (RL)
                └── /units,/simulation,/rules,/map → :3002
```

Powód ostatniej linii: `main.py:27-34` montuje część routerów z `prefix="/api"`, a `hierarchy`,
`map_routes`, `logistics`, `terrain` z `prefix=""`. Vite musi to nadrabiać czterema dodatkowymi regułami.

### 1.2 Warstwy frontendu

```
main.tsx  →  App.tsx (1492 linii — komponent-bóg)
             ├── stan domenowy: units, unitAreas, markers, fullState, detections
             ├── stan UI: 8 paneli, menu kontekstowe, radialne, zakładki, collapsed
             ├── lustro refów: unitsRef / unitAreasRef / markersRef / fullStateRef / selectedUnitIdRef
             ├── useLocalSimulation()   ← faktyczny silnik gry (804 linie)
             ├── polling agenta RL (3 s)
             ├── rejestrator przebiegu dla 3D (4 Hz, bez limitu)
             └── render
                 ├── map/MapView.tsx (947 l.) — OpenLayers 2D
                 ├── map/Globe3D.tsx (297 l.) — CesiumJS 3D
                 └── components/* — panele
```

### 1.3 Pełny przepływ danych — pętla symulacji

`useLocalSimulation.startSimulation()` = jeden `setInterval(..., 100)`. Każdy tick:

1. **Ruch** — dla każdego markera z trasą: `speedMpt = base_speed_kmh × terrainMod × 1000/36000`,
   interpolacja do najbliższego waypointu (`:235-333`).
2. **Propagacja w dół hierarchii** — pozycja i **wszystkie poligony AO potomków** przesuwane
   o ten sam wektor `(dx, dy)` (`moveAreaCoordsByWebMercatorDelta`).
3. **Paliwo** — `computeMovementFuelBurn` proporcjonalnie do przebytego dystansu.
4. **Co 10 ticków (1 s) — wykrycie starć:**
   `polygonsOverlap` na każdej parze (AO friendly × AO hostile) → graf dwudzielny → **BFS na
   spójnych składowych** → grupy bojowe. Rola (atakujący/obrońca) ustalana raz, po tym kto był
   w ruchu w chwili startu, i zamrażana w `attackerSide`.
5. **Potencjał i atrycja** — `computeUnitPotential` (5 kategorii × 5 modyfikatorów) →
   `baseLoss = potencjał_przeciwnika × 0.02` → `computeAttritionComponents` rozkłada stratę
   na ludzi/sprzęt/amunicję/paliwo/CE → warunki wypadnięcia z walki (brak ludzi / potencjał
   strony < progu / brak amunicji SA).
6. **Co 50 ticków (5 s)** — `PATCH /api/units/{id}/logistics` dla każdej jednostki z bufora.
7. **Po dojściu do celu** — `PATCH /units/{id}` + `PATCH` każdego AO, potem
   `refreshState()` + `refreshAreas()` = **pełny refetch świata**.
8. **Co 10 ticków, round-robin po jednej jednostce** — klasyfikacja terenu:
   `MapView.captureCanvasForArea()` → `canvas.toDataURL('image/png')` → base64 →
   `terrainClassifier` (dekod + maskowanie poligonem + klasyfikacja HSL per piksel) →
   nowy `terrainMod` i klasa terenu do refów.

### 1.4 Model walki — trzy niezależne implementacje

```
shared/combat_constants.json   ← deklarowane „jedyne źródło liczb" (GUARDRAIL.md §2)
        │
        ├── rl/constants.py → rl/combat_model.py, rl/sim.py     ✅ czyta plik
        ├── src/utils/combatPotential.ts + attritionRules.ts     ❌ ma liczby ZAHARDKODOWANE
        └── server/app/simulation_service.py + rules_service.py  ❌ własny, trzeci model
```

To jest najpoważniejsze pojedyncze odkrycie w tym audycie — rozwinięcie w §2.2.

---

## 2. Złe decyzje architektoniczne

### 2.1 Dwa konkurujące silniki symulacji, bez ustalonego źródła prawdy
`useLocalSimulation.ts` (klient, tick 100 ms) liczy ruch, starcia i zniszczenia, po czym
zapisuje wynik `PATCH`-em. Równolegle istnieje silnik serwerowy — `simulation_service.simulate_step`
+ `rules_service.run_all_rules`, wystawiony jako `/simulation/step-all`, `/units/{id}/simulate-step`,
`/simulation/run-rules` — i jest **wołany z UI** (`App.tsx:603, 610, 617, 627`). Oba mutują te same
wiersze. Brak wersjonowania, brak optimistic locking → *last writer wins*.

### 2.2 `shared/combat_constants.json` jest ignorowany przez frontend
`rl/constants.py:19` ładuje i waliduje plik. `src/utils/combatPotential.ts:146-321` zawiera te same
wagi, mnożniki terenu i `ECHELON_CAPS` **przepisane ręcznie**. Grep po `src/` za `combat_constants`
zwraca zero trafień. `rl/parity/*` porównują Python ↔ JSON, nie Python ↔ TypeScript, więc rozjazd
nie zostanie wykryty. Konsekwencja: agent RL trenuje przeciwko modelowi, który stopniowo przestaje
być modelem gry.

### 2.3 `App.tsx` jako komponent-bóg
1492 linie, ~40 `useState`, 8 `useRef`, ~25 `useEffect`. W jednym pliku: CRUD jednostek, rysowanie
obszarów, menu kontekstowe i radialne, widoczność szczebli, polling agenta, rejestrator 3D,
skróty klawiszowe, orkiestracja symulacji. Brak kontenera stanu, brak podziału na stan domenowy i UI.

### 2.4 Ręczna synchronizacja `useState` ↔ `useRef`
```ts
useEffect(() => { unitsRef.current = units; }, [units]);      // App.tsx:206
```
…dla units, areas, markers, fullState, selectedUnitId. Pętla symulacji pisze **dwiema drogami**:
`unitsRef.current = nextUnits` *oraz* `setUnits(nextUnits)` (`useLocalSimulation:680-686`).
Komponent czytający `units` w trakcie ticka widzi inną wartość niż pętla. To klasa błędów,
której się nie reprodukuje.

### 2.5 Klient jest autorytatywny dla stanu gry
Atrycja, zniszczenia i pozycje liczone w przeglądarce i wpychane na serwer. Dla jednoosobowego
trenażera to wybór; dla czegokolwiek wieloosobowego lub ocenianego — nie do obrony.

### 2.6 Symulacja zależy od tego, co jest aktualnie wyrenderowane
Klasa terenu — wejście do modelu walki — pochodzi z odczytu pikseli canvasu OpenLayers.
Zmiana podkładu (OSM ↔ ortofoto), poziomu zoomu albo niedoładowane kafelki **zmieniają wynik walki**.
`rl/terrain/grid.py` ma już właściwe rozwiązanie (pre-eksportowany raster terenu `.npz`) —
frontend z niego nie korzysta.

### 2.7 Migracje jako luźne skrypty
`migrate_bearing.py`, `migrate_unit_number.py`, `migrate_unit_number_v2.py`,
`migrate_logistics_v2..v5.py`, `migrate_custom_name.py`, `_v2.py`, `migrate_terrain_polygon.py`,
`migrate_base_speed.py`, `migrate_combat_effectiveness.py` + `Base.metadata.create_all(bind=engine)`
przy imporcie (`main.py:9`). Brak Alembic, brak kolejności, brak idempotencji, brak ścieżki w dół.
`server/geotactical.db` i katalogi `__pycache__` są w repozytorium.

### 2.8 CORS otwarty na oścież
`main.py:20-25` — `allow_origins=["*"]`, `allow_methods=["*"]`, `allow_headers=["*"]`, bez uwierzytelniania.

---

## 3. Zduplikowana logika

| # | Co | Gdzie | Uwaga |
|---|---|---|---|
| 1 | `UNIT_HIERARCHY_ORDER` + `UNIT_CHILDREN` | `data/symbolCatalog.ts:48-77` **i** `utils/hierarchyVisibility.ts:5-35` | **Definicje są sprzeczne** — patrz niżej |
| 2 | Cały komponent `MapView` | `map/MapView.tsx` (947 l., żywy) **i** `components/MapView.tsx` (395 l., martwy) | oba eksportują `BaseLayerType`; `FeaturePanel.tsx:2` i `LayerSwitcher.tsx:1` wciąż importują typy z martwego |
| 3 | Model potencjału/atrycji | `src/utils/*.ts`, `rl/combat_model.py`+`rl/sim.py`, `server/app/simulation_service.py` | trzy implementacje |
| 4 | `getDescendantIds` + budowa `childrenByParent` | `App.tsx:247-264` **i** `useLocalSimulation.ts:198-218` | identyczne co do znaku |
| 5 | Klasyfikacja terenu | `utils/terrainClassifier.ts`, `rl/terrain/classifier.py`, `server/app/terrain_service.py` | trzy algorytmy |
| 6 | Blok „sprawdź teren dla AO / dla punktu" | `useLocalSimulation.ts:141-184` (callbacki) **i** `:697-742` (inline w ticku) | ta sama logika, dwa razy |
| 7 | Zapis `readiness_status: "destroyed"` | `useLocalSimulation.ts:612-618` (friendly) **i** `:628-634` (hostile) | pętle różnią się tylko nazwą zmiennej |
| 8 | Mnożniki prędkości terenu | `useLocalSimulation.ts:24-31`, `combatPotential.ts:156-184`, `rl/sim.py:34` | trzy tabele |
| 9 | Paleta kolorów | `components/MapView.tsx:56+` — hex-e z komentarzem *„muszą zostać zsynchronizowane ręcznie z `:root` w index.css"* | jawnie udokumentowany dług |

**Rozjazd #1 — konkretne wartości:**

```
symbolCatalog.ts        hierarchyVisibility.ts
"Company_Battery"   vs  "Company_Battery_Troop"     ← inny identyfikator szczebla
Squad: null         vs  Squad: "Team_Crew"
(brak Team_Crew)    vs  Team_Crew: null
```
`App.tsx:5` importuje wersję z `hierarchyVisibility`. Kod sięgający po drugą dostaje urwany łańcuch
podległości i szczebel, który nie pasuje do nazw plików ikon.

---

## 4. Wąskie gardła wydajnościowe

### 4.1 `import.meta.glob(..., { eager: true })` + wyszukiwanie liniowe w katalogu symboli

> **ERRATA (zweryfikowane pomiarem).** Pierwsza wersja tego punktu mówiła o „~17 000 PNG"
> i nazywała to najdroższą linią w repo. **To był błąd.** Liczba 17 660 pochodziła z policzenia
> całego drzewa repozytorium razem z `node_modules` (15 836 plików). Faktyczny stan:
> `src/assets/APP-6A` = **270 plików PNG, 4 MB**. Przy tej skali `eager: true` jest akceptowalny
> i nie jest wąskim gardłem builda. Punkt spada z pozycji 1 na 5 w kolejności ważności —
> realne gardła to 4.2–4.5.

`data/symbolCatalog.ts:1-4`. `eager: true` wciąga każdy plik do grafu modułów (270 modułów).
Realny koszt runtime'owy leżał gdzie indziej: `getSymbolUrl` i `resolveSymbolForSize` robiły
`Array.find` po całym katalogu — wołane per jednostka per render warstwy mapy i wewnątrz
funkcji stylu OpenLayers.

**Status: naprawione** — indeks `Map<id, entry>`, dostęp O(1). `eager: true` zostaje świadomie:
wersja leniwa zwraca `() => Promise<string>`, co zerwałoby synchroniczne `getSymbolUrl()`
wymagane przez funkcje stylu OL. Przy wzroście katalogu o rząd wielkości właściwym ruchem jest
przeniesienie ikon do `public/APP-6A/` i budowanie URL-a ze stringa.

### 4.2 Tick 100 ms z niemutowalnymi przebudowami tablic
Na każdy poruszony marker: `nextUnits.map()`, `nextAreas.map()`, a w środku `affectedIds.includes()`
(O(d)). Potem jeszcze raz `nextUnits.map()` per jednostka w starciu (`:616`, `:632`).
Złożoność ≈ O(markery × jednostki × potomkowie) na tick → przy 300 jednostkach miliony alokacji/s.

### 4.3 Detekcja starć bez indeksu przestrzennego
`polygonsOverlap` (`geoUtils.ts:122-135`) — dla każdej pary AO: n+m testów punkt-w-poligonie,
a w najgorszym razie `vA × vB` przecięć odcinków. Brak prefiltru po bounding-boxie, **mimo że
`bbox` jest już w bazie i zwracany przez `full-state`** (`scenario.py:50`). 50 vs 50 jednostek
po 20 wierzchołków ≈ 10⁶ testów odcinków co sekundę.

### 4.4 `toDataURL` + dekodowanie base64 na wątku głównym, w pętli symulacji
`MapView.tsx:183, 209, 288, 337` — synchroniczny enkod PNG całego canvasu. Potem w
`terrainClassifier.ts:82-88` (powtórzone w trzech funkcjach):
```ts
const binary = atob(imageBase64);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
```
bajt po bajcie w JS, dla pełnego widoku. Następnie `createImageBitmap` + `getImageData` +
pętla po wszystkich pikselach. To wysadza budżet klatki. `convertToBlob` / `transferToImageBitmap`
+ Worker zdejmuje to z głównego wątku; docelowo — pre-eksportowany raster terenu zamiast pikseli.

### 4.5 `console.log` jako warstwa obserwowalności, wewnątrz pętli
- `[SIM]` — linia na każdy poruszony marker, każdy tick (`:253`)
- `[POTENCJAŁ]` — zagnieżdżony obiekt na jednostkę, przy każdym sprawdzeniu starcia (`:471-505`)
- `logCombat` — drugi taki obiekt na jednostkę (`:550-572`)
- `console.table` ×2 w `classifyTerrainFromCanvas` (`:249-250`)
- `console.log` w `compareCombatPotential` (`:656`)

Przy otwartym DevTools logowanie obiektów strukturalnych jest najdroższą operacją w pętli,
a konsola **trzyma referencje** → stały wzrost pamięci.

### 4.6 Warstwy OpenLayers przebudowywane od zera
Każdy z ~10 `useEffect` w `map/MapView.tsx` robi `source.clear()` i tworzy wszystkie `Feature`
na nowo. `setUnits` odpala się 10×/s, więc warstwy markerów, tras i obszarów są odbudowywane
dziesięć razy na sekundę.

### 4.7 Rejestrator 3D rośnie bez ograniczeń
`App.tsx:398-411` — próbka co 250 ms dla każdej żywej jednostki, nigdy nie przycinana.
100 jednostek × 10 minut = 240 000 krotek w pamięci; `recording` (useMemo) przelicza się co sekundę.

### 4.8 Pełny refetch świata po każdym dojściu do celu
`useLocalSimulation:770-771` → `get_full_state_data` serializuje units + routes + tracks +
assessments + rules + hierarchy + areas. Bez stronicowania, `Assessment` rośnie bez limitu.

### 4.9 Sekwencyjne `await` w pętlach wewnątrz ticka
`:748-769` — `for (finish) { await updateUnit; for (area) await updatePolygonArea }`
oraz flush logistyki `:670-676`. N round-tripów szeregowo w callbacku `setInterval(100)`;
przy przekroczeniu 100 ms kolejny tick startuje natychmiast, bez odstępu.

### 4.10 Polling agenta wysyła cały świat co 3 s
`App.tsx:340-364` — pełna lista żywych jednostek, a przy `aiSide === "both"` dwa żądania **szeregowo**.

---

## 5. Ryzyka skalowalności

1. **SQLite + jeden pisarz.** Klient PATCHuje logistykę każdej walczącej jednostki co 5 s.
2. **Zero stronicowania.** `/units` i `/units/full-state` zwracają wszystko.
3. **N+1 w `get_full_state_data`** — `a.unit.parent_links[0].parent_unit_id` (`scenario.py:49`)
   lazy-loaduje `unit` i `parent_links` dla każdego obszaru. `units`/`routes`/`tracks` mają
   `joinedload`, `areas` nie.
4. **`delete_unit` rekurencyjnie, 2 zapytania na węzeł** (`crud.py:346-363`) — bez CTE, bez `selectin`.
5. **Unikalność `unit_number` sprawdzana w Pythonie wzorcem read-then-write** (`crud.py:111-148`),
   bez `UNIQUE` w bazie → wyścig przy równoległych zapisach.
6. **Symulacja nie wychodzi poza jedną kartę przeglądarki.** Stan autorytatywny żyje w `useRef`.
   Brak trybu headless i szybszego-niż-realtime — a dokładnie tego potrzebuje trening RL,
   stąd `rl/sim.py` jako trzecia implementacja.
7. **Tick jest w czasie zegarowym, nie symulacyjnym.** `1000/36000` zaszywa „1 tick = 100 ms realne"
   w fizyce. Przeglądarki throttlują nieaktywne karty do ≥1 s → symulacja niepostrzeżenie zwalnia.
   Brak akumulatora / stałego kroku → **wyniki nie są odtwarzalne**.
8. ~~**17k assetów kopiowanych do `dist/assets`**~~ — **błąd, patrz errata w §4.1.**
   Faktycznie 270 plików / 4 MB. Nie jest to problem skalowalności.
9. **Brak uwierzytelniania + otwarty CORS** — w sieci każdy może przepisać scenariusz.

---

## 6. Utrzymywalność

1. **Zero testów frontendu.** `package.json` nie ma skryptu `test` ani runnera w `devDependencies`.
   Najbardziej złożona logika w repo (`useLocalSimulation`, `combatPotential`) jest nieprzetestowana.
   Python ma `rl/tests` i `rl/parity` — asymetria jest uderzająca.
2. **`as any` na granicy typów, w ścieżce gorącej.** `computeUnitPotential(u as any, …)`,
   `computeAttritionComponents(u as any, …)`, `applyAttritionComponents(…) as Unit`,
   `unitMap as Map<string, any>` (`:281, 512, 521, 540-541, 609, 611, 625, 627`).
   `Unit.logistics` i `ExtendedLogistics` to dwa różne kształty siłowo złączone —
   zmiana nazwy pola skompiluje się i wybuchnie w runtime.
3. **`startSimulation` to jeden callback na ~580 linii**, z funkcjami deklarowanymi w środku
   (`getDescendantIds`, `logPotential`, `logCombat`, `markDefeatedIfNeeded`, `hasRoute`, `roleForSide`)
   — tworzonymi na nowo **co tick**.
4. **`alert()` jako kanał błędów** (`App.tsx:451, 463, 493`) w aplikacji, która ma już własny
   system powiadomień (`defeatNotices`).
5. **Mieszanka językowa bez warstwy i18n** — komentarze i klucze logów po polsku
   (`stratyTick`, `czołgi`, `spalPaliwo`), kod po angielsku, teksty UI wklejone w `alert()`.
6. **Magiczne liczby w TS, poza wspólnym plikiem stałych**: `ATTRITION_COEFFICIENT = 0.02`,
   `ENGAGEMENT_CHECK_TICKS = 10`, `ATTRITION_PERSIST_TICKS = 50`,
   `SIDE_DEFEAT_POTENTIAL_DISPLAY = 1.0`, `1000/36000`, `/30` (amunicja na żołnierza),
   `0.3` (indirectFloor), `0.75` (domniemana amunicja pojazdów).
7. **Kod martwy / półpodpięty**: `components/MapView.tsx`, `simulateUnitStep`/`simulateAllStep`/
   `runRules`, `check_state.py`, `add_test_terrain.py`, 10 skryptów `migrate_*.py` w korzeniu serwera.
8. **`isParentOfVisible` liczone i nieużywane** — `hierarchyVisibility.ts:133-136`.
9. **Leniwe importy maskujące cykl** — `from .presumed import …` i
   `from .services.unit_area_service import …` wewnątrz funkcji (`crud.py:373, 418`).
10. **`except Exception: pass`** połyka błędy terenu (`crud.py:208-209, 297-298`).
11. **Dwa arkusze stylów na te same klasy** — `index.css` (3258 l.) + `aicommand.css` (2013 l.),
    ten drugi importowany po pierwszym i działający jako sheet nadpisujący. Bez warstw CSS,
    bez konwencji nazewniczej.
12. **`// eslint-disable-next-line no-console`** w kilku miejscach, przy braku ESLint
    w `devDependencies` — reguła, której nikt nie egzekwuje.

---

## 7. Kolejność napraw (bez zmiany architektury)

Każdy punkt jest zgodny z obecnym stylem projektu i nie zmienia zachowania widocznego dla użytkownika.

**Tydzień 1 — tanio, duży efekt, zerowe ryzyko**
1. `eager: false` w `symbolCatalog.ts` + `Map<id, entry>` zamiast `Array.find`.
2. Ściszenie logów: `const SIM_DEBUG = import.meta.env.DEV && false` — jeden strażnik na
   `[SIM]`, `[POTENCJAŁ]`, `logCombat`, `console.table`.
3. Prefiltr `bbox` przed `polygonsOverlap` (bbox już jest w danych).
4. Usunięcie `components/MapView.tsx`, przeniesienie `LayerName`/`BaseLayerType`/`FeatureSelectPayload`
   do `src/types/map.ts`.
5. Usunięcie `UNIT_HIERARCHY_ORDER`/`UNIT_CHILDREN` z `symbolCatalog.ts` (re-eksport z `hierarchyVisibility`).

**Tydzień 2 — dług strukturalny**
6. `src/shared/combatConstants.ts` importujący `shared/combat_constants.json`; usunięcie
   zahardkodowanych liczb z `combatPotential.ts` i `attritionRules.ts`.
7. Parity-test TS↔PY w CI (Vitest po stronie TS na tym samym JSON-ie).
8. Rozbicie `startSimulation` na `moveUnits()` / `detectEngagements()` / `applyAttrition()` / `persist()`
   — funkcje modułowe, nie zagnieżdżone w callbacku.
9. `joinedload` dla `areas` w `get_full_state_data`; ograniczenie `assessments`.

**Tydzień 3+ — decyzje wymagające Twojego rozstrzygnięcia**
10. Wybór jednego silnika symulacji (klient albo serwer) i usunięcie/oznaczenie drugiego.
11. Zastąpienie klasyfikacji z pikseli canvasu rastrem terenu z `rl/terrain/data/*.npz`.
12. Stały krok czasowy z akumulatorem → odtwarzalność i odporność na throttling kart.
13. Alembic zamiast skryptów `migrate_*.py`; `geotactical.db` i `__pycache__` do `.gitignore`.

---

## 7a. Stan wykonania (aktualizacja)

| § | Punkt | Status |
|---|---|---|
| 7.1 | Katalog symboli — indeks O(1) | ✅ zrobione (+ errata do 4.1) |
| 7.2 | Wyciszenie logów w pętli | ✅ zrobione — `src/utils/debug.ts` |
| 7.3 | Prefiltr bbox przed `polygonsOverlap` | ✅ zrobione |
| 7.4 | Usunięcie martwego `components/MapView.tsx` | ✅ zrobione, typy → `types/map.ts` |
| 7.5 | Jedno źródło hierarchii szczebli | ✅ zrobione |
| 7.6 | TS czyta `combat_constants.json` | ⏸️ **świadomie pominięte** — zamiast tego strażnik parity (niżej) |
| 7.7 | Parity-test TS↔JSON | ✅ zrobione — `rl/parity/test_ts_json_parity.py`, 10/10 |
| 7.8 | Rozbicie `startSimulation` | ⏸️ **świadomie pominięte** — kod usuwany w wariancie A |
| 7.9 | `joinedload` + limit assessments | ✅ zrobione |
| 7.10–13 | Silnik / teren / krok czasu / Alembic | → wariant A |

**Wynik diagnostyki 7.6:** TS i `shared/combat_constants.json` są **identyczne co do wartości** —
13/13 szczebli `ECHELON_CAPS`, wszystkie 4 tabele potencjału, wszystkie stałe pętli,
`terrainSpeedModifiers`. Model gry i model RL jeszcze się nie rozeszły. Zamiast przepinać
`combatPotential.ts` na wspólny JSON (praca do wyrzucenia — plik znika w wariancie A) dodany
został test, który wywala się przy pierwszym rozjeździe. Chroni przez cały okres migracji,
gdy oba modele muszą współistnieć.

---

## 8. Kryteria ukończenia

Punkty 1-9 z §7 są zmianami zachowawczymi: nie ruszają API, kontraktów danych ani logiki
rozstrzygania walki. Weryfikacja bez uruchamiania testów (których nie ma):

- `npm run build` — `tsc && vite build` musi przejść bez nowych błędów; czas builda powinien
  wyraźnie spaść po pkt. 1.
- Scenariusz dymny: wczytanie jednostek → narysowanie AO → trasa → start symulacji → starcie →
  zniszczenie jednostki → restart aplikacji (stan przetrwał w bazie).
- Porównanie `staticPotential`/`effectivePotential` dla tej samej jednostki przed i po pkt. 6
  — muszą być identyczne co do bitu, inaczej `shared/combat_constants.json` już rozjechał się z TS
  (co samo w sobie byłoby wynikiem wartym zaraportowania).
