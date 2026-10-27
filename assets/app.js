(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const number1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
  const number2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  const BLACK_RELATED_METRICS = new Set([
    "black_total_rate",
    "black_low_rate",
    "black_white_difference",
    "black_white_low_difference",
  ]);
  const DIFFERENCE_METRIC_PARTS = Object.freeze({
    black_white_difference: ["black_total_rate", "white_total_rate"],
    black_white_low_difference: ["black_low_rate", "white_low_rate"],
  });
  const MAP_BOUNDS = Object.freeze({ x: 0, y: 0, width: 1000, height: 620 });
  const MAX_MAP_ZOOM = 8;
  const DATA_VERSION = "20261027-limited-policing";

  const state = {
    payload: null,
    agencies: null,
    paths: null,
    countiesById: new Map(),
    mapMetric: "total_rate",
    selectedCounty: null,
    rankingLimit: 50,
    weights: {},
    mapView: { ...MAP_BOUNDS },
    mapDrag: null,
    mapDragged: false,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindStaticEvents();
    try {
      const [payload, agencies, paths] = await Promise.all([
        fetch(`data/site-data.json?v=${DATA_VERSION}`).then(checkResponse).then((r) => r.json()),
        fetch(`data/agencies.json?v=${DATA_VERSION}`).then(checkResponse).then((r) => r.json()),
        fetch(`data/map-paths.json?v=${DATA_VERSION}`).then(checkResponse).then((r) => r.json()),
      ]);
      state.payload = payload;
      state.agencies = agencies;
      state.paths = paths;
      state.countiesById = new Map(payload.counties.map((county) => [county.geoid, county]));
      setEqualWeights();
      els.publishedCount.textContent = number.format(payload.meta.publishedCount);
      populateCountyOptions();
      buildMap();
      buildWeightControls();
      updateFilterLabels();
      els.loading.hidden = true;
      window.addEventListener("hashchange", route);
      route();
    } catch (error) {
      console.error(error);
      els.loading.innerHTML = `
        <p class="eyebrow">Unable to load the site data</p>
        <h2>Open this folder through a local web server.</h2>
        <p>The site uses static JSON files that browsers do not load from a file:// address.</p>`;
    }
  }

  function checkResponse(response) {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  }

  function cacheElements() {
    els.loading = $("#loading-shell");
    els.mapView = $("#map-view");
    els.rankingView = $("#ranking-view");
    els.countyView = $("#county-view");
    els.publishedCount = $("#published-count");
    els.mapMetric = $("#map-metric");
    els.mapMetricTitle = $("#map-metric-title");
    els.mapMetricUnit = $("#map-metric-unit");
    els.mapSvg = $("#county-map");
    els.mapPaths = $("#county-paths");
    els.tooltip = $("#map-tooltip");
    els.peek = $("#county-peek");
    els.mapSearch = $("#map-search");
    els.rankingBody = $("#ranking-body");
    els.rankingCount = $("#ranking-count");
    els.rankingNote = $("#ranking-note");
    els.weightControls = $("#weight-controls");
    els.loadMore = $("#load-more");
    els.methodDialog = $("#method-dialog");
  }

  function bindStaticEvents() {
    els.mapMetric.addEventListener("change", () => {
      state.mapMetric = els.mapMetric.value;
      updateMap();
      if (state.selectedCounty) renderPeek(state.countiesById.get(state.selectedCounty));
    });
    $("#map-search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const county = findCounty(els.mapSearch.value);
      if (county) selectMapCounty(county.geoid, true);
    });
    $("#reset-weights").addEventListener("click", () => {
      setEqualWeights();
      $$("input[type=range]", els.weightControls).forEach(
        (input) => (input.value = state.weights[input.dataset.weight]),
      );
      state.rankingLimit = 50;
      updateWeightLabels();
      renderRanking();
    });
    ["min-pop", "min-black-pct", "ranking-search", "show-unstable-suppressed"].forEach((id) => {
      $(`#${id}`).addEventListener("input", () => {
        state.rankingLimit = 50;
        updateFilterLabels();
        renderRanking();
      });
    });
    els.loadMore.addEventListener("click", () => {
      state.rankingLimit += 50;
      renderRanking();
    });

    $("#map-zoom-in").addEventListener("click", () => zoomMap(1.5));
    $("#map-zoom-out").addEventListener("click", () => zoomMap(1 / 1.5));
    $("#map-zoom-reset").addEventListener("click", resetMapView);
    els.mapSvg.addEventListener("wheel", handleMapWheel, { passive: false });
    els.mapSvg.addEventListener("pointerdown", startMapDrag);
    window.addEventListener("pointermove", moveMapDrag, { passive: false });
    window.addEventListener("pointerup", endMapDrag);
    window.addEventListener("pointercancel", endMapDrag);

    [$("#method-button"), $("#method-footer-button")].forEach((button) =>
      button.addEventListener("click", () => els.methodDialog.showModal()),
    );
    $("#method-close").addEventListener("click", () => els.methodDialog.close());
    els.methodDialog.addEventListener("click", (event) => {
      if (event.target === els.methodDialog) els.methodDialog.close();
    });
  }

  function route() {
    const hash = window.location.hash.slice(1) || "map";
    const countyMatch = hash.match(/^county=(.+)$/);
    const routeName = countyMatch ? "county" : hash === "ranking" ? "ranking" : "map";
    els.mapView.hidden = routeName !== "map";
    els.rankingView.hidden = routeName !== "ranking";
    els.countyView.hidden = routeName !== "county";
    $$("[data-nav]").forEach((link) => {
      const active = link.dataset.nav === routeName || (routeName === "county" && link.dataset.nav === "map");
      link.classList.toggle("active", active);
      active ? link.setAttribute("aria-current", "page") : link.removeAttribute("aria-current");
    });
    if (routeName === "map") {
      document.title = "County Arrest Estimates · 2023–2025 average annual";
      updateMap();
    } else if (routeName === "ranking") {
      document.title = "County Rankings · County Arrest Estimates";
      renderRanking();
    } else {
      renderCountyPage(decodeURIComponent(countyMatch[1]));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function populateCountyOptions() {
    $("#county-options").innerHTML = state.payload.counties
      .map((c) => `<option value="${escapeHtml(c.name)}, ${escapeHtml(c.state)}"></option>`)
      .join("");
  }

  function findCounty(query) {
    const term = query.trim().toLowerCase();
    if (!term) return null;
    return (
      state.payload.counties.find((c) => `${c.name}, ${c.state}`.toLowerCase() === term) ||
      state.payload.counties.find((c) => c.name.toLowerCase() === term) ||
      state.payload.counties.find((c) => `${c.name} ${c.state}`.toLowerCase().includes(term))
    );
  }

  function buildMap() {
    const fragment = document.createDocumentFragment();
    state.payload.counties.forEach((county) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", state.paths[county.geoid] || "");
      path.setAttribute("class", `county-path${county.published ? "" : " suppressed"}`);
      path.setAttribute("data-geoid", county.geoid);
      path.setAttribute("tabindex", "0");
      path.setAttribute("role", "button");
      path.setAttribute("aria-label", `${county.name}, ${county.state}`);
      path.addEventListener("pointerenter", (event) => showTooltip(event, county));
      path.addEventListener("pointermove", positionTooltip);
      path.addEventListener("pointerleave", hideTooltip);
      path.addEventListener("click", () => {
        if (!state.mapDragged) selectMapCounty(county.geoid);
      });
      path.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMapCounty(county.geoid);
        }
      });
      fragment.appendChild(path);
    });
    els.mapPaths.appendChild(fragment);
    applyMapView();
    updateMap();
  }

  function zoomMap(factor, clientX = null, clientY = null) {
    const old = state.mapView;
    const minWidth = MAP_BOUNDS.width / MAX_MAP_ZOOM;
    const nextWidth = Math.max(minWidth, Math.min(MAP_BOUNDS.width, old.width / factor));
    const nextHeight = nextWidth * (MAP_BOUNDS.height / MAP_BOUNDS.width);
    if (Math.abs(nextWidth - old.width) < 0.01) return;

    let focusX = old.x + old.width / 2;
    let focusY = old.y + old.height / 2;
    if (clientX !== null && clientY !== null) {
      const rect = els.mapSvg.getBoundingClientRect();
      focusX = old.x + ((clientX - rect.left) / rect.width) * old.width;
      focusY = old.y + ((clientY - rect.top) / rect.height) * old.height;
    }
    const ratio = nextWidth / old.width;
    state.mapView = clampMapView({
      x: focusX - (focusX - old.x) * ratio,
      y: focusY - (focusY - old.y) * ratio,
      width: nextWidth,
      height: nextHeight,
    });
    applyMapView();
  }

  function resetMapView() {
    state.mapView = { ...MAP_BOUNDS };
    applyMapView();
  }

  function clampMapView(view) {
    const maxX = MAP_BOUNDS.x + MAP_BOUNDS.width - view.width;
    const maxY = MAP_BOUNDS.y + MAP_BOUNDS.height - view.height;
    return {
      ...view,
      x: Math.max(MAP_BOUNDS.x, Math.min(maxX, view.x)),
      y: Math.max(MAP_BOUNDS.y, Math.min(maxY, view.y)),
    };
  }

  function applyMapView() {
    const view = state.mapView;
    els.mapSvg.setAttribute("viewBox", `${view.x} ${view.y} ${view.width} ${view.height}`);
    const zoom = MAP_BOUNDS.width / view.width;
    $("#map-zoom-level").value = `${Math.round(zoom * 100)}%`;
    $("#map-zoom-out").disabled = zoom <= 1.001;
    $("#map-zoom-in").disabled = zoom >= MAX_MAP_ZOOM - 0.001;
    els.mapSvg.classList.toggle("zoomed", zoom > 1.001);
  }

  function handleMapWheel(event) {
    const zoom = MAP_BOUNDS.width / state.mapView.width;
    if (event.deltaY >= 0 && zoom <= 1.001) return;
    event.preventDefault();
    zoomMap(event.deltaY < 0 ? 1.28 : 1 / 1.28, event.clientX, event.clientY);
  }

  function startMapDrag(event) {
    if (event.button !== 0 || state.mapView.width >= MAP_BOUNDS.width - 0.01) return;
    event.preventDefault();
    state.mapDrag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      view: { ...state.mapView },
    };
    state.mapDragged = false;
    hideTooltip();
    els.mapSvg.setPointerCapture(event.pointerId);
    els.mapSvg.classList.add("dragging");
  }

  function moveMapDrag(event) {
    if (!state.mapDrag || event.pointerId !== state.mapDrag.pointerId) return;
    event.preventDefault();
    const rect = els.mapSvg.getBoundingClientRect();
    const dx = ((event.clientX - state.mapDrag.clientX) / rect.width) * state.mapDrag.view.width;
    const dy = ((event.clientY - state.mapDrag.clientY) / rect.height) * state.mapDrag.view.height;
    if (Math.abs(event.clientX - state.mapDrag.clientX) + Math.abs(event.clientY - state.mapDrag.clientY) > 4) {
      state.mapDragged = true;
    }
    state.mapView = clampMapView({
      ...state.mapDrag.view,
      x: state.mapDrag.view.x - dx,
      y: state.mapDrag.view.y - dy,
    });
    applyMapView();
  }

  function endMapDrag(event) {
    if (!state.mapDrag || event.pointerId !== state.mapDrag.pointerId) return;
    state.mapDrag = null;
    els.mapSvg.classList.remove("dragging");
    window.setTimeout(() => (state.mapDragged = false), 0);
  }

  function updateMap() {
    if (!state.payload) return;
    const meta = state.payload.meta.metricMeta[state.mapMetric];
    els.mapMetric.value = state.mapMetric;
    els.mapMetricTitle.textContent = meta.label;
    els.mapMetricUnit.textContent = meta.unit;
    $$(".county-path", els.mapPaths).forEach((path) => {
      const county = state.countiesById.get(path.dataset.geoid);
      const metric = county.metrics[state.mapMetric];
      let fill;
      if (!county.published) fill = "#282d38";
      else if (!metric || metric.value === null) fill = "#333b48";
      else if (isMapMetricUnstable(county)) fill = "url(#unstable-pattern)";
      else fill = percentileColor(metric.percentile);
      path.setAttribute("fill", fill);
      path.classList.toggle("selected", county.geoid === state.selectedCounty);
    });
  }

  function isMapMetricUnstable(county, metricKey = state.mapMetric) {
    return Boolean(county.metrics[metricKey]?.unstable);
  }

  function percentileColor(percentile) {
    const stops = [
      [0, "#245170"],
      [0.32, "#2a667c"],
      [0.58, "#32868d"],
      [0.8, "#3cbb94"],
      [1, "#d8ff63"],
    ];
    const t = Math.max(0, Math.min(1, (percentile || 0) / 100));
    for (let i = 1; i < stops.length; i += 1) {
      if (t <= stops[i][0]) {
        const [leftT, leftColor] = stops[i - 1];
        const [rightT, rightColor] = stops[i];
        return mixColor(leftColor, rightColor, (t - leftT) / (rightT - leftT));
      }
    }
    return stops.at(-1)[1];
  }

  function mixColor(a, b, t) {
    const left = hexToRgb(a);
    const right = hexToRgb(b);
    const values = left.map((value, i) => Math.round(value + (right[i] - value) * t));
    return `rgb(${values.join(",")})`;
  }

  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function showTooltip(event, county) {
    const metric = county.metrics[state.mapMetric];
    let detail = "Below the 80% coverage threshold";
    if (county.published && metric?.value !== null) {
      detail = isMapMetricUnstable(county)
        ? `${formatRate(metric.value)} · unstable estimates`
        : `${formatRate(metric.value)} · ${ordinal(metric.percentile)} percentile`;
    }
    els.tooltip.innerHTML = `<strong>${escapeHtml(county.name)}, ${county.state}</strong><span>${detail}</span>`;
    els.tooltip.hidden = false;
    positionTooltip(event);
  }

  function positionTooltip(event) {
    if (els.tooltip.hidden) return;
    const pad = 14;
    const rect = els.tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - pad, event.clientX + 16);
    const top = Math.min(window.innerHeight - rect.height - pad, event.clientY + 16);
    els.tooltip.style.left = `${Math.max(pad, left)}px`;
    els.tooltip.style.top = `${Math.max(pad, top)}px`;
  }

  function hideTooltip() {
    els.tooltip.hidden = true;
  }

  function selectMapCounty(geoid, scroll = false) {
    state.selectedCounty = geoid;
    const county = state.countiesById.get(geoid);
    updateMap();
    renderPeek(county);
    if (scroll) {
      const path = $(`.county-path[data-geoid="${CSS.escape(geoid)}"]`);
      path?.focus({ preventScroll: true });
      els.peek.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function renderPeek(county) {
    const metric = county.metrics[state.mapMetric];
    const meta = state.payload.meta.metricMeta[state.mapMetric];
    if (!county.published) {
      els.peek.innerHTML = `
        <div class="peek-topline"><span class="status-chip suppressed">Not published</span><span class="place-line">${county.geoid}</span></div>
        <h2>${escapeHtml(county.name)}</h2><p class="place-line">${county.state}</p>
        <div class="peek-value"><span>Share of officers at agencies with usable arrest data</span><strong>${formatPct(county.coverage)}</strong><small>80% required</small></div>
        <div class="peek-facts"><div><span>Residents</span><strong>${formatNumber(county.population)}</strong></div><div><span>Black residents</span><strong>${formatPct(county.blackPopulationPct)}</strong></div></div>
        <p class="peek-description">Metric values are withheld because this county does not meet the publication threshold.</p>`;
      return;
    }
    const caution = isMapMetricUnstable(county)
      ? `<p class="peek-caution">This metric is visually suppressed because its NB2 process-noise coefficient of variation exceeds 30%. Open the county profile for the estimate and 90% interval.</p>`
      : "";
    const sourceNote = county.alternativeSources?.length
      ? `<p class="peek-source">Alternative source: ${escapeHtml(county.alternativeSources.map((source) => `${source.name} (${source.year})`).join("; "))}</p>`
      : "";
    els.peek.innerHTML = `
      <div class="peek-topline"><span class="status-chip published">Published</span><span class="place-line">${county.geoid}</span></div>
      <h2>${escapeHtml(county.name)}</h2><p class="place-line">${county.state}</p>
      <div class="peek-value"><span>${escapeHtml(meta.label)}</span><strong>${formatRate(metric?.value)}</strong><small>${escapeHtml(meta.unit)} · ${ordinal(metric?.percentile)} percentile</small></div>
      <div class="peek-facts">
        <div><span>Residents</span><strong>${formatNumber(county.population)}</strong></div>
        <div><span>Black residents</span><strong>${formatPct(county.blackPopulationPct)}</strong></div>
        <div><span>Total arrest rate (per 10k residents)</span><strong>${formatRate(county.metrics.total_rate.value)}</strong></div>
        <div><span>Officers with usable data</span><strong>${formatPct(county.coverage)}</strong></div>
      </div>
      ${caution}
      ${sourceNote}
      <a class="button primary" href="#county=${encodeURIComponent(county.geoid)}">Open county profile →</a>`;
  }

  function buildWeightControls() {
    els.weightControls.innerHTML = state.payload.meta.rankingMetrics
      .map((key) => {
        const meta = state.payload.meta.metricMeta[key];
        return `<div class="weight-row">
          <label class="weight-label" for="weight-${key}"><span>${escapeHtml(meta.rankingLabel || meta.short)}</span><output id="weight-output-${key}"></output></label>
          <input id="weight-${key}" data-weight="${key}" type="range" min="0" max="100" step="1" value="${state.weights[key]}" />
        </div>`;
      })
      .join("");
    $$("input[type=range]", els.weightControls).forEach((input) => {
      input.addEventListener("input", () => {
        state.weights[input.dataset.weight] = Number(input.value);
        state.rankingLimit = 50;
        updateWeightLabels();
        renderRanking();
      });
    });
    updateWeightLabels();
  }

  function setEqualWeights() {
    if (!state.payload) return;
    const keys = state.payload.meta.rankingMetrics;
    const equalWeight = 100 / keys.length;
    state.weights = Object.fromEntries(keys.map((key) => [key, equalWeight]));
  }

  function updateWeightLabels() {
    const total = Object.values(state.weights).reduce((sum, value) => sum + value, 0) || 1;
    Object.entries(state.weights).forEach(([key, value]) => {
      $(`#weight-output-${key}`).textContent = `${Math.round((100 * value) / total)}%`;
    });
  }

  function renderRanking() {
    if (!state.payload) return;
    const minPop = populationThresholdFromSlider(numericInput("min-pop"));
    const minBlackPct = numericInput("min-black-pct");
    const search = $("#ranking-search").value.trim().toLowerCase();
    const showFlagged = $("#show-unstable-suppressed").checked;
    const activeWeights = Object.entries(state.weights).filter(([, weight]) => weight > 0);
    const weightTotal = activeWeights.reduce((sum, [, weight]) => sum + weight, 0);
    const candidates = state.payload.counties.filter((county) => {
      const hasUnstableValues = activeWeights.some(([key]) => county.metrics[key]?.unstable);
      if (!showFlagged && (!county.published || hasUnstableValues)) return false;
      if (minPop !== null && county.population < minPop) return false;
      if (minBlackPct !== null && county.blackPopulationPct < minBlackPct) return false;
      if (search && !`${county.name} ${county.state}`.toLowerCase().includes(search)) return false;
      return true;
    });
    const scored = candidates.map((county) => {
      const complete =
        county.published &&
        weightTotal > 0 &&
        activeWeights.every(([key]) => county.metrics[key]?.percentile !== null);
      const score = complete
        ? activeWeights.reduce(
            (sum, [key, weight]) => sum + reportedPercentile(county.metrics[key].percentile) * weight,
            0,
          ) / weightTotal
        : null;
      return { county, score, complete };
    });
    scored.sort((a, b) => {
      if (a.county.published !== b.county.published) return a.county.published ? -1 : 1;
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      if (a.score !== b.score) return (b.score ?? -1) - (a.score ?? -1);
      return `${a.county.state}${a.county.name}`.localeCompare(`${b.county.state}${b.county.name}`);
    });
    let rank = 0;
    const rankedRows = scored.map((row) => ({ ...row, rank: row.complete ? ++rank : null }));
    const visible = rankedRows.slice(0, state.rankingLimit);
    els.rankingBody.innerHTML = visible.map(rankingRowHtml).join("");
    $$("tr[data-geoid]", els.rankingBody).forEach((row) => {
      const county = state.countiesById.get(row.dataset.geoid);
      if (!county?.published) return;
      row.addEventListener("click", () => (window.location.hash = `county=${encodeURIComponent(county.geoid)}`));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter") window.location.hash = `county=${encodeURIComponent(county.geoid)}`;
      });
    });
    els.rankingCount.textContent = number.format(scored.length);
    els.rankingNote.textContent = `${describeWeights()} · ${showFlagged ? "unstable estimates included · coverage-suppressed shown last" : "published counties below the 30% CV threshold only"}`;
    els.loadMore.hidden = state.rankingLimit >= rankedRows.length;
  }

  function rankingRowHtml({ county, score, complete, rank }) {
    const status = !county.published
      ? `<span class="badge partial">Below coverage</span>`
      : Object.values(county.metrics).some((metric) => metric.unstable)
        ? `<span class="badge caution">Unstable estimates</span>`
        : !complete
          ? `<span class="badge partial">Missing denominator</span>`
          : "";
    const metricCell = (key) => {
      const metric = county.metrics[key];
      return metric?.value === null
        ? "—"
        : `<span>${formatRate(metric.value)}</span><small>${metric.percentile === null ? "" : `P${Math.round(reportedPercentile(metric.percentile))}`}</small>`;
    };
    return `<tr data-geoid="${escapeHtml(county.geoid)}" class="${county.published ? "" : "suppressed-row"}" ${county.published ? 'tabindex="0"' : ""}>
      <td class="rank-number">${rank ? number.format(rank) : "—"}</td>
      <td class="county-cell"><strong>${escapeHtml(county.name)}</strong><small>${county.state} · pop. ${formatNumber(county.population)}</small></td>
      <td class="score-cell">${score === null ? "—" : number1.format(score)}</td>
      <td class="metric-cell">${metricCell("total_rate")}</td>
      <td class="metric-cell">${metricCell("low_rate")}</td>
      <td class="metric-cell">${metricCell("black_total_rate")}</td>
      <td class="metric-cell">${metricCell("black_low_rate")}</td>
      <td class="metric-cell">${metricCell("black_white_difference")}</td>
      <td class="metric-cell">${metricCell("black_white_low_difference")}</td>
      <td>${status}</td>
    </tr>`;
  }

  function describeWeights() {
    const values = Object.values(state.weights);
    if (values.every((value) => value === values[0])) return "Equal weights";
    return "Custom weights";
  }

  function numericInput(id) {
    const value = $(`#${id}`).value;
    return value === "" ? null : Number(value);
  }

  function populationThresholdFromSlider(position) {
    if (position === null || position <= 0) return null;
    const raw = 10 ** (2 + (5 * position) / 100);
    const step = raw < 1000 ? 100 : raw < 10000 ? 500 : raw < 100000 ? 5000 : raw < 1000000 ? 25000 : 250000;
    return Math.round(raw / step) * step;
  }

  function updateFilterLabels() {
    const population = populationThresholdFromSlider(numericInput("min-pop"));
    const populationLabel = population === null ? "No minimum" : number.format(population);
    $("#min-pop-output").textContent = populationLabel;
    $("#min-pop").setAttribute("aria-valuetext", populationLabel);

    const blackPct = numericInput("min-black-pct") ?? 0;
    const blackPctLabel = `${number.format(blackPct)}%`;
    $("#min-black-pct-output").textContent = blackPctLabel;
    $("#min-black-pct").setAttribute("aria-valuetext", blackPctLabel);
  }

  function renderCountyPage(geoid) {
    const county = state.countiesById.get(geoid);
    if (!county) {
      els.countyView.innerHTML = `<div class="suppressed-panel panel"><div><p class="eyebrow">County not found</p><h1>That profile does not exist.</h1><a class="button primary" href="#map">Return to the map</a></div></div>`;
      return;
    }
    document.title = `${county.name}, ${county.state} · County Arrest Estimates`;
    if (!county.published) {
      els.countyView.innerHTML = suppressedCountyHtml(county);
      return;
    }
    const topMetrics = [
      "total_rate",
      "low_rate",
      "black_total_rate",
      "black_low_rate",
      "white_total_rate",
      "white_low_rate",
      "black_white_difference",
      "black_white_low_difference",
    ];
    const countyAgencies = state.agencies[county.geoid] || [];
    const allCautions = county.cautions;
    const alternativeSourceSection = county.alternativeSources?.length
      ? `<section class="alternative-source-panel panel">
          <p class="eyebrow">Alternative arrest data used</p>
          <div class="alternative-source-list">${county.alternativeSources.map(alternativeSourceHtml).join("")}</div>
        </section>`
      : "";
    const countyLevelAlternative = county.alternativeSources?.some(
      (source) => source.geography === "county",
    );
    const agencyDescription = countyLevelAlternative
      ? "Agency rows retain the temporally modeled 2023–2025 average annual values and may not sum to the county headline, whose selected annual component(s) use an approved alternative source."
      : "Average annual arrest counts and officers are apportioned to this county. Agencies are ordered by estimated total arrests contributed here.";
    els.countyView.innerHTML = `
      <a class="back-link" href="#map">← Back to national map</a>
      <header class="county-hero">
        <div>
          <p class="eyebrow">County profile · ${escapeHtml(county.geoid)}</p>
          <h1>${escapeHtml(county.name)}</h1>
          <div class="county-subline"><span>${county.state}</span><span>•</span><span>${formatNumber(county.population)} residents</span></div>
        </div>
        <div class="coverage-gauge"><span>Share of officers at agencies with usable arrest data</span><strong>${formatPct(county.coverage)}</strong></div>
      </header>
      ${alternativeSourceSection}
      <div class="metric-grid-intro">
        <p>Bars plot the estimated rate per 10,000. Each card reports an approximate 90% credible interval from NB2 process noise. These intervals do not include uncertainty from corrections, imputations, source translation, or alternative data.</p>
      </div>
      <section class="metric-grid" aria-label="County headline metrics">
        ${topMetrics.map((key, index) => metricCardHtml(county, key, index === 2)).join("")}
      </section>
      <div class="county-support-grid">
        <section class="section-panel panel">
          <p class="eyebrow">County profile</p>
          <div class="profile-facts">
            <div><span>Residents</span><strong>${formatNumber(county.population)}</strong></div>
            <div><span>Black residents</span><strong>${formatPct(county.blackPopulationPct)}</strong></div>
            <div><span>Black population</span><strong>${formatNumber(county.blackPopulation)}</strong></div>
            <div><span>NH White population</span><strong>${formatNumber(county.whitePopulation)}</strong></div>
            <div><span>Officers</span><strong>${formatNumber(county.officers)}</strong></div>
            <div><span>Agencies</span><strong>${number.format(county.agencyCount)}</strong></div>
          </div>
        </section>
        <section class="section-panel panel">
          <p class="eyebrow">Applicable cautions</p>
          ${allCautions.length ? `<div class="caution-list">${allCautions.map(cautionHtml).join("")}</div>` : '<p class="no-cautions">No adjustment or alternative-source cautions apply to this county.</p>'}
        </section>
      </div>
      <section class="agency-panel panel">
        <div class="section-head"><div><p class="eyebrow">Agency contributions</p><h2>${number.format(countyAgencies.length)} apportioned agencies</h2></div><p>${escapeHtml(agencyDescription)}</p></div>
        <div class="table-wrap">
          <table class="data-table agency-table">
            <thead><tr><th>Agency</th><th>% in county</th><th>Officers</th><th>Total</th><th>Low-level</th><th>All other</th><th>Black</th><th>Black low</th><th>NH White</th><th>NH White low</th><th>Hispanic</th><th>Hispanic low</th><th>Other NH</th><th>Other NH low</th></tr></thead>
            <tbody>${countyAgencies.map(agencyRowHtml).join("")}</tbody>
          </table>
        </div>
      </section>`;
  }

  function alternativeSourceHtml(source) {
    const geography = source.geography === "county" ? "County-level source" : "Agency-level source";
    const note = source.note
      ? `<p class="alternative-source-note"><strong>Source limitation:</strong> ${escapeHtml(source.note)}</p>`
      : "";
    return `<article class="alternative-source-item">
      <div><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(String(source.year))} · ${geography}</span></div>
      <p>${escapeHtml(source.description)}</p>
      ${note}
    </article>`;
  }

  function metricCardHtml(county, key, featured) {
    const meta = state.payload.meta.metricMeta[key];
    const metric = county.metrics[key];
    const summary = state.payload.meta.metricSummaries[key];
    const scale = metricScale(metric.value, summary, Boolean(DIFFERENCE_METRIC_PARTS[key]));
    const parts = DIFFERENCE_METRIC_PARTS[key];
    const countHtml = parts
      ? `<div class="metric-arrest-counts two-groups">
          <div><span>Estimated Black arrests</span><strong>${formatArrestCount(county.metrics[parts[0]].numerator)}</strong></div>
          <div><span>Estimated NH White arrests</span><strong>${formatArrestCount(county.metrics[parts[1]].numerator)}</strong></div>
        </div>`
      : `<div class="metric-arrest-counts"><div><span>Estimated arrests</span><strong>${formatArrestCount(metric.numerator)}</strong></div></div>`;
    const referenceMarks = [
      ["25th", summary.p25],
      ["50th", summary.median],
      ["75th", summary.p75],
    ]
      .map(([label, value]) => `<span class="rate-reference" style="left:${scale.position(value)}%"><i></i><em><b>${label}</b>${formatRate(value)}</em></span>`)
      .join("");
    const marker = scale.valuePosition === null
      ? ""
      : `<span class="county-rate-marker" style="left:${scale.valuePosition}%"></span><span class="county-rate-fill" style="left:${scale.fillLeft}%;width:${scale.fillWidth}%"></span>`;
    const scaleLabel = metric.value === null || metric.value === undefined
      ? `National reference values: 25th percentile ${formatRate(summary.p25)}, median ${formatRate(summary.median)}, and 75th percentile ${formatRate(summary.p75)}.`
      : `County rate ${formatRate(metric.value)}. National reference values: 25th percentile ${formatRate(summary.p25)}, median ${formatRate(summary.median)}, and 75th percentile ${formatRate(summary.p75)}.`;
    const cvLabel = metric.cv === null || metric.cv === undefined
      ? "not estimable"
      : formatPct(metric.cv * 100);
    const uncertaintyNote = metric.unstable
      ? `<p class="metric-uncertainty-warning">Unstable estimates: CV ${cvLabel} exceeds the 30% display threshold or cannot be estimated. The map suppresses this metric.</p>`
      : "";
    return `<article class="metric-card ${featured ? "featured" : ""}">
      ${metric.unstable ? '<span class="badge caution">Unstable estimates</span>' : ""}
      <span>${escapeHtml(meta.label)}</span>
      <strong>${formatRate(metric.value)}</strong>
      <div class="metric-unit">${escapeHtml(meta.unit)}</div>
      <div class="metric-interval">90% CrI ${formatRate(metric.lower90)}–${formatRate(metric.upper90)}</div>
      ${uncertaintyNote}
      <small class="metric-percentile">${ordinal(metric.percentile)} percentile</small>
      <div class="rate-scale" role="img" aria-label="${escapeHtml(scaleLabel)}">
        <div class="rate-track">
          ${marker}
          ${scale.includesZero ? `<span class="rate-zero" style="left:${scale.zeroPosition}%"></span>` : ""}
          ${referenceMarks}
        </div>
      </div>
      ${countHtml}
    </article>`;
  }

  function metricScale(value, summary, isDifference) {
    const p25 = Number(summary.p25);
    const p75 = Number(summary.p75);
    const median = Number(summary.median);
    const metricValue = value === null || value === undefined ? null : Number(value);
    const iqr = Math.max(p75 - p25, Math.abs(median) * 0.1, 1);
    let minimum = isDifference ? Math.min(0, p25 - 1.5 * iqr) : 0;
    let maximum = Math.max(p75 + 1.5 * iqr, 1);
    if (Number.isFinite(metricValue)) {
      if (metricValue < minimum) minimum = metricValue - Math.max(Math.abs(metricValue) * 0.08, iqr * 0.15);
      if (metricValue > maximum) maximum = metricValue + Math.max(Math.abs(metricValue) * 0.08, iqr * 0.15);
    }
    const span = maximum - minimum || 1;
    const position = (point) => Math.max(0, Math.min(100, ((Number(point) - minimum) / span) * 100));
    const zeroPosition = position(0);
    const valuePosition = Number.isFinite(metricValue) ? position(metricValue) : null;
    return {
      position,
      zeroPosition,
      valuePosition,
      fillLeft: valuePosition === null ? 0 : Math.min(zeroPosition, valuePosition),
      fillWidth: valuePosition === null ? 0 : Math.abs(valuePosition - zeroPosition),
      includesZero: isDifference,
    };
  }

  function cautionHtml(caution) {
    const magnitude = caution.pct === null || caution.pct === undefined
      ? "Stability caution"
      : `${number2.format(caution.pct)}% of estimated total arrests`;
    return `<article class="caution-item"><strong>${escapeHtml(caution.label)}</strong><span>${magnitude}</span><p>${escapeHtml(caution.description)}</p></article>`;
  }

  function agencyRowHtml(agency) {
    const sourceParts = [];
    if (agency.directYears > 0) {
      sourceParts.push(`${agency.directYears} direct NIBRS/SRS ${agency.directYears === 1 ? "year" : "years"}`);
    }
    if (agency.alternativeYears > 0) {
      sourceParts.push(`${agency.alternativeYears} Florida alternative ${agency.alternativeYears === 1 ? "year" : "years"}`);
    }
    const sourceNote = agency.usableSourceYears === 0
      ? " · fully imputed 3-year average"
      : agency.usableSourceYears < 3
        ? ` · ${sourceParts.join(" + ")}; remaining years imputed`
        : ` · ${sourceParts.join(" + ")}`;
    return `<tr>
      <td class="agency-name"><strong>${escapeHtml(agency.name || agency.ori)}</strong><small>${escapeHtml(agency.ori)} · ${escapeHtml(agency.type || "Agency")}${sourceNote}</small></td>
      <td>${formatPct(agency.allocationPct)}</td><td>${formatNumber(agency.officers)}</td>
      <td>${formatArrestCount(agency.total)}</td><td>${formatArrestCount(agency.low)}</td><td>${formatArrestCount(agency.other)}</td>
      <td>${formatArrestCount(agency.black)}</td><td>${formatArrestCount(agency.lowBlack)}</td>
      <td>${formatArrestCount(agency.white)}</td><td>${formatArrestCount(agency.lowWhite)}</td>
      <td>${formatArrestCount(agency.hispanic)}</td><td>${formatArrestCount(agency.lowHispanic)}</td>
      <td>${formatArrestCount(agency.otherNonHispanic)}</td><td>${formatArrestCount(agency.lowOtherNonHispanic)}</td>
    </tr>`;
  }

  function suppressedCountyHtml(county) {
    const sourceNote = county.alternativeSources?.length
      ? `<p>Available alternative source: ${escapeHtml(county.alternativeSources.map((source) => `${source.name} (${source.year})`).join("; "))}.</p>`
      : "";
    return `
      <a class="back-link" href="#map">← Back to national map</a>
      <header class="county-hero">
        <div><p class="eyebrow">County profile · ${escapeHtml(county.geoid)}</p><h1>${escapeHtml(county.name)}</h1><div class="county-subline"><span>${county.state}</span><span>•</span><span>${formatNumber(county.population)} residents</span><span class="status-chip suppressed">Not published</span></div></div>
        <div class="coverage-gauge"><span>Share of officers at agencies with usable arrest data</span><strong style="color:var(--muted)">${formatPct(county.coverage)}</strong></div>
      </header>
      <section class="suppressed-panel panel"><div><p class="eyebrow">Below the coverage standard</p><div class="coverage-big">${formatPct(county.coverage)}</div><h2>Metric values are withheld for this county.</h2><p>Agencies with usable real data account for less than 80% of the known officers serving the county. Agencies with fully estimated arrest totals do not count toward the threshold, and the county is not ranked or selectable from the ranking table.</p>${sourceNote}<a class="button secondary" href="#ranking">View county rankings</a></div></section>`;
  }

  function formatNumber(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : number1.format(Number(value));
  }

  function formatRate(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : number.format(Number(value));
  }

  function formatArrestCount(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : number.format(Math.round(Number(value)));
  }

  function formatPct(value) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${number1.format(Number(value))}%`;
  }

  function ordinal(value) {
    const capped = reportedPercentile(value);
    if (capped === null) return "No";
    const n = Math.round(capped);
    const mod100 = n % 100;
    const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
    return `${n}${suffix}`;
  }

  function reportedPercentile(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
    return Math.min(99, Math.max(1, Number(value)));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
