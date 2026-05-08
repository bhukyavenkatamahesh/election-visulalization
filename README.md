# Visualizing Indian Electoral Patterns (2004–2024)

An interactive D3.js dashboard exploring trends, swing constituencies, candidate
wealth & criminal records, voter turnout, and party dynamics across five Lok Sabha
elections (2004, 2009, 2014, 2019, 2024).

**Team:** Pritam Maji (2025JTM2085) · Venkata Mahesh (2025JTM2088) ·
Suvajyoti Biswas (2025JTM2518) — IIT Delhi, JTM program.

---

## Running locally

```bash
cd election-viz
npm start
# then open http://localhost:8000
```

Tested on Chrome / Safari latest. The dashboard opens on **2019** because that is
the year with the richest source coverage across all five panels.

Requires internet on first load to pull D3 v7 and d3-sankey from CDN.

Useful maintenance commands:

```bash
npm test             # validate required files, data columns, and GeoJSON shape
npm run verify:data  # print source-data coverage checks
npm run build:data   # regenerate public/data/*.csv from Data/
npm run build:site   # copy only deployable static assets to dist/
```

---

## Views

| Panel | File | What it shows |
|---|---|---|
| **Electoral Map** | [js/map.js](js/map.js) | Choropleth of 543 constituencies. Hue = winning party; saturation = victory margin. Hover shows winner, party, margin %, **turnout %, total electors, and votes polled** (from constituency-level turnout data). Pan/zoom; click to filter by state; double-click to reset. |
| **Party Power Dynamics** | [js/bumpchart.js](js/bumpchart.js) | Bump chart of top-10 parties by seats won, 2004 → 2024. Click a node to cross-filter every other panel by party. |
| **Voter Flow Analysis** | [js/sankey.js](js/sankey.js) | Sankey of constituency-level seat transitions between consecutive elections. The 2004→2009 ribbon is a lower bound due to the 2008 delimitation. |
| **Candidate Landscape** | [js/scatterplot.js](js/scatterplot.js) | **2019:** scatter of all 7,472 candidates (declared assets on x [symlog], votes on y, radius = criminal cases). Uses the full MyNeta affidavit dataset — tooltip shows education and age. **2004/2009/2014/2024:** scatter of vote share % (x) vs. votes (y) using `elections_master.csv` — displays all candidates for those years. |
| **Participation & Representation** | [js/participation.js](js/participation.js) | Turnout bars by state + candidate gender mix. **2024** is fully populated: turnout derived from `turnout_by_constituency.csv`; gender derived from `elections_master.csv`. Gender bar uses smart callout labels — narrow segments (Female ~9%) show a colour-matched pill below the bar so percentages are always readable. |

All five views share one global state object (`js/main.js`).
Selecting a state on the map or a party on the bump chart cross-filters every
other view.

---

## Data

### Processed CSVs served to the browser
In [`public/data/`](public/data/):

| File | Rows | Purpose |
|---|---|---|
| `elections_master.csv` | ~38 k | All candidates, 2004–2024. Columns: year, state, constituency, candidate, party, votes, rank, vote share, is_winner, margin, total_assets, criminal_cases, gender, electors. |
| `winners_map.csv` | ~2 700 | One row per winning candidate — used by the map, bump chart, and Sankey. |
| `party_ranks.csv` | ~50 | Pre-computed party seat totals + national rank per year for the bump chart. |
| `participation_summary.csv` | ~1 500 | Constituency-level turnout (2004–2019). 2024 is derived at runtime from `turnout_by_constituency.csv`. |
| `candidate_gender_summary.csv` | ~500 | Candidate counts by year, state, gender (2004–2019). 2024 derived at runtime from `elections_master.csv`. |
| `candidates_2019_myneta_full.csv` | 7 472 | Full MyNeta affidavit extract for 2019 — assets, liabilities, criminal cases, education, age, party. Powers the enriched 2019 scatter plot. |
| `turnout_by_constituency.csv` | ~2 700 | Constituency-level turnout %, total electors, votes polled (2009–2024). Feeds the map tooltip and the 2024 participation panel. |
| `results_2014_candidate_wise.csv` | ~8 000 | All 2014 candidates with votes — reserved for future historical drill-down. |
| `candidates_2024.csv` | ~8 000 | 2024 candidate list — reserved for future affidavit enrichment. |
| `india_pc_2019_simplified.geojson` | 543 features | Post-delimitation PC polygons; degenerate micro-rings cleaned at load time to prevent projection clipping of northern states. |

