# County Arrest Estimates

A static, dark-mode data explorer for the 2025 county arrest estimates. It includes:

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

- Rates are reported per 100,000 residents.
- Map colors, county comparisons, and ranking inputs use metric-specific stable counties as their percentile reference distributions. Unstable values are assigned percentiles against those stable distributions without influencing them.
- Counties are generally suppressed and excluded from rankings when agencies with usable arrest data account for less than 80% of the known officers serving the county. Validated statewide sources can support publication where national reporting is incomplete.
- Florida estimates can use 2025 Criminal Justice Data Transparency agency records. Ten California counties use 2024 California DOJ OpenJustice county totals with a held-out-validated simple calibration to the site's 2025 definitions; county pages identify these sources and any known source limitations.
- A non-sheriff agency is treated as having no usable arrest report when its underreporting-corrected count is below one arrest per full-time officer. It is then estimated with the same validated statistical procedure used for other nonreporting agencies.
- Low-volume estimates remain available with a visible caution when a county has fewer than 250 arrests in the underlying reported data. This uses the applicable national, Florida, or California source; there is no minimum estimated-arrest rule.
- Black and Black–White metrics also receive a caution when the county has fewer than 100 estimated Black arrests.
- Black arrest counts use observed NIBRS race shares for agencies with credible race reporting and a validated statistical model elsewhere.
- Population denominators use the 2020–2024 American Community Survey five-year estimates.

The generated files in `data/` are part of the deployable site and include the complete county download.
