# Front vs design — analiza luki

Analiza paczki `Operacja Cichy Grom`, kodu w `src/` i dwóch zrzutów ekranu.
**Bez zmian w kodzie.**

---

## 1. Najważniejsze ustalenie: paczka nie zawiera nic nowego

Porównałem plik po pliku z tym, co leży w repo w `project/` od 31 lipca:

| Plik | Wynik |
|---|---|
| `AICOMMAND.dc.html` (141 775 B) | **bajt w bajt identyczny** |
| `game.html`, `index.dc.html`, `github.md`, `.thumbnail` | identyczne |
| `_ds/nocturne-…/*` (system designu) | identyczne |
| `src/assets/APP-6A/*.png` (90 plików) | **wszystkie 90 identyczne** z tymi w `src/assets/APP-6A/` |
| Plików nowych względem `project/` | **0** |

**Design się nie zmienił.** Nie ma nowej makiety do wdrożenia — jest stara makieta wdrożona
w jakichś 40%. To dobra wiadomość: nie goniysz ruchomego celu, masz stabilną specyfikację.

Dwie uwagi porządkowe:

- `Operacja Cichy Grom/` to duplikat `project/`. Trzymanie dwóch kopii 140 KB makiety
  w repo skończy się tym, że ktoś poprawi jedną. **Zostaw jedną, usuń drugą.**
- W paczce jest `styles.css` i `_ds/` z systemem **„Nocturne"** — dark blurple `#9184d9`.
  To **nie jest** paleta Twojego designu. Makieta ma własne kolory inline w `<style>`:
  tło `#0b0c0d`, tekst `#e6e4e0`, akcent bursztynowy `#e0a63c` (hover `#f2bd5c`).
  `_ds` to towarzyszący system, którego makieta faktycznie nie używa — nie sugeruj się nim.

---

## 2. Co już jest wdrożone

Wbrew wrażeniu ze zrzutu, warstwa wizualna **jest** w aplikacji:

- `src/index.css` zawiera paletę grafit + bursztyn (`#0b0c0d`, `#e0a63c`, `#e6e4e0`, `#2b2f33`).
- `src/aicommand.css` (2013 linii) ma nagłówek: *„Wdrożenie makiety project/AICOMMAND.dc.html
  na istniejący interfejs"* — z opisanymi zasadami kierunku (akcent linią, nie zalaniem;
  kontrast z rampy szarości; liczby w IBM Plex Mono; nagłówki sekcji 10px uppercase).
- Górna nawigacja i pięć trybów (**Jednostki, Symulacja, Starcia, Porównaj, Monitoring**)
  istnieją w `App.tsx`.

Czyli: **powłoka i paleta tak, zawartość paneli nie.**

---

## 3. Luka — z porównania zrzutów

### 3.1 Górny pasek

| Element makiety | Stan |
|---|---|
| `Czas misji 05:40:00` (IBM Plex Mono) | **brak** — aplikacja pokazuje tylko „Symulacja WSTRZYMANA" |
| Przycisk `▶ Start` | jest w panelu bocznym, nie w pasku |
| Mnożniki `×1 ×8 ×20 ×60` | **brak** |
| `Styl: Grafit / Warstwa / Kontur` | **brak** (`Kontur` nie występuje w `src/` w ogóle) |

### 3.2 Lewy panel — największa różnica koncepcyjna

Makieta: **„Struktura sił 12"** — jedno zadanie, czysta lista sił.
Aplikacja: dwie rzeczy naraz — „WARSTWY MAPY" (widoczność AO, zoom hierarchiczny,
widoczność szczebli) **plus** „PORZĄDEK BOJOWY".

Brakuje w aplikacji:

- pola wyszukiwania „Szukaj jednostki, szczebla…",
- filtrów **Wszystkie / Sojusz / Przeciwnik**,
- wiersza jednostki w formacie makiety: ikona · nazwa · **kod szczebla** (`X · BDE`,
  `II · BN`, `I · CO`) · pasek gotowości · % · oko,
- nagłówków grup z licznikiem i gotowością (`Jednostki sojusznicze 7 · GOT 100%`),
- wcięcia pokazującego podległość (w makiecie bataliony są wcięte pod brygadą).

Warstwy mapy w makiecie nie są w tym panelu — trzeba zdecydować, dokąd trafiają
(sugestia: pod przycisk warstw na mapie, który już istnieje).

### 3.3 Prawy panel — z płaskiej listy na zakładki

Makieta ma **zakładki: Przegląd / Logistyka / Trasa / AO**. Aplikacja ma jeden długi scroll.

