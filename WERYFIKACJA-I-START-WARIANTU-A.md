# Weryfikacja zmian + wejście w wariant A

Dwie części: (1) co sprawdzić, żeby potwierdzić, że nic nie zepsułem,
(2) co zmierzyć i ustalić, żeby ruszyć z wariantem A.

---

# CZĘŚĆ 1 — Regresja po naprawach

## 1.0 Zanim zaczniesz

W drzewie roboczym były **już wcześniej niezacommitowane zmiany w 18 plikach** (m.in. `App.tsx`,
`index.css`, `main.tsx`, panele). Moje zmiany doszły na wierzch. Przed testami warto zrobić commit
rozdzielający — inaczej przy ewentualnym `git revert` cofniesz też cudzą pracę.

Pliki, które zmieniłem:

```
src/utils/debug.ts                      (nowy)
src/utils/geoUtils.ts
src/utils/terrainClassifier.ts
src/utils/combatPotential.ts            ← miał już Twoje zmiany
src/hooks/useLocalSimulation.ts
src/data/symbolCatalog.ts
src/types/map.ts
src/map/MapView.tsx
src/components/FeaturePanel.tsx
src/components/LayerSwitcher.tsx        ← miał już Twoje zmiany
src/components/MapView.tsx              (USUNIĘTY)
server/app/routes/scenario.py
server/app/services/unit_area_service.py
rl/parity/test_ts_json_parity.py        (nowy)
```

Uwaga: `src/utils/combatPotential.ts` ma zakończenia linii **CRLF**, przez co `git diff` pokazuje
cały plik jako zmieniony. To stan sprzed moich edycji. Realna zmiana to 7 linii —
sprawdzisz przez `git diff --ignore-all-space -- src/utils/combatPotential.ts`.

## 1.1 Build — u siebie, nie u mnie

```
npm run build
```

`tsc --noEmit` przechodzi u mnie czysto (0 błędów). **`vite build` nie dało się uruchomić**
w moim środowisku: `node_modules` jest zainstalowane pod Windows i brakuje linuksowego
`@rollup/rollup-linux-x64-gnu`. Świadomie **nie robiłem `npm install`**, bo nadpisałby Twoje
windowsowe binaria. To jedyny krok, którego nie zweryfikowałem — zrób go pierwszy.

## 1.2 Testy parity (Python)

```
pytest rl/parity/test_ts_json_parity.py -v
```

Oczekiwane: **10 passed**. U mnie przechodzi. Ten test od teraz pilnuje, żeby liczby w TS
nie rozjechały się z `shared/combat_constants.json`.

## 1.3 Ikony symboli — najszerszy zasięg zmiany

Zmieniłem `getSymbolUrl` i `resolveSymbolForSize` z `Array.find` na `Map.get`. Jeśli gdzieś
zgubiłem klucz, ikona zniknie (pusty `src`), a nie wysypie się aplikacja — dlatego trzeba
obejrzeć, nie tylko kliknąć.

| Gdzie | Co ma być widoczne |
|---|---|
| Lista jednostek (lewy panel) | ikona przy każdej jednostce, friendly i hostile |
| Panel wybranej jednostki | duża ikona u góry + ikony jednostek podległych |
| Mapa 2D | symbole na markerach |
| Widok 3D (Cesium) | symbole na globie |
| Dialog stawiania jednostki | siatka typów **oraz podgląd przy zmianie szczebla** |

**Najważniejszy z nich to ostatni.** W dialogu stawiania przełącz szczebel (Brygada → Batalion →
Kompania…) i sprawdź, że podgląd ikony zmienia się przy każdym kroku. To jedyne miejsce
wołające `resolveSymbolForSize`. Jeśli podgląd znika przy którymś szczeblu — to moja regresja.

## 1.4 Wykrywanie starć — zmiana o najwyższym ryzyku

Dodałem prefiltr AABB przed testem nakładania poligonów. Prefiltr jest zachowawczy (odrzuca
tylko pary o rozłącznych prostokątach otaczających, a takie nie mogą się nakładać), ale to
zmiana w ścieżce, która decyduje o tym, czy walka w ogóle się zaczyna.

Scenariusz do przejścia:

1. Postaw jednostkę friendly i hostile, obu narysuj AO.
2. Ustaw je tak, żeby AO **się nie stykały**. Uruchom symulację → **nie ma starcia**.
3. Wyznacz friendly trasę wjeżdżającą w AO hostile. Uruchom → **starcie się zaczyna**:
   podświetlenie jednostek na liście, panel starcia, spadające zasoby w logistyce.
