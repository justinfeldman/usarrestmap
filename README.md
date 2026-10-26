# County Arrest Estimates

A static, dark-mode data explorer for 2023–2025 average annual county arrest estimates. It includes:

- a zoomable, percentile-scaled U.S. county map;
- a six-metric weighted ranking with population filters; and
- detailed county profiles with rate components, coverage, cautions, and agency estimates.
- a downloadable county-level CSV with IDs, metrics, percentiles, numerators, denominators, and stability flags.

The site has no server-side components or runtime package dependencies. All routes use URL hashes and all assets use relative paths, so the folder can be deployed directly with GitHub Pages.

## Preview locally

From this directory, run:

```sh
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173/#map>.

Opening `index.html` directly is not supported because browsers normally block the local JSON requests used by the site.

## Publish with GitHub Pages

1. Put the contents of this directory in a GitHub repository (or in the repository's `docs/` directory).
2. In **Settings → Pages**, choose **Deploy from a branch**.
3. Select the branch and either `/ (root)` or `/docs`, matching where these files live.

No build command is required.

## Data notes

- Headline counts are the mean of the complete 2023, 2024, and 2025 calendar-year estimates. Rates use those average annual counts and fixed 2025 population denominators.
- Map colors, county comparisons, and ranking inputs use published counties at or below the metric-specific 30% NB2 coefficient-of-variation threshold as their reference distributions. Higher-uncertainty values are assigned percentiles against those reference distributions without influencing them.
- Counties are generally suppressed and excluded from rankings when fewer than 80% of officers are at agencies with at least one credible reporting year during 2023–2025. Validated statewide sources can support publication where national reporting is incomplete.
- Approved 2025 Florida CJDT and California OpenJustice values replace an otherwise temporally imputed 2025 county component. Agency rows retain their temporal estimates and may therefore not sum to an alternative-source county headline.
- A non-sheriff agency-year is treated as unusable when its within-year-corrected count is below one arrest per full-time officer. Missing calendar years are imputed as aggregate years; agencies with no direct year receive a model of their three-year average annual value.
- Each metric includes an approximate 90% credible interval for the three-year mean based on metric-specific NB2 process noise. It does not incorporate uncertainty from adjustments, source translation, or imputation.
- A county metric is visually suppressed on the map when its coefficient of variation exceeds 30%; the county profile still reports its estimate and interval with an unstable-estimate note.
- Black arrest counts use observed NIBRS race shares for agencies with credible race reporting and a validated statistical model elsewhere.
- Population, staffing, covariates, roster membership, and geography are held fixed at their 2025 analytical values across the three-year period. Population denominators use the 2020–2024 American Community Survey five-year estimates.

The generated files in `data/` are part of the deployable site and include the complete county download.
