# Guardrail i framing — audyt (M8)

Stała zasada projektu (cytat z założeń): *„żadnego automatycznego realnego doradztwa
taktycznego, żadnych prawdziwych doktrynowych wartości, żadnego API do internetu,
żadnego pełnego modelu walki. To ma być abstrakcyjny system oceny potencjału dla symulatora."*

Agent RL został zbudowany pod tę zasadę. Poniżej audyt zgodności.

## 1. Brak realnego doradztwa taktycznego
- Agent **gra w abstrakcyjną grę** (maksymalizuje abstrakcyjny potencjał / wygraną w symulatorze),
  to polityka bota — **nie** rekomendacja dla realnych działań.
- Wynik `/agent/decide` zawiera pole `note`: *„Polityka symulacyjna (abstrakcyjna) — nie realne
  doradztwo taktyczne."*
- UI: panel „Agent AI" ma widoczny disclaimer (`ai-control-disclaimer`) + tooltip.
- Nagłówki modułów (`rl/*.py`, `server/app/presumed.py`) powtarzają to zastrzeżenie.

## 2. Brak prawdziwych wartości doktrynalnych
- Wszystkie liczby to **parametry konfiguracyjne** w `shared/combat_constants.json`
  (wagi kategorii, mnożniki terenu, `ECHELON_CAPS`, stawki atrycji, `presumed`).
- Wartości są **abstrakcyjne / orientacyjne**, dobrane pod grywalność modelu — nie pochodzą
  z dokumentów doktrynalnych. Nagłówek pliku to deklaruje (`_meta.disclaimer`).
- Logistyka „domniemana" wroga z detekcji (`presumed`) to założenie symulacyjne (ułamek
  zapasów etatowych), nie realna ocena sił.

## 3. Brak API do internetu w czasie działania
- **Trening i inferencja działają w pełni lokalnie.** Środowisko korzysta z lokalnej siatki
  terenu (`rl/terrain/data/*.npz`) i lokalnego modelu (`rl/models/*.zip`).
- Jedyny kontakt z siecią to **jednorazowy, offline** eksport kafelków mapy do siatki terenu
  (`rl/terrain/export_terrain.py`) — etap przygotowania danych, nie runtime. W pętli decyzji
  agenta nie ma żadnych zapytań sieciowych.
- Detektor (YOLO) działa lokalnie (model `.engine` na dysku), bez internetu.

## 4. Brak pełnego modelu walki
- Model jest **heurystyczny / Lanchester-podobny**: potencjał = ważona suma kategorii ×
  modyfikatory (gotowość, personel, mobilność, teren, CE); atrycja = ułamek potencjału
  przeciwnika rozłożony na zasoby. To **abstrakcyjna miara**, nie symulacja fizyczna/balistyczna.
- Parity-testy pilnują tylko spójności portu PY z modelem TS — nie „poprawności bojowej".

## 5. Zakres działania agenta
- Agent **produkuje wyłącznie trasy** (waypointy) dla jednostek; nie wprowadza nowej mechaniki
  walki. Ruch i rozstrzygnięcie liczy istniejący, abstrakcyjny silnik gry.
- Cel treningu: wygrać abstrakcyjne starcie; taktyki (koncentracja, odwrót) emergentne/kształtowane
  nagrodą — w obrębie symulatora.

## Wniosek
Implementacja jest zgodna z guardrailem: abstrakcyjny system oceny potencjału + bot grający w tę
grę, bez realnej doktryny, bez internetu w runtime, bez pełnego modelu walki, z jawnymi etykietami
„polityka symulacyjna, nie doradztwo" w API i UI.