4. Sprawdź przypadek brzegowy: AO stykające się **rogiem**, bez wspólnego pola.
   Zachowanie musi być takie samo jak przed zmianą (prefiltr traktuje stykające się prostokąty
   jako nakładające, więc przechodzi do właściwego testu).
5. Sprawdź **AO zawarte w AO** (mała jednostka w środku dużej) → starcie ma być wykryte.

Jeśli w kroku 3 lub 5 starcie nie startuje — cofnij `computeBbox`/`bboxesOverlap`
w `src/utils/geoUtils.ts` i daj znać, bo to znaczy, że współrzędne AO nie są w tym układzie,
w którym zakładam.

## 1.5 Teren — czy modyfikatory się nie zmieniły

Wyłączyłem domyślnie tryb debug w `classifyTerrainFromCanvas` i pominąłem obliczenia, które
służyły tylko do wydruku. **Zwracana wartość (`terrain`, `confidence`) jest niezmieniona** —
liczą ją `counts[]`, których nie ruszałem.

1. Zaznacz jednostkę, wywołaj sprawdzenie terenu.
2. Podgląd kafelka terenu i nazwa klasy (`las` / `teren zabudowany` / …) mają się pokazać jak wcześniej.
3. W trakcie ruchu prędkość jednostki ma się zmieniać w zależności od terenu (las wolniej niż droga).

## 1.6 Logi — cisza domyślnie, dostępne na żądanie

Uruchom symulację z otwartą konsolą. Oczekiwane:

- **Brak** `[SIM]`, `[POTENCJAŁ]`, `[COMBAT POTENTIAL]`, `console.table` z terenu.
- **Są** zdarzenia: `[ENGAGEMENT] START/END`, `[ZNISZCZONA]`, `[PRZEGRANA]`, `[PODDANIE]`.
  Zostawiłem je celowo — to sygnał, nie szum.

Włączenie pełnej diagnostyki bez przebudowy:

```js
localStorage.setItem("geotactical.simDebug", "1"); location.reload();
```

Sprawdź, że po tym wszystkie stare logi wracają. Wyłączenie: `removeItem` + reload.

**To jest miejsce na Twój pierwszy pomiar.** Porównaj płynność mapy przy włączonym
i wyłączonym `simDebug` na tym samym scenariuszu — różnica pokaże, ile realnie kosztowało logowanie.

## 1.7 Backend — obszary i oceny

1. `GET /api/units/full-state` — w tablicy `areas` każdy wpis ma nadal wypełnione
   `unit_echelon` i `parent_unit_id`. To sprawdza, czy `joinedload` nie zgubił relacji.
2. Hierarchia w UI (drzewo podległości, zagnieżdżone AO) rysuje się poprawnie — to ten sam odczyt.
3. Panel ocen pokazuje wpisy. **Uwaga na zmianę zachowania:** `full-state` zwraca teraz
   **500 najnowszych** ocen zamiast wszystkich (`FULL_STATE_ASSESSMENT_LIMIT`
   w `server/app/routes/scenario.py`). Jeśli gdzieś polegacie na pełnej historii —
   powiedz, podniosę limit albo dodam osobny, stronicowany endpoint.

## 1.8 Czego świadomie NIE zrobiłem

| Punkt audytu | Dlaczego pominięty |
|---|---|
| §7.8 — rozbicie `startSimulation` na funkcje | `useLocalSimulation.ts` znika w wariancie A. Refaktor kodu do usunięcia to spalony budżet. |
| §7.6 — przepięcie TS na `combat_constants.json` | Ten sam powód. Zamiast tego dodałem test parity, który chroni przed rozjazdem przez cały okres migracji — taniej i bez ryzyka. |
| §7.10–13 — silnik, teren z rastra, stały krok, Alembic | To już jest wariant A, nie „naprawa błędów". |
| Usunięcie `FeaturePanel`, `LayerSwitcher`, `SimulationMap` | **Też są martwe** (nikt ich nie importuje), ale to Twoja decyzja produktowa, nie moja. Zgłaszam, nie kasuję. |

---

# CZĘŚĆ 2 — Co ustalić, żeby ruszyć z wariantem A

## 2.1 Pomiar sufitu — zrób to przed pisaniem czegokolwiek

