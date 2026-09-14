# Wariant A — plan wdrożenia

**Założenia z ustaleń:** jedna osoba, brak twardej daty.
To zmienia nie tylko harmonogram, ale **kolejność faz**.

---

## 1. Dlaczego kolejność z dokumentu decyzyjnego była zła

W `DECYZJA-ARCHITEKTURA-SKALOWANIE.md` §2.3 zaproponowałem: kontrakt silnika → PostGIS → WebSocket.
**Wycofuję tę kolejność.** Zawiera błąd, który przy pracy solo byłby kosztowny.

Migracja silnika symulacji jest bezpieczna tylko wtedy, gdy potrafisz udowodnić, że nowy silnik
zachowuje się jak stary. Dowodem są **testy charakteryzujące** — zapisane przebiegi referencyjne
(„dla tego scenariusza, po 500 tickach, jednostki są tutaj, starcia zaczęły się wtedy,
straty wyniosły tyle"). Bez nich przenosisz 800 linii mechaniki walki na wiarę, bez recenzenta,
bez testów frontendu, których w projekcie nie ma.

Problem: **dzisiejszej symulacji nie da się zapisać jako przebiegu referencyjnego**, bo nie jest
odtwarzalna. Dwa źródła niedeterminizmu:

1. **Teren czytany z pikseli canvasu** (§2.6 audytu). Wynik zależy od podkładu mapy, zoomu
   i tego, czy kafelki zdążyły się doładować. Ten sam scenariusz da inny wynik.
2. **Tick w czasie zegarowym** (§5.7 audytu). `setInterval(100)` bez akumulatora; przeglądarka
   throttluje nieaktywną kartę do ≥1 s. Liczba ticków na sekundę jest zmienna.

Serwer nigdy nie odtworzy terenu z canvasu — nie ma canvasu. Gdybyś nagrał przebiegi teraz,
przypiąłbyś je do zachowania, którego nowy silnik z definicji nie może powtórzyć.

**Wniosek: determinizm musi być pierwszy.** Dopiero potem testy, dopiero potem silnik.
Dobra wiadomość: dwie pierwsze fazy to punkty 11 i 12 z audytu, które i tak trzeba zrobić,
a obie dają natychmiastowy, widoczny zysk wydajnościowy.

```
        ŹLE (poprzednia propozycja)          DOBRZE (ta)
        kontrakt silnika                     teren z rastra
        PostGIS                              stały krok czasowy
        WebSocket                            przebiegi referencyjne
        ...                                  kontrakt + silnik w cieniu
        (brak dowodu na parytet)             PostGIS
                                             przełączenie autorytetu
                                             sprzątanie
```

---

## 2. Fazy

Każda faza kończy się **działającą aplikacją**. Po każdej można się zatrzymać na tydzień, miesiąc
albo na zawsze — to warunek konieczny przy pracy solo bez terminu.

Czas podany w **tygodniach pracy skupionej**. Kalendarzowo licz ×1,5–2.

---

### Faza 1 — Teren z rastra zamiast z pikseli canvasu
**3–4 tygodnie · ryzyko: średnie · wartość: bardzo wysoka**

Najlepszy stosunek wartości do ryzyka w całym planie. Zamyka jednocześnie:
§2.6 (symulacja zależna od renderu), §4.4 (`toDataURL` w pętli), §5.7 (odtwarzalność).

**Stan zastany — sprawdzone w kodzie:**

| Jest | Brakuje |
|---|---|
| `rl/terrain/grid.py` — `TerrainGrid.class_at(x, y)`, EPSG:3857 | jakiegokolwiek konsumenta po stronie frontendu |
| `rl/terrain/export_terrain.py` — offline'owy eksport kafelków → `.npz` | pokrycia: `region_otm.npz` to **176×176 komórek, ~13,5 × 13,5 km, komórka ~76 m** |
| `rl/sim.py` już używa `TerrainGrid` | endpointu serwującego siatkę do przeglądarki |

To znaczy: maszyneria działa, danych praktycznie nie ma. Rozszerzenie eksportu to zadanie
ograniczone i zrozumiałe (eksporter istnieje), ale **nie darmowe** — i jest jedynym krokiem
w tej fazie wymagającym dostępu do sieci (jednorazowo, offline, zgodnie z `GUARDRAIL.md` §3).

**Do zrobienia**

1. Rozszerzyć eksport na obszar operacyjny scenariuszy. Ustalić rozdzielczość — 76 m/komórka
   jest zgrubne dla plutonu, prawdopodobnie trzeba zejść do 20–30 m. Policzyć rozmiar danych
   **przed** eksportem: przy 25 m siatka 100 × 100 km to 4000 × 4000 komórek ≈ 16 MB przed kompresją.
2. Endpoint `GET /api/terrain/grid?bbox=…` zwracający kompaktową tablicę klas
   (1 bajt na komórkę + nagłówek z bbox i rozmiarem komórki).
3. Po stronie frontendu `terrainGrid.ts`: pobranie raz, trzymanie w `Uint8Array`,
   `classAt(x, y)` jako O(1) indeksowanie. Zastępuje `classifyTerrainFromCanvas`
   i `classifyTerrainForAreaCanvas`.
4. Dla AO: średnia ważona klas komórek wewnątrz poligonu — ta sama semantyka co dziś
   (`weightedTerrainModifier`), inne źródło danych.
5. **Zachowanie zapasowe:** poza bboxem rastra → `open` (dzisiejsze zachowanie domyślne),
   plus jednorazowe ostrzeżenie w konsoli. Bez tego jednostka poza obszarem zniknie z mechaniki.

**Kryterium ukończenia**

- Ten sam scenariusz uruchomiony dwa razy daje **identyczne** klasy terenu dla wszystkich jednostek.
- Przełączenie podkładu OSM ↔ ortofoto **nie zmienia** modyfikatorów prędkości ani wyniku walki.
- `toDataURL` znika z pętli symulacji. FPS mapy w trakcie ruchu mierzalnie rośnie.
- Podgląd terenu w panelu jednostki nadal działa (może rysować siatkę zamiast wycinka mapy).

**Ryzyko:** klasy z rastra mogą różnić się od klas z pikseli dla tych samych miejsc → zmiana
odczuwalna w balansie. To jest **pożądane** (raster jest wiarygodniejszy), ale trzeba to
klientowi zakomunikować jako zmianę, nie jako poprawkę.

---

### Faza 2 — Stały krok czasowy i deterministyczny RNG
**1–2 tygodnie · ryzyko: niskie · wartość: wysoka**

**Do zrobienia**

1. Akumulator zamiast „1 tick = 1 wywołanie `setInterval`":
   ```
   accumulator += realElapsedMs
   while (accumulator >= TICK_MS) { step(TICK_MS); accumulator -= TICK_MS }
   ```
   Fizyka przestaje zależeć od tego, kiedy przeglądarka raczyła oddać sterowanie.
2. Limit nadrabiania (np. max 5 ticków na klatkę), żeby po powrocie z zminimalizowanej karty
   nie przeliczyć naraz dziesięciu minut.
3. Ziarno RNG w stanie symulacji, nie w `Math.random()`. Dziś losowości w pętli praktycznie nie ma —
   tym łatwiej wprowadzić zasadę zanim się pojawi.
4. `TICK_MS` do `shared/combat_constants.json` (jest tam już `simulation.tick_ms: 100`) —
   i objąć strażnikiem parity, który dodałem.

**Kryterium ukończenia**

- Scenariusz uruchomiony w karcie aktywnej i w tle daje ten sam stan po tej samej liczbie ticków.
- Zmiana `TICK_MS` zmienia płynność, **nie** zmienia wyniku scenariusza.

---

### Faza 3 — Przebiegi referencyjne (siatka bezpieczeństwa)
**2 tygodnie · ryzyko: niskie · wartość: krytyczna dla faz 4–6**

Dopiero teraz ma to sens — po fazach 1 i 2 symulacja jest odtwarzalna, więc przebieg
nagrany dziś będzie prawdziwy jutro.

**Do zrobienia**

1. 5–8 scenariuszy pokrywających mechaniki: sam ruch · ruch z hierarchią (AO potomków) ·
   starcie 1v1 · starcie grupowe (BFS spójnych składowych) · zniszczenie z braku ludzi ·
   poddanie z braku amunicji · porażka strony po progu potencjału · wyczerpanie paliwa.
2. Eksporter: uruchom N ticków, zrzuć do JSON pozycje jednostek, aktywne starcia
   i kluczowe pola logistyki **co K ticków**.
3. Vitest (pierwszy test frontendu w tym repo — `package.json` nie ma runnera, trzeba dodać)
   porównujący bieżący silnik z zapisanym przebiegiem, z tolerancją zmiennoprzecinkową.
4. Wzorować się na `rl/parity/` — konwencja już istnieje, nie wymyślaj drugiej.

**Kryterium ukończenia**

- `npm test` przechodzi na czystym repo.
- Celowe zepsucie stałej (np. `ATTRITION_COEFFICIENT` 0.02 → 0.03) **wywala testy**.
  Jeśli nie wywala, przebiegi nie pokrywają mechaniki i trzeba je poszerzyć.

To jest moment, w którym projekt po raz pierwszy ma siatkę bezpieczeństwa.
Przy pracy solo zastępuje recenzenta kodu.

---

### Faza 4 — Kontrakt silnika + implementacja bezgłowa w trybie cienia
**5–7 tygodni · ryzyko: wysokie · wartość: to jest sedno wariantu A**

**Do zrobienia**

1. Kontrakt — jedyna granica, przez którą wolno rozmawiać z silnikiem:
   ```
   SimulationEngine
     load(scenario)   → stan początkowy
     step(dt)         → Delta        (zmiany, nie pełny stan)
     command(cmd)     → rozkaz gracza
     snapshot() / restore()
   ```
2. Implementacja w Pythonie, wychodząc od `rl/sim.py`.
   **Zweryfikuj wcześnie:** `SimUnit.ao_half = 1500.0` — `rl/sim.py` operuje na kwadratowych AO
   o stałym boku, gra na dowolnych poligonach rysowanych przez użytkownika. Parytet jest więc
   dziś **przybliżony**. Albo `rl/sim.py` dostaje pełne poligony (praca, której nie ma w wycenie),
   albo gra schodzi do uproszczonych AO (zmiana funkcjonalna — do uzgodnienia z klientem).
   **To pytanie rozstrzygnij w pierwszym tygodniu tej fazy.**
3. Tryb cienia: silnik serwerowy przelicza przebiegi z fazy 3 i porównuje z zapisem.
   Klient pozostaje autorytatywny — użytkownik nie widzi zmian, ryzyko regresji zerowe.
4. Wektoryzacja (NumPy) i siatka przestrzenna zamiast pętli po parach AO — **dopiero po**
   osiągnięciu parytetu. Najpierw poprawnie, potem szybko.
5. Decyzja porządkowa: `server/app/simulation_service.py` + `rules_service.py` (trzeci model walki)
   **umierają**. Oznacz je jako przestarzałe i usuń endpointy `/simulation/step-all`,
   `/simulate-step`, `/simulation/run-rules` z UI (`App.tsx:603, 610, 617, 627`).

**Kryterium ukończenia**

- Silnik serwerowy przechodzi wszystkie przebiegi z fazy 3 w tolerancji.
- Aplikacja działa dokładnie jak przed fazą — bo nic nie przełączono.

---

### Faza 5 — PostgreSQL + PostGIS + Alembic
**3 tygodnie · ryzyko: niskie · wartość: średnia teraz, wysoka później**

Świadomie **później**, nie wcześniej. Przy jednym użytkowniku SQLite nie boli, a ta faza nie
odblokowuje niczego z faz 1–4. Wcześniejsze jej zrobienie to odroczenie wartości.

Fundament jest w kodzie: `crud.py:6-16` ma warunkowy `geoalchemy2` i `position_geom` (SRID 4326).

**Do zrobienia:** migracja schematu · Alembic zamiast dziesięciu skryptów `migrate_*.py`
(zaczynając od baseline'u ze stanu bieżącego) · `UNIQUE` na `unit_number` w zakresie rodzica
zamiast walidacji read-then-write w Pythonie (§5.5) · indeks GiST na geometrii ·
`server/geotactical.db` do `.gitignore` (dziś nie jest śledzony, ale leży w drzewie).

**Kryterium ukończenia:** aplikacja działa na Postgresie; `alembic upgrade head`
na pustej bazie daje ten sam schemat; przebiegi z fazy 3 nadal przechodzą.

---

### Faza 6 — Przełączenie autorytetu + WebSocket z deltami
**4–5 tygodni · ryzyko: średnie · wartość: to jest cel**

**Do zrobienia**

1. Pętla ticka w procesie serwerowym, jeden proces na scenariusz.
2. WebSocket ze strumieniem `Delta`. `full-state` zostaje jako stan początkowy przy podłączeniu.
3. **Flaga funkcjonalna** `engine: "client" | "server"`. Wycofanie = przestawienie flagi,
   nie rewert commita. Przy solo to nie luksus, to warunek spokojnego snu.
4. Interpolacja po stronie klienta: serwer tika 10 Hz, render 60 fps.
5. Dopiero gdy flaga jest domyślnie `server` przez tydzień bez problemów — usuń ścieżkę klienta.

**Kryterium ukończenia**

- Dwie karty przeglądarki na tym samym scenariuszu widzą **ten sam stan**.
  To pierwszy moment, w którym „wielu użytkowników" przestaje być abstrakcją.
- Zamknięcie karty nie zatrzymuje symulacji.
- Ruch jest płynny mimo ticka 10 Hz.

---

### Faza 7 — Sprzątanie
**2–3 tygodnie · ryzyko: niskie**

Znikają: `useLocalSimulation.ts` (804 l.), `combatPotential.ts` (672 l.),
`attritionRules.ts` (313 l.), lustro `useState`↔`useRef` w `App.tsx`, dodany przeze mnie
strażnik parity TS↔JSON (nie ma już czego pilnować — zostaje jedno źródło).

Dalej: `rl/sim.py` woła kontrakt zamiast duplikować mechanikę · Express → nginx/Caddy z cache
kafelków · zamknięcie CORS i podstawowa autoryzacja · `alert()` → istniejący system powiadomień ·
rozbicie `App.tsx` (dopiero teraz, gdy zniknęła z niego orkiestracja symulacji).

**Efekt:** z audytu zostaje mniej więcej połowa punktów utrzymaniowych, żaden architektoniczny.

---

## 3. Podsumowanie

| Faza | Tygodnie | Zamyka z audytu | Można się zatrzymać? |
|---|---|---|---|
| 1. Teren z rastra | 3–4 | §2.6, §4.4, część §5.7 | ✅ aplikacja szybsza i odtwarzalna |
| 2. Stały krok czasu | 1–2 | §5.7 | ✅ |
| 3. Przebiegi referencyjne | 2 | §6.1 | ✅ pierwsze testy frontendu |
| 4. Silnik w cieniu | 5–7 | §2.1, §3.3 | ✅ nic nie przełączone |
| 5. PostGIS + Alembic | 3 | §2.7, §5.1, §5.5 | ✅ |
| 6. Przełączenie autorytetu | 4–5 | §2.4, §2.5, §4.8, §5.6 | ⚠️ tylko przez flagę |
| 7. Sprzątanie | 2–3 | §2.3, §2.8, §3.*, §6.* | ✅ |
| **Razem** | **20–26 tyg. pracy skupionej** | | |

Kalendarzowo przy jednej osobie: realnie **6–9 miesięcy**. To więcej niż „3–4 miesiące"
z dokumentu decyzyjnego — tamta wycena zakładała dwie osoby i pomijała fazy 1–3,
które przy solo są nieusuwalne.

---

## 4. Zasady pracy solo

Cztery rzeczy, które przy jednoosobowym zespole decydują o powodzeniu bardziej niż architektura:

1. **Nigdy nie zostawiaj repo w stanie niedziałającym na dłużej niż jedną sesję.**
   Przy pracy w pojedynkę nie ma nikogo, kto przypomni, co było w połowie zrobione.
2. **Flaga funkcjonalna zamiast długiej gałęzi.** Gałąź żyjąca miesiąc to konflikt scalania,
   którego nie ma z kim przedyskutować.
3. **Testy zastępują recenzenta.** Dlatego faza 3 jest przed fazą 4, a nie odwrotnie.
4. **Każda faza zaczyna się od pomiaru i kończy pomiarem.** Bez terminu łatwo optymalizować
   rzeczy, które nie bolą — liczby chronią przed tym lepiej niż plan.

---

## 5. Co zrobić w tym tygodniu

1. **Przejść regresję z `WERYFIKACJA-I-START-WARIANTU-A.md` cz. 1.** Zwłaszcza §1.4 — starcia.
   Dopóki to nie jest potwierdzone, nie ma sensu budować dalej.
2. **Zmierzyć sufit** (§2.1 tamtego dokumentu, scenariusze 200/500/1000/2000 jednostek).
   To ostatni moment, kiedy pomiar jest tani, a jego brak podważa cały plan.
3. **Policzyć, ile waży raster** dla realnego obszaru operacyjnego przy 25 m i przy 50 m
   na komórkę. Jedno mnożenie, a rozstrzyga, czy faza 1 zajmie 3 tygodnie czy 6.
4. **Zapytać klienta o AO:** czy uproszczenie do kwadratów jest akceptowalne, czy silnik
   musi obsłużyć dowolne poligony. To pytanie z fazy 4, ale odpowiedź przychodzi wolno —
   warto je zadać teraz.
