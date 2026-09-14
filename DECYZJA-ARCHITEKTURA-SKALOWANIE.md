# GeoTactical — trzy warianty architektury pod skalę

Materiał decyzyjny. Pytanie: czy obecny stos (React 19 + OpenLayers/Cesium / FastAPI + SQLite /
Express) nadaje się do dużej symulacji dla wielu użytkowników — i co zamiast.

---

## 1. Diagnoza: framework nie jest problemem

Zacznę od rzeczy, która oszczędzi pieniądze: **żaden z wybranych frameworków nie blokuje skali.**
Blokują trzy decyzje, niezależne od stosu technologicznego.

| Element | Werdykt | Uzasadnienie |
|---|---|---|
| React 19 | **Zostaje** we wszystkich wariantach | nie jest w ścieżce gorącej; renderuje panele, nie symulację |
| OpenLayers | **Sufit ~10³ ruchomych obiektów** | render wektorowy na Canvasie, styl liczony per feature per klatka; obecny kod (`source.clear()` + odbudowa 10×/s) osiąga realnie setki |
| CesiumJS | Zostaje jako opcjonalny widok | brak sensownej alternatywy dla globu 3D; wymaga tylko lazy-loadu (dziś ładuje się zawsze) |
| FastAPI | **Zostaje jako API/WS**, ale nie jako silnik ticka | świetny do I/O i WebSocketów; zły do pętli CPU-bound (GIL, skalarne pętle w CPythonie są rzędy wielkości wolniejsze od JS/Rust) |
| SQLite | **Musi odejść** przy pierwszym równoległym użytkowniku | jeden pisarz na całą bazę |
| Express proxy | **Do zastąpienia konfiguracją** | nginx/Caddy/CDN robi cache kafelków lepiej, bez trzeciego runtime'u w projekcie |

Prawdziwe blokery:

1. **Pętla symulacji działa w przeglądarce.** Stan autorytatywny to `useRef` w `App.tsx`.
   Dopóki tak jest, „wielu użytkowników" jest niewykonalne — nie ma czego współdzielić.
2. **SQLite.** Jeden pisarz, a klient PATCHuje logistykę każdej walczącej jednostki co 5 s.
3. **Trzy kopie modelu walki** (TS / `rl/` / `server/app/simulation_service.py`). Każdy wariant
   poniżej zaczyna się od sprowadzenia ich do jednej — inaczej każda zmiana balansu to trzy zmiany
   i cichy rozjazd.

**Aktywa, które już masz** (i które zmieniają rachunek kosztów):

- `rl/sim.py` — bezgłowy silnik bez Reacta i OpenLayers, wszystko w EPSG:3857, czyta wspólne stałe.
  To gotowy *kształt* silnika serwerowego. **Ale**: czysty Python, pętla po jednostkach,
  `polygons_overlap` O(F×H × vA×vB) — ta sama złożoność co wersja przeglądarkowa, tylko wolniejsza.
  Nadaje się jako referencja i kontrakt, nie jako silnik produkcyjny bez przepisania.
- `crud.py:6-16` — warunkowy import GeoAlchemy2 i `position_geom` (`WKTElement`, SRID 4326).
  **Ktoś już zaplanował PostGIS.** Migracja jest w połowie przygotowana.
- `rl/terrain/grid.py` — pre-eksportowany raster terenu `.npz`. Rozwiązuje problem „teren czytany
  z pikseli canvasu" bez pisania czegokolwiek nowego.

---

## 2. Pytanie, które trzeba rozstrzygnąć przed wyborem

„Wielu użytkowników" znaczy dwie zupełnie różne rzeczy i prowadzi do różnych architektur:

**(a) Wielu użytkowników w JEDNYM dużym scenariuszu** — ćwiczenie sztabowe, kilkunastu oficerów
na wspólnej mapie. Wąskie gardło: jeden silnik musi udźwignąć cały scenariusz + broadcast do N klientów.
→ wymusza wariant **B**.

**(b) Wielu użytkowników, każdy we WŁASNYM scenariuszu** — trenażer/SaaS, 200 osób ćwiczy równolegle.
Wąskie gardło: gęstość upakowania procesów i izolacja. Każdy silnik jest mały.
→ wystarcza wariant **A**.

**(c) Oba** — docelowo pewnie tak, ale kolejność ma znaczenie. (b) da się dowieźć w kwartał,
(a) to rok.

Poniższe warianty wyceniam przy założeniu, że celem długoterminowym jest (c).

---

## Wariant A — Ewolucja: serwer autorytatywny w Pythonie

*Ten sam stos, przeniesiona odpowiedzialność.*