| Sekcja makiety | Stan w aplikacji |
|---|---|
| Nazwa + odznaka szczebla (`II BN`) + typ | jest, inny układ |
| Akcje: `Trasa · AO · Centruj · Ukryj · Usuń` | są `Logistyka · Trasa · Teren · Usuń` — **inny zestaw** (brak Centruj, Ukryj) |
| Zakładki Przegląd/Logistyka/Trasa/AO | **brak** — `Przegląd` i `AO` nie istnieją w `src/` |
| Pierścień gotowości + „paliwo 100%" | jest (pokazuje „Wymaga uzupełnienia logistyki") |
| Siatka 2×3: Stan · Sprzęt · Prędkość · Teren · BSP · Kontakt | **brak** — aplikacja ma 4 inne kafelki (Szerokość, Długość, Wysokość, Prędkość bazowa) |
| `POZYCJA`: Szerokość · Długość · **MGRS** · **Kurs** | **MGRS i Kurs nie istnieją w `src/`** |
| `PODPORZĄDKOWANIE` — karta z linkiem do jednostki nadrzędnej | **brak** |

Formularz oznaczenia (numer, nazwa własna, Piechota/Kołowe/Pancerne) z aplikacji
w makiecie nie występuje na `Przeglądzie` — prawdopodobnie należy do zakładki `AO`
albo do osobnego trybu edycji. **To wymaga Twojej decyzji, nie da się jej wyczytać z makiety.**

### 3.4 Mapa

Podkłady zostają obecne — zgodnie z ustaleniem. Różnice pozostałe:

- **podpisy jednostek pod znakiem** (`F5 · Kompania Zmotoryzowana`) — brak,
- **wskaźniki szczebla** (kreski/kropki nad znakiem) — brak,
- **etykiety AO** (`AO 27 pzmot`) i cienki obrys zamiast wypełnienia — aplikacja ma wypełniony poligon,
- **oś natarcia** z grotem i etykietą (`OŚ NAT. · 1 bz`) — aplikacja ma kropkowaną trasę z numerami,
- **chip scenariusza** (`Ćwiczenie ORLIK-26 | 270540Z LIP26 | SEKTOR WSCHÓD`) — brak,
- **dolny pasek statusu** (`LAS ×0.6`, `ZOOM 1.22×`, `SOJ 7/7`, `PRZ 5/5`, `EPSG:3857 · WGS 84`) — brak,
- siatka współrzędnych na mapie — brak.

### 3.5 Liczby

Z 53 etykiet UI wyciągniętych z makiety **41 nie występuje w `src/`**. Najważniejsze:
`Struktura sił`, `Przegląd`, `Potencjał bojowy`, `Sprzęt sprawny`, `BSP dostępne`,
`Prędkość marszowa`, `Rejony odpowiedzialności`, `Ślady ruchu`, `Warstwa zagrożenia`,
`Oś natarcia`, `Dziennik zdarzeń`, `Ćwiczenie ORLIK-26`.

(Nazwy miast — Białystok, Brześć, Suwałki, Łuck — to etykiety mapy d3-geo z makiety.
Przy OpenLayers dostajesz je z podkładu; **nie przenoś ich**.)

---

## 4. Czego świadomie NIE przenosić

| Element makiety | Dlaczego |
|---|---|
| Mapa **d3-geo** + `topojson` | Masz OpenLayers z realnymi podkładami i geoportalem. Makieta rysuje uproszczony glob, bo była prototypem bez backendu. Przenosisz *chrome*, nie silnik mapy. |
| `styles.css` i `_ds/` (Nocturne, blurple) | To nie jest paleta tego produktu. Wdrożona paleta w `index.css` jest właściwa. |
| Etykiety miast, `topojson` granic | Pochodzą z podkładu OSM/geoportalu. |
| Dane demonstracyjne (ORLIK-26, jednostki F2–F7, H1–H5) | Makieta ma je zaszyte; Ty masz bazę. Chip scenariusza — tak, ale zasilany z danych. |

---

## 5. Jeden konflikt z wariantem A — do rozstrzygnięcia teraz

**Mnożniki `×1 ×8 ×20 ×60` i zegar misji zrobione dziś byłyby błędne.**