### Raw sources

| Source | Path / URL | Use |
|---|---|---|
| Election Commission of India | [Data/results/](Data/results/) | Candidate-wise results (2014, 2019, 2024) |
| *india-election-data* | [Data/india-election-data-master/](Data/india-election-data-master/) | Pre-cleaned multi-year results (2004, 2009) |
| ADR / MyNeta | [Data/candidates/](Data/candidates/) | Candidate affidavits, education, criminal records |
| Delimitation Commission | [Data/boundaries/](Data/boundaries/) | PC boundary GeoJSON |

### Cleaning pipeline

`Data/clean_data.py` merges raw sources into the processed CSVs under
`public/data/`. `Data/scrape_myneta.py` scrapes MyNeta affidavits using only
Python standard-library modules.

---

## Tech stack

- **D3.js v7** — scales, shapes, transitions, zoom, geoPath, symlog
- **d3-sankey 0.12** — Sankey layout
- **Vanilla HTML + CSS** — no React, no build step, no bundler
- **Python 3 + pandas** — data cleaning scripts in `Data/`

---

## Data loading strategy

All eight CSV/JSON files are fetched in parallel at startup. The two enrichment
files (`candidates_2019_myneta_full.csv`, `turnout_by_constituency.csv`) are
wrapped in `.catch(() => [])` so the dashboard remains fully functional even if
those files are unavailable — every panel falls back gracefully to
`elections_master.csv`.

---

## Known limitations

1. **2024 affidavit coverage.** Asset/criminal-case fields are not yet available
   for 2024 candidates. The scatter plot shows vote share % vs. votes for 2024
   instead of assets.
2. **Turnout approximation (2019).** Turnout for 2019 in `participation_summary.csv`
   divides candidate votes by constituency electors and may exclude NOTA ballots.
   The constituency-level `turnout_by_constituency.csv` uses official ECI figures.
3. **2008 delimitation gap.** The 2004→2009 Sankey ribbon misses constituencies
   that were renamed or split; treat it as a lower bound on seat flow.
4. **Party normalisation is alias-based.** Breakaway factions (e.g. the 2022 Shiv
   Sena split) appear as separate entities rather than being reconciled.
5. **Northern state projection.** Punjab, Haryana, Himachal Pradesh, and
   Uttarakhand were previously clipped due to degenerate polygon rings in the
   GeoJSON. Fixed by filtering rings with area < 0.001 sq. deg. before
   `fitExtent()`.

---

## Repo layout

```
.
├── index.html                   # Dashboard shell
├── css/style.css                # Dark-mode design system
├── js/
│   ├── main.js                  # Global state, data loading, dispatch
│   ├── map.js                   # Choropleth + turnout tooltip
│   ├── bumpchart.js             # Party rank bump chart
│   ├── sankey.js                # Seat-flow Sankey
│   ├── scatterplot.js           # Candidate scatter (myneta 2019 / master others)
│   └── participation.js         # Turnout bars + gender mix (all years)
├── public/data/                 # Cleaned CSVs + GeoJSON (browser-loaded)
├── Data/                        # Raw sources + cleaning scripts
├── scripts/                     # Validation and static deploy helpers
├── REPORT.md                    # Final report
└── README.md                    # You are here
```

---

## Report

See [REPORT.md](REPORT.md) for the full write-up: problem statement, design
rationale per view, analytical findings, limitations, and literature survey.

---

## References

1. Lupi, G. & Posavec, S. *Dear Data*. Princeton Arch. Press, 2020.
2. Hullman, J. et al. "Why Authors Don't Visualize Uncertainty." *IEEE VIS*, 2019.
3. Battle, L. & Heer, J. "Scalable Linked Views for Exploratory Data Analysis." *Computer Graphics Forum*, 2021.
4. Bostock, M., Ogievetsky, V. & Heer, J. "D³: Data-Driven Documents." *IEEE TVCG*, 2018.
5. Rao, A. et al. "Visual Analysis of Indian Electoral Affidavit Data." *CHI*, 2023.