**Co się zmienia**

- Pętla ticka przenosi się z `useLocalSimulation.ts` do procesu serwerowego. Punkt startowy:
  `rl/sim.py`, ale **zwektoryzowany** (NumPy: pozycje/prędkości/logistyka jako tablice, nie
  `dataclass` per jednostka) i z **siatką przestrzenną** zamiast pętli po wszystkich parach AO.
- SQLite → **PostgreSQL + PostGIS**. Zapis nie per tick, tylko: definicja scenariusza + snapshoty
  co N sekund + log zdarzeń. Wykrywanie nakładania AO może zejść do bazy (`ST_Intersects` + GiST),
  ale szybciej będzie w pamięci.
- **WebSocket** ze zmianami różnicowymi zamiast pełnego `full-state`. Filtr AOI (area of interest):
  klient dostaje tylko to, co widzi.
- Frontend staje się **czystym rendererem**. OpenLayers zostaje. Znikają: `useLocalSimulation.ts`,
  lustro `useState`↔`useRef`, `combatPotential.ts`, `attritionRules.ts`.
- Express → nginx/Caddy z cache kafelków.
- Model walki: jedna implementacja (Python), `shared/combat_constants.json` faktycznie jako źródło.

**Skalowanie — liczba użytkowników**

- Wielu obserwatorów jednego scenariusza: **tanio**. Broadcast delt to I/O, w czym asyncio jest dobre.
  Setki połączeń na proces bez problemu.
- Wiele niezależnych scenariuszy: **jeden proces roboczy na scenariusz**, router scenario→worker.
  Skaluje się liniowo po rdzeniach i maszynach. Kilkadziesiąt scenariuszy na węźle.

**Skalowanie — wielkość symulacji**

- Realistycznie **~2–5 tys. jednostek na scenariusz** przy 10 Hz, po wektoryzacji i siatce
  przestrzennej. *Wymaga benchmarku — to szacunek rzędu wielkości, nie pomiar.*
- Twardy sufit: GIL. Jeden scenariusz = jeden rdzeń. Powyżej ~5 tys. jednostek trzeba albo zejść
  z częstotliwości ticka, albo iść do wariantu B.

**Plusy**

- Odblokowuje multi-user, determinizm i replay w jednym ruchu.
- Likwiduje potrójny model walki jako efekt uboczny, nie jako osobny projekt.
- Zespół zostaje w dwóch znanych językach. Zero rekrutacji.
- Każdy krok ma samodzielną wartość — da się wypuszczać przyrostowo.
- Najniższe ryzyko: nie ma momentu „przepisujemy wszystko i mamy nadzieję".

**Minusy**

- Sufit wielkości scenariusza jest realny i nie da się go obejść samym Pythonem.
- Wektoryzacja NumPy pogarsza czytelność logiki walki (koniec z czytelnym `for u in units`).
- OpenLayers dalej ogranicza to, ile jednostek da się *narysować*, niezależnie od tego, ile
  serwer policzy.
- Python nie daje twardej determinacji zmiennoprzecinkowej między platformami — replay
  bit-w-bit wymaga uwagi.

**Koszt:** ~3–4 miesiące, 1–2 osoby. Bez nowych kompetencji w zespole.

---

## Wariant B — Wydzielony silnik + render WebGL

*A, plus silnik w języku kompilowanym i wymiana warstwy renderu jednostek.*

**Co się zmienia dodatkowo względem A**

- Silnik symulacji jako **osobny serwis w Rust lub Go**: architektura ECS / struct-of-arrays,
  stały krok czasowy, ziarno RNG w stanie → **pełna determinacja, replay i AAR za darmo**.
  Komunikacja z FastAPI przez gRPC albo shared memory.
- FastAPI zostaje jako **BFF**: auth, CRUD scenariuszy, zarządzanie sesjami, proxy WS.
- **Środowisko RL woła ten sam silnik** (FFI/gRPC) zamiast go reimplementować.
  `rl/sim.py` znika — i to jest jedna z największych oszczędności w tym wariancie.
- Warstwa jednostek na mapie: **deck.gl** (WebGL, `IconLayer`/`ScatterplotLayer`) zamiast wektorów
  OpenLayers. Rząd wielkości: 10⁵ obiektów przy 60 fps zamiast 10³.
  OpenLayers może zostać do podkładu i rysowania AO albo cała warstwa 2D idzie na MapLibre + deck.gl.
- Protokół binarny (Protobuf/FlatBuffers) zamiast JSON na WebSockecie.

**Skalowanie — liczba użytkowników**

