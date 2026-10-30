# Sudoku³ — sudoku in 3D en 4D

Een echte driedimensionale sudoku in de browser: een kubus van glazen cellen in een full-screen 3D-scène met reflecterende vloer, lichtrails door de gekozen cel, opties (potloodcijfers), een donker en een licht thema, en bediening die is gemaakt voor de telefoon.

## De regel

De kubus heeft drie richtingen: X (breedte), Y (hoogte) en Z (diepte). Vul elke cel zo dat:

- elke **rij**, **kolom** en **pilaar** (rechte lijn in X, Y of Z) elk cijfer precies één keer bevat;
- elk **blok** in elke snede, in alle drie de richtingen, elk cijfer precies één keer bevat.

Daardoor is elke laag die je uit de kubus snijdt, horizontaal of verticaal, zelf een geldige sudoku. Elke cel hoort bij zes groepen tegelijk: drie lijnen en drie blokken.

| Formaat | Cellen | Cijfers | Blokken |
|---|---|---|---|
| Mini 4 × 4 × 4 | 64 | 1–4 | 2 × 2 |
| Kubus 9 × 9 × 9 | 729 | 1–9 | 3 × 3 |
| Tesseract 4 × 4 × 4 × 4 | 256 | 1–4 | 2 × 2 |

Er zijn 90 puzzels (30 per formaat). Elke puzzel heeft één oplossing en is op te lossen met logische technieken; raden is niet nodig.

## Tesseract: vier dimensies

De Tesseract voegt een vierde richting **W** toe. Je ziet hem als vier kubussen; W is de stap van kubus naar kubus.

- Elke lijn in X, Y, Z én W bevat 1–4 precies één keer.
- Elk 2 × 2-blok bevat 1–4, in vijf van de zes vlakrichtingen: XY, XZ, YZ, XW en YW. Elke kubus is daardoor zelf een complete 3D-Mini.
- Alleen het ZW-vlak heeft geen blokken.

Dat laatste is geen keuze maar wiskunde. Met blokken in alle zes vlakrichtingen moeten de 16 cellen van één 2 × 2 × 2 × 2-blok verschillen zodra ze in één of twee coördinaten verschillen. Een cijfer mag dan alleen terugkomen op afstand 3 of meer, en een binaire code van lengte 4 met afstand 3 heeft hooguit 2 woorden. Er zijn dus minstens 8 cijfers nodig, en er zijn er 4. Uitputtend zoeken bevestigt dat: met zes vlakken bestaat geen enkele 4⁴-oplossing, met vijf wel. Bij 9 × 9 × 9 × 9 kan het wél met alle zes vlakken (de ternaire tetracode maakt het mogelijk).

Met X / Y / Z / W draai je de tesseract in de vierde dimensie: een echte rotatie van 90° in het XW-, YW- of ZW-vlak, geanimeerd. De gekozen as wordt over de vier kubussen verdeeld en W neemt zijn plaats in. Zo bekijk je dezelfde puzzel in andere doorsneden. De vier kubussen staan in een 2 × 2-raster, op brede schermen naast elkaar. Door de gekozen cel lopen vier lichtrails, één per as; de W-rail verbindt dezelfde plek in alle vier de kubussen.

## Spelen

Het is een statische site zonder build-stap. Serveer de map met een willekeurige webserver en open hem in een recente browser (Edge, Chrome, Safari of Firefox):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Een `file://`-URL werkt niet, omdat ES-modules en `puzzles.json` via HTTP geladen moeten worden.

### Vercel

`vercel.json` zet het project neer als statische site zonder build-stap. Importeer de repo één keer op vercel.com (Add New → Project → `3d-Sudoku`); daarna deployt elke push naar `main` automatisch.

### Bediening

| Actie | Telefoon | Muis / toetsenbord |
|---|---|---|
| Draaien | één vinger slepen | linkermuisknop slepen |
| Zoomen | knijpen | scrollen |
| Verschuiven | twee vingers slepen | rechtermuisknop of Shift + slepen |
| Cel kiezen | tikken | klikken, pijltjestoetsen |
| Laag wisselen | ‹ › | `[` `]` |
| Richting van de lagen | X / Y / Z | `X` `Y` `Z` |
| Weergave | Kubus / Laag / Focus | `C` `L` `F` |
| Invullen / wissen | toetsenblok, Wis | `1`–`9`, `Backspace` |
| Opties aan/uit | Opties | `N` |
| Terug | Terug | `Ctrl`+`Z` |
| Hint | Hint | `H` |

- **Kubus** toont de hele kubus.
- **Laag** klapt de kubus open bij één snede. De buren van de gekozen cel buiten die laag blijven zichtbaar, en cellen tussen de camera en de laag vervagen.
- **Focus** toont alleen de zes groepen van de gekozen cel.
- **Auto** vult in alle lege cellen de nog mogelijke opties in.
- **Hint** markeert foute cijfers, of wijst een cel aan die logisch vast te leggen is en zegt waarom.

Voortgang, tijd, thema en instellingen worden lokaal in de browser bewaard (`localStorage`).

## Code

```
index.html              opmaak, import map voor three.js
css/styles.css          thema's (donker/licht) en mobiel-first layout
js/engine.js            geometrie in 3D en 4D, solver, logische grader, generator
js/scene.js             Three.js-scène: cellen, cijfers, 4D-rotatie en -projectie, camera, picking
js/main.js              spelstatus, invoer, opslag, puzzelkeuze
scripts/generate-puzzles.mjs   genereert puzzles.json
vendor/three/           three.js r184 (MIT)
fonts/                  Outfit en Unbounded (SIL OFL 1.1)
```

Rendering:

- Alle 729 cellen zijn één `InstancedMesh` (één draw call). Kleur, transparantie, cijfer en opties zijn per-instance attributen.
- Cijfers en opties worden in de fragment-shader uit een glyph-atlas op het celvlak getekend dat het meest naar de camera wijst, zodat elk cijfer één keer leesbaar in beeld staat.
- Doorzichtige cellen worden elk frame van achter naar voren gesorteerd.
- De vloerreflectie is een gespiegelde tweede instanced mesh die alle buffers met de echte cellen deelt.
- Het canvas vult het hele scherm; de camera gebruikt een view offset zodat de kubus gecentreerd staat in het deel dat niet door panelen bedekt is.
- Er wordt alleen gerenderd als er iets beweegt (camera, animatie), wat batterij spaart.

### Puzzels opnieuw genereren

```bash
node scripts/generate-puzzles.mjs
```

De generator bouwt eerst een willekeurige geldige kubus: een affiene oplossing over GF(b)², gehusseld met de symmetrieën die de regels intact laten (banden en rijen per as, aspermutatie, cijferwissel). Daarna haalt hij cijfers weg zolang de puzzel met menselijke technieken oplosbaar blijft (singles, locked candidates, naked subsets). De seeds liggen vast, dus de uitvoer is reproduceerbaar.
