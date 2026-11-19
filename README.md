# Intercompany Detective

A single-page demo for the Nokia Finance Hackathon. It scans open intercompany lines from three ERPs (P20, BPP, P10), groups the problems and proposes a fix for each, so accountants review a short list of cases instead of thousands of rows.

![Overview](docs/overview.png)

## Features

| Tab | What it does |
|---|---|
| Overview | KPI cards, lines by posting month, issues by group, issues by type, oldest overdue cases |
| Errors | Five error groups, each line with a proposed fix you can approve or reject |
| Overdue | Lines past due grouped into cases, with owner, status and note |
| Owners | Manage the names available for overdue-case assignments |
| Calendar | Due dates in red (overdue), amber (within 14 days) and green, plus a bell for alerts |
| Analysis | Error shares, review progress, recommendations, CSV exports and a PDF report |
| Currency | USD, EUR and HUF rates, add any other currency, open amounts by currency |
| Comments | Weak line texts with a suggested standard comment |

The ten rules: wrong or missing trading partner, wrong or invalid currency, FX revaluation line, possible duplicate, offsetting lines not cleared, open more than 365 days, zero-amount line and self-posted control line.

## Run it

No install needed. Open the built file in a browser:

```bash
python3 build.py
# then open dist/Intercompany_Detective.html (double-click it)
```

This builds one self-contained HTML file with the synthetic sample data from `data/sample.json`.

### With the real hackathon data

The hackathon data is confidential, so it is not in this repo. Put your own file at `data/data.json` (format in [data/README.md](data/README.md)); git ignores it. Then run `python3 build.py` again, or pass a path: `python3 build.py path/to/data.json`.

You can also open any build and click **Load data** to try a `data.json` for the current browser session.

## Project layout

```
src/index.html        page markup (the tabs and layout)
src/styles.css        design system and all styling
src/app.js            all app logic, charts and PDF report
vendor/               jsPDF, used for the PDF report
data/sample.json      synthetic sample data
data/README.md        data format
build.py              builds dist/Intercompany_Detective.html
docs/                 screenshots
```

## Editing

Change `src/index.html`, `src/styles.css` or `src/app.js`, run `python3 build.py`, and reload `dist/Intercompany_Detective.html`. The build inlines everything into one file you can share.

## Notes

- Approve and reject decisions, owner names, assignments, statuses and notes are stored in your browser only.
- Currency rates are ECB euro reference rates from 12 Nov 2026.
- The AI buttons and the ECB refresh only work when the page runs inside Claude as an artifact. In a plain browser they are hidden.
- The design follows the public look of nokia.com (blue `#005AFF`, 4px base unit). It uses no Nokia logo or assets.