- Jak w A dla obserwatorów, ale **jeden silnik utrzymuje dużo większy scenariusz**, więc scenariusz
  „ćwiczenie sztabowe dla 20 osób" przestaje być problemem.
- Możliwy **sharding jednego scenariusza po regionach** (silnik na sektor, wymiana na granicach) —
  wariant A tego nie umie.

**Skalowanie — wielkość symulacji**

- **10⁴–10⁵ jednostek** na scenariusz w zasięgu. Kompilowany ECS z siatką przestrzenną robi
  100 tys. encji przy 10–60 Hz na jednym rdzeniu; to dobrze zbadany teren w gamedevie.
- Front nadąża dzięki deck.gl.

**Plusy**

- Najwyższy sufit techniczny przy rozsądnym koszcie operacyjnym.
- Determinizm i replay jako właściwość silnika, nie doklejka. Dla trenażera wojskowego
  **after-action review to prawdopodobnie wymóg funkcjonalny, nie luksus** — warto to potwierdzić
  z odbiorcą, bo jeśli tak, ten wariant przestaje być opcjonalny.
- Definitywny koniec z duplikacją modelu: jedna implementacja obsługuje grę, RL i testy.
- Silnik jako osobny serwis = testowalny w izolacji, benchmarkowalny, wymienialny.

**Minusy**

- **Trzeci język w projekcie.** Bez kogoś, kto realnie zna Rusta/Go, to ryzyko dowozu, nie ryzyko techniczne.
- Granica gRPC/FFI to nowa klasa błędów (serializacja, wersjonowanie schematu).
- Wymiana OpenLayers → deck.gl to przepisanie ~950 linii `map/MapView.tsx` z całą interakcją
  (rysowanie AO, menu kontekstowe, wybór jednostki). Niedoszacowywana pozycja.
- Dłuższy czas do pierwszej widocznej wartości.

**Koszt:** ~8–12 miesięcy, 2–3 osoby, w tym jedna z realnym doświadczeniem w Rust/Go.

---

## Wariant C — Architektura aktorowa / event-sourced (SaaS multi-tenant)

*Pełna przebudowa wokół logu zdarzeń.*

**Co się zmienia**

- Każda akcja użytkownika to **komenda → zdarzenie w logu** (NATS JetStream / Kafka / Redis Streams).
  Stan świata jest funkcją logu; silniki to deterministyczni konsumenci.
- Alternatywnie **model aktorowy** (Dapr / Orleans / Akka / Ray): aktor = jednostka albo komórka
  siatki, runtime zajmuje się rozmieszczeniem i odtwarzaniem po awarii.
- Read-modele materializowane osobno dla mapy, ORBAT i raportów.
- Pełna multi-tenancy, izolacja klientów, kwoty, billing.

**Skalowanie — liczba użytkowników**

- **Praktycznie nieograniczone.** Elastyczność, rozproszenie po wielu węzłach, odporność na awarie.

**Skalowanie — wielkość symulacji**

- Nieograniczone *w teorii*. W praktyce granica przesuwa się z „ile policzy jeden rdzeń"
  na **koszt koordynacji między aktorami** — a symulacja walki jest gęsto sprzężona przestrzennie
  (każda jednostka wchodzi w interakcje z sąsiadami co tick). To najgorszy możliwy profil dla
  modelu aktorowego: ruch sieciowy rośnie szybciej niż liczba jednostek.

**Plusy**

- Replay, audyt i AAR wynikają z konstrukcji, nie z dodatkowej pracy.
- Odporność na awarie i wdrożenia bez przerwy.
- Jedyny wariant, który sensownie obsługuje „setki tysięcy użytkowników i tysiące scenariuszy".

**Minusy**

- **Ogromny narzut na małą skalę.** Poniżej kilkuset równoległych scenariuszy to czysta strata.
- Znika „uruchom lokalnie i zdebuguj" — a przy jednoosobowym zespole to zabójcze.
- Wymaga kompetencji DevOps/SRE, których projekt dziś nie ma.
- Latencja rośnie: log zdarzeń dokłada opóźnienie tam, gdzie symulacja potrzebuje ciasnej pętli.
- **Nie rozwiązuje żadnego z trzech realnych blokerów** z §1 — one zostają do zrobienia i tak.

**Koszt:** 12–18+ miesięcy, 4+ osoby plus DevOps. Koszt infrastruktury rośnie skokowo od dnia pierwszego.

---

## 4. Porównanie