Obecna pętla to `setInterval(100)` w czasie zegarowym, bez akumulatora (§5.7 audytu).
Mnożnik prędkości na takiej pętli to albo skracanie interwału (rozjeżdża fizykę i dobija
wydajność), albo mnożenie kroku (rozjeżdża wykrywanie starć — jednostka „przeskakuje" AO).
Zegar misji nie miałby stabilnej podstawy.

Po **fazie 2 wariantu A** (stały krok czasowy z akumulatorem) mnożnik to dosłownie
`accumulator += elapsed * speedFactor` — jedna linia, poprawna z definicji.

**Rekomendacja: te dwa elementy zostawić na później.** Cała reszta designu jest niezależna
od silnika i można ją robić teraz bez kolizji.

Podział prac według sprzężenia z silnikiem:

| Niezależne od wariantu A (~80%) | Sprzężone — po fazie 2 |
|---|---|
| lewy panel: wyszukiwarka, filtry, kod szczebla, wcięcia | zegar misji |
| prawy panel: zakładki, siatka statystyk, MGRS, Kurs, podporządkowanie | mnożniki ×1/×8/×20/×60 |
| mapa: podpisy, wskaźniki szczebla, etykiety AO, oś natarcia | przycisk Start w pasku (stan symulacji) |
| ciemny podkład, przełącznik stylu Grafit/Warstwa/Kontur | |
| chip scenariusza, dolny pasek statusu | |

---

## 6. Ciemny podkład — konkretna propozycja

Dziś `BaseLayerType = "osm" | "geoportal_orto" | "geoportal_topo" | "terrain"`
(`src/types/map.ts` po moich zmianach; konstrukcja warstw w `src/map/MapView.tsx:619-663`).

Dodanie ciemnej mapy to jeden wariant więcej — bez klucza API, kafelki rastrowe XYZ,
czyli dokładnie ten sam mechanizm co istniejący `terrain`:

| Kandydat | Uwagi |
|---|---|
| **CARTO Dark Matter** | Najbliżej palety `#0b0c0d`. Darmowy do użytku niekomercyjnego — **przy wdrożeniu dla wojska/klienta sprawdź licencję.** Wymaga atrybucji CARTO + OpenStreetMap. |
| **Stadia Alidade Smooth Dark** | Ładniejsza typografia, ale od 2023 wymaga klucza API nawet w dev. |
| Własny styl z geoportalu | Geoportal nie ma ciemnego wariantu; trzeba by filtrować CSS-em (`filter: invert(1) hue-rotate(180deg)`) — wygląda źle na ortofoto. |

Sugestia: **CARTO Dark Matter** jako `basemap: "dark"`, dodany do listy w `App.tsx:979`
i do `switch` w `MapView.tsx`. Zakres: ~15 linii w trzech plikach. Zrobić razem z resztą
prac nad mapą, nie osobno.

Zwróć uwagę: makieta ma przełącznik **`Styl: Grafit / Warstwa / Kontur`**, który jest czymś
innym niż wybór podkładu — to tryb renderowania samej mapy (pełny / z warstwami / sam obrys).
Trzeba zdecydować, czy to osobna kontrolka, czy rozszerzenie istniejącego wyboru podkładu.

---

## 7. Proponowana kolejność

Prace są w większości addytywne i niskiego ryzyka. Przy pracy solo dzieliłbym tak,
żeby każdy krok dało się skończyć w jednej–dwóch sesjach i był widoczny dla klienta:

1. **Prawy panel na zakładki** (Przegląd/Logistyka/Trasa/AO) — największy zysk wizualny,
   jeden plik (`SelectedUnitPanel.tsx`, 315 linii), zero ryzyka dla mechaniki.
   Wymaga decyzji: dokąd trafia formularz oznaczenia.
2. **Siatka statystyk + POZYCJA + PODPORZĄDKOWANIE** — MGRS i Kurs to czyste obliczenia
   ze współrzędnych, których już masz (`calculateBearing` istnieje w `geoUtils.ts`).
3. **Lewy panel: wyszukiwarka + filtry + kod szczebla + wcięcia** — `UnitsListPanel.tsx` (279 l.).
   Wymaga decyzji: dokąd przenieść „Warstwy mapy".
4. **Mapa: podpisy, wskaźniki szczebla, etykiety AO** — `mapStyles.ts` + `MapView.tsx`.
   Tu uważaj: warstwy są przebudowywane od zera 10×/s (§4.6 audytu), a etykiety to kolejne
   featury. Zmierz FPS przed i po.
5. **Ciemny podkład + przełącznik stylu**.
6. **Chip scenariusza + dolny pasek statusu** — kosmetyka, na koniec.
7. *(po fazie 2 wariantu A)* zegar misji + mnożniki prędkości.

---

## 8. Pytania, na które nie znajdę odpowiedzi w makiecie

1. **Formularz oznaczenia jednostki** (numer, nazwa własna, typ podwozia) — w makiecie
   nie ma go na `Przeglądzie`. Ma trafić do zakładki `AO`, do osobnego okna edycji,
   czy zostaje na Przeglądzie mimo makiety?
2. **„Warstwy mapy"** z obecnego lewego panelu — dokąd? Makieta ma lewy panel wyłącznie
   na strukturę sił.
3. **`Styl: Grafit / Warstwa / Kontur`** — to tryb renderu mapy czy alias na wybór podkładu?
4. **Akcje `Centruj` i `Ukryj`** w prawym panelu — dodajemy, czy zostaje obecny zestaw
   (`Logistyka · Trasa · Teren · Usuń`)?
5. **Licencja ciemnego podkładu** — czy docelowy odbiorca dopuszcza CARTO, czy trzeba
   zostać w granicach geoportalu?