To najważniejszy punkt w całym dokumencie. Bez tych liczb wybór między A i B jest zgadywaniem,
a zapisane w dokumencie decyzyjnym „~2–5 tys. jednostek" jest moim szacunkiem, nie pomiarem.

Wygeneruj scenariusze **200 / 500 / 1000 / 2000** jednostek (rozbudowa `server/seed_simulation.py`
albo `rl/seed_scenario.py`) i dla każdego zapisz:

| Metryka | Jak zmierzyć | Próg bólu |
|---|---|---|
| Czas jednego ticka | `performance.now()` na wejściu/wyjściu callbacku w `useLocalSimulation` | > 100 ms = symulacja przestaje nadążać |
| Czas fazy wykrywania starć | osobny pomiar co 10. tick | ile z ticka zjada detekcja |
| FPS mapy | DevTools → Performance | < 30 = nieużywalne |
| Rozmiar `full-state` | zakładka Network | > 5 MB = refetch nie do utrzymania |
| Wzrost pamięci po 10 min | DevTools → Memory, dwa snapshoty | rejestrator 3D rośnie bez limitu (§4.7) |

Zmierz **z `simDebug` wyłączonym** — to jest teraz stan domyślny i on jest reprezentatywny.

Warto też zmierzyć **przed i po** moim prefiltrze bbox na scenariuszu 500+ jednostek —
to jedyny sposób, żeby potwierdzić, że zmiana faktycznie działa, a nie tylko wygląda dobrze.

## 2.2 Dwa pytania do klienta

Oba rozstrzygają wybór A vs B i oba są tańsze niż tydzień pracy:

1. **Ilu użytkowników w jednym scenariuszu jednocześnie?**
   Każdy w swoim → A wystarczy. Kilkunastu na wspólnej mapie → to pcha w stronę B.
2. **Czy odtworzenie przebiegu ćwiczenia (replay / AAR) jest wymogiem, czy dodatkiem?**
   Wymóg → determinizm bit-w-bit → B robi to za darmo, A wymaga dyscypliny i i tak jest kruchy.

## 2.3 Trzy pierwsze kroki wariantu A

Kolejność nie jest dowolna — każdy krok odblokowuje następny.

**Krok 1: kontrakt silnika (1–2 tygodnie).**
Zdefiniuj interfejs, zanim cokolwiek przeniesiesz:

```
SimulationEngine
  load(scenario)   → stan początkowy
  step(dt)         → Delta (zmiany, nie pełny stan)
  command(cmd)     → rozkaz gracza
  snapshot() / restore()
```

Pierwsza implementacja opakowuje istniejące `rl/sim.py`. To jest granica, która sprawia,
że przejście na B będzie później podmianą, a nie przepisaniem.

**Krok 2: PostgreSQL + PostGIS (2–3 tygodnie).**
Fundament jest już w kodzie: `crud.py:6-16` ma warunkowy `geoalchemy2` i `position_geom`
z SRID 4326. Przy okazji Alembic zamiast dziesięciu skryptów `migrate_*.py`.
Ten krok jest niezależny od kroku 1 — można prowadzić równolegle.

**Krok 3: WebSocket z deltami (2–3 tygodnie).**
Dopiero gdy silnik zwraca `Delta`, ma sens strumień. Do tego czasu `full-state` zostaje.
Docelowo znika `refreshState()` + `refreshAreas()` z pętli.

Dopiero po tych trzech frontend można odchudzić do czystego renderera — i wtedy
`useLocalSimulation.ts`, `combatPotential.ts` i `attritionRules.ts` znikają razem
z połową długu z tego audytu.

## 2.4 Ryzyko, które warto zaadresować w kroku 1

Wariant A zakłada, że `rl/sim.py` jest wiarygodnym punktem startowym. Sprawdź to wcześnie:
`SimUnit` ma `ao_half: float = 1500.0` — **kwadratowe AO o stałym boku**, podczas gdy gra operuje
na dowolnych poligonach rysowanych przez użytkownika. Parytet między `rl/sim.py` a grą jest więc
już dziś przybliżony. Zanim oprzesz na tym silnik produkcyjny, ustal, czy `rl/sim.py` ma
obsłużyć pełne poligony (wtedy dochodzi praca, której nie ma w wycenie), czy gra ma zejść
do uproszczonych AO (wtedy to zmiana funkcjonalna do uzgodnienia z klientem).