| | A — Ewolucja | B — Wydzielony silnik | C — Event-sourced |
|---|---|---|---|
| Jednostek / scenariusz | ~2–5 tys. | 10⁴–10⁵ | 10⁴–10⁵ (limit: koordynacja) |
| Użytkowników / scenariusz | setki (obserwatorzy) | setki | setki |
| Równoległych scenariuszy | dziesiątki / węzeł | dziesiątki / węzeł | tysiące, elastycznie |
| Determinizm + replay | możliwy, wymaga dyscypliny | wbudowany | wbudowany |
| Koniec z 3× modelem walki | tak | tak, także dla RL | tak |
| Nowe kompetencje | brak | Rust/Go + WebGL | Rust/Go + WebGL + SRE |
| Czas do pierwszej wartości | ~4 tygodnie | ~4 miesiące | ~9 miesięcy |
| Czas całości | 3–4 mies. | 8–12 mies. | 12–18+ mies. |
| Ryzyko dowozu | niskie | średnie | wysokie |
| Odwracalność | pełna | wymiana implementacji | nieodwracalne |

---

## 5. Rekomendacja

**Wariant A teraz, z granicą silnika zaprojektowaną tak, żeby B było wymianą implementacji,
a nie przepisaniem projektu.**

Uzasadnienie w trzech punktach:

1. **A i B mają identyczne pierwsze cztery kroki**: serwer autorytatywny, PostGIS, WebSocket z
   deltami, jeden model walki. Robiąc A nie tracisz nic z B — budujesz jego fundament.
   Różnica zaczyna się dopiero przy wyborze języka silnika, a tę decyzję można podjąć,
   mając już zmierzone, gdzie faktycznie leży sufit.
2. **Nie znamy jeszcze prawdziwej skali.** „Duże scenariusze" to dziś słowo, nie liczba.
   Jeśli okaże się, że realny scenariusz ma 800 jednostek, wariant B jest przepaleniem roku pracy.
   Jeśli 50 tys. — A i tak trzeba było zrobić najpierw, żeby to wiedzieć.
3. **C jest przedwczesny.** Nie rozwiązuje żadnego z trzech blokerów, a dokłada koszt operacyjny
   i odbiera możliwość lokalnego uruchomienia. Wraca do rozważenia dopiero przy realnym popycie
   na multi-tenancy — i wtedy jako nadbudowa nad B, nie zamiast niego.

**Warunek, który zmienia rekomendację na B od razu:** jeśli after-action review / replay
scenariusza jest wymogiem funkcjonalnym od odbiorcy, a nie „miłym dodatkiem". Determinizm
bit-w-bit jest w Pythonie osiągalny, ale kosztowny; w Rust/Go jest właściwością domyślną.
To pytanie warto zadać odbiorcy **przed** startem prac.

### Konkretny zapis decyzji do A

Granica, którą trzeba zaprojektować teraz, żeby B było później tanie:

```
SimulationEngine (kontrakt, nie implementacja)
  load(scenario)        → stan początkowy
  step(dt) → Delta      → zmiany, nie pełny stan
  command(cmd)          → rozkaz gracza (trasa, rozkaz walki)
  snapshot() / restore()
```

Dopóki FastAPI rozmawia z silnikiem **wyłącznie** przez ten interfejs, podmiana Pythona na Rusta
jest projektem na kwartał, a nie na rok.

---

## 6. Co zrobić w najbliższych dwóch tygodniach — niezależnie od wyboru

Te cztery rzeczy mają wartość w każdym z trzech wariantów i nie są zmarnowaną pracą w żadnym:

1. **Zmierzyć, gdzie jest sufit.** Wygenerować scenariusz 200 / 500 / 1000 / 2000 jednostek
   i zmierzyć: czas ticka, fps mapy, rozmiar `full-state`. Bez tej liczby cała powyższa dyskusja
   jest teoretyczna. To jest najważniejszy punkt na liście.
2. **Ustalić z odbiorcą realną skalę scenariusza i wymóg replay/AAR.** Dwa pytania, które
   rozstrzygają wybór między A i B.
3. **Zrobić punkty 1–5 z §7 audytu** (`eager: false` w katalogu symboli, wyciszenie logów,
   prefiltr bbox, usunięcie martwego `MapView`, jedno źródło hierarchii szczebli).
   Kilka dni pracy, natychmiastowy efekt, zerowe ryzyko, zero marnotrawstwa przy każdym wariancie.
4. **`shared/combat_constants.json` jako faktyczne źródło dla TS.** To pierwszy krok każdego
   wariantu i jednocześnie test: jeśli po podmianie liczby się rozjadą, wiemy, że model gry
   i model RL już się rozeszły — a to trzeba wiedzieć przed jakąkolwiek większą decyzją.
