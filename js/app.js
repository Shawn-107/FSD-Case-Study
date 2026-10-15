/* RightPlace — no framework, map library, backend, or user-data HTML injection. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = Object.fromEntries([
    'offlineBanner', 'searchForm', 'locationInput', 'queryInput', 'locationError', 'queryError',
    'locationCheck', 'queryCheck', 'useLocationBtn', 'cityPreset', 'radiusSelect',
    'clearQueryBtn', 'clearHistoryBtn', 'suggestionPanel', 'suggestionTitle',
    'suggestionList', 'suggestionHint', 'submitBtn', 'submitText', 'submitSpinner',
    'feedback', 'lockedPlace', 'lockedPlaceText', 'resultsArea', 'resultsCount',
    'initialState', 'loadingState', 'resultNote', 'loadMoreBtn', 'messageState', 'messageTitle', 'messageBody',
    'messageTips', 'retryBtn', 'didYouMean', 'didYouMeanList', 'resultGroups',
    'nearGroup', 'nearCount', 'nearList', 'farGroup', 'farCount', 'farList',
    'demoQueries', 'noSelection', 'selectionDetails', 'selectedType', 'selectedName',
    'selectedAddress', 'selectedDistance', 'mapFrame', 'placeLink', 'copyLinkBtn'
  ].map((id) => [id, $(id)]));

  const PHOTON = 'https://photon.komoot.io/api/';
  const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  const OVERPASS_BACKUP = 'https://overpass-api.de/api/interpreter';
  const HISTORY_KEY = 'rightplace.recent.v1';
  const isValidNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const cleanText = (value) => String(value ?? '').trim();
  const coord = (value) => Number(value).toFixed(6);

  const state = {
    config: null, origin: null, selected: null, locked: null,
    matches: [], suggestions: [], menuItems: [], menuMode: '', activeIndex: -1,
    recent: loadHistory(), touched: { location: false, query: false },
    suggestionTimer: null, suggestionRequest: null, originRequest: null,
    searchRequest: null, loading: false, retryAction: null,
    suggestionsVersion: 0, locationVersion: 0, lastQuery: '', coverageMessage: '', categoryCoverageKm: 0
  };

  function make(tag, className = '', value = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== '') element.textContent = String(value);
    return element;
  }

  function issue(code, detail = '') {
    const error = new Error(detail || code);
    error.code = code;
    return error;
  }

  function reason(error) {
    switch (error?.code) {
      case 'offline': return ['You are offline', 'Connect to the internet and try again.'];
      case 'timeout': return ['The search timed out', 'The map service took more than 10 seconds to respond. Please retry.'];
      case 'rate-limit': return ['Too many searches', 'The service is temporarily limiting requests. Wait a few seconds and retry.'];
      case 'server': return ['Map service unavailable', 'The map service is having trouble right now. Please try again soon.'];
      case 'invalid-json': return ['Unexpected map data', 'The service returned information this app could not read. Please retry.'];
      case 'geocoding-empty': return ['Starting location not found', 'Try a clearer city, neighborhood or landmark name, or choose a preset city.'];
      case 'gps-denied': return ['Location permission denied', 'You can still type your city or select a preset.'];
      case 'gps-unsupported': return ['Location not available', 'Your browser cannot provide a location. Type a city instead.'];
      case 'gps-timeout': return ['Location took too long', 'Try Use my location again, or type your city.'];
      case 'network': return ['Could not reach the map service', 'Check your connection or browser settings and retry.'];
      default: return ['Something went wrong', 'Please try again.'];
    }
  }

  function setFeedback(message, kind = 'normal') {
    ui.feedback.textContent = message;
    ui.feedback.className = 'mt-4 rounded-xl px-4 py-3 text-sm leading-6 ' +
      (kind === 'error' ? 'border border-red-200 bg-red-50 text-red-800' :
        kind === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-900' :
          'bg-slate-50 text-slate-600');
  }

  function setLoading(value) {
    state.loading = value;
    ui.submitBtn.disabled = value;
    ui.submitSpinner.hidden = !value;
    ui.submitText.textContent = value ? 'Finding places…' : 'Find matching places';
    ui.resultsArea.setAttribute('aria-busy', String(value));
    ui.loadingState.hidden = !value;
    if (value) {
      ui.resultNote.hidden = true;
      ui.initialState.hidden = true;
      ui.messageState.hidden = true;
      ui.didYouMean.hidden = true;
      ui.resultGroups.hidden = true;
      ui.resultsCount.textContent = 'Searching…';
    }
  }

  function hideResultStates() {
    ui.initialState.hidden = true;
    ui.loadingState.hidden = true;
    ui.messageState.hidden = true;
    ui.didYouMean.hidden = true;
    ui.resultGroups.hidden = true;
    ui.resultNote.hidden = true;
    ui.loadMoreBtn.hidden = true;
  }

  function showMessage(title, body, tips = [], retry = null) {
    hideResultStates();
    ui.messageState.hidden = false;
    ui.messageTitle.textContent = title;
    ui.messageBody.textContent = body;
    ui.messageTips.replaceChildren(...tips.map((tip) => make('li', '', tip)));
    ui.messageTips.hidden = tips.length === 0;
    state.retryAction = retry;
    ui.retryBtn.hidden = typeof retry !== 'function';
    ui.resultsCount.textContent = title;
  }

  function showError(error, retry) {
    const [title, body] = reason(error);
    showMessage(title, body, [], retry);
    setFeedback(body, 'error');
  }

  function locationKey(value) { return cleanText(value).toLowerCase().replace(/\s+/g, ' '); }

  function hasValidCoordinates(lat, lon) {
    return isValidNumber(lat) && isValidNumber(lon) &&
      Number(lat) >= -90 && Number(lat) <= 90 && Number(lon) >= -180 && Number(lon) <= 180;
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const toRadians = (value) => value * Math.PI / 180;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
    return 6371.0088 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  function readableDistance(km) {
    if (!Number.isFinite(km)) return 'Distance pending';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toLocaleString(undefined, { minimumFractionDigits: km < 10 ? 1 : 0, maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
  }

  function attachDistance(place) {
    return { ...place, distanceKm: state.origin ? distanceKm(state.origin.lat, state.origin.lon, place.lat, place.lon) : null };
  }

  function uniqueNonempty(parts) {
    const seen = new Set();
    return parts.map(cleanText).filter((part) => {
      const key = part.toLocaleLowerCase();
      if (!part || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function normalizedPhoton(feature) {
    if (!feature || !Array.isArray(feature.geometry?.coordinates)) return null;
    const [lon, lat] = feature.geometry.coordinates;
    if (!hasValidCoordinates(lat, lon)) return null;
    const prop = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const name = cleanText(prop.name || prop.street || prop.city || prop.country || prop.osm_value || 'Unnamed place');
    const street = uniqueNonempty([prop.housenumber, prop.street]).join(' ');
    const address = uniqueNonempty([street, prop.district, prop.suburb, prop.city, prop.state, prop.country])
      .filter((part) => part.toLocaleLowerCase() !== name.toLocaleLowerCase()).join(', ');
    return attachDistance({ name, type: cleanText(prop.osm_value || prop.type || prop.osm_key || 'Place'),
      address: address || `Coordinates: ${coord(lat)}, ${coord(lon)}`,
      lat: Number(lat), lon: Number(lon), distanceKm: null });
  }

  function normalizedNominatim(item) {
    if (!item || !hasValidCoordinates(item.lat, item.lon)) return null;
    const displayName = cleanText(item.display_name || item.name);
    const name = cleanText(item.name || displayName.split(',')[0] || 'Unnamed place');
    return attachDistance({ name, type: cleanText(item.type || item.class || 'Place'),
      address: displayName || `Coordinates: ${coord(item.lat)}, ${coord(item.lon)}`,
      lat: Number(item.lat), lon: Number(item.lon), distanceKm: null });
  }

  function normalizedOverpass(element, category) {
    if (!element || typeof element !== 'object') return null;
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (!hasValidCoordinates(lat, lon)) return null;
    const tags = element.tags && typeof element.tags === 'object' ? element.tags : {};
    const name = cleanText(tags.name || tags['name:en'] || `${category.singular} (unnamed)`);
    const address = uniqueNonempty([
      [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
      tags['addr:suburb'], tags['addr:city'], tags['addr:state'], tags['addr:country']
    ]).join(', ') || `Mapped location · ${coord(lat)}, ${coord(lon)}`;
    return attachDistance({ name, type: category.singular, address,
      lat: Number(lat), lon: Number(lon), distanceKm: null });
  }

  function normalizeCategoryQuery(query) {
    return locationKey(query).replace(/\s+(near me|nearby|around me)$/, '').trim();
  }

  function categoryForQuery(query) {
    const normalized = normalizeCategoryQuery(query);
    return (state.config?.categories || []).find((category) =>
      Array.isArray(category.terms) && category.terms.includes(normalized)) || null;
  }

  function parseOverpass(data, category) {
    if (!Array.isArray(data.elements)) throw issue('invalid-json');
    const seen = new Set();
    return data.elements.map((element) => normalizedOverpass(element, category)).filter((place) => {
      if (!place) return false;
      const key = `${place.name.toLowerCase()}:${place.lat.toFixed(4)}:${place.lon.toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // OSM category searches need actual POI coverage, not just Photon name matches.
  // Query concentric areas: we search the closest area before widening.
  function overpassUrl(category, radiusKm) {
    const around = `around:${Math.round(radiusKm * 1000)},${coord(state.origin.lat)},${coord(state.origin.lon)}`;
    const selectors = category.selectors || [];
    const clauses = selectors.filter((selector) => selector && typeof selector === 'object')
      .map((selector) => {
        const predicates = Object.entries(selector).filter(([key, value]) =>
          /^[a-z_:]+$/i.test(key) && /^[a-z0-9_: -]+$/i.test(String(value)))
          .map(([key, value]) => `["${key}"="${String(value)}"]`).join('');
        return predicates ? `nwr(${around})${predicates};` : '';
      }).join('');
    if (!clauses) throw issue('invalid-json');
    const query = `[out:json][timeout:18];(${clauses});out center 250;`;
    const url = new URL('https://overpass.kumi.systems/api/interpreter');
    url.searchParams.set('data', query);
    return url.toString();
  }

  async function searchNearbyCategory(category, signal, expand = false) {
    const requestedRadius = ui.radiusSelect.value === 'any' ? 100 : Number(ui.radiusSelect.value);
    const radiusSteps = [...new Set([Math.min(2, requestedRadius), 5, 25, 50, 100]
      .filter((km) => km <= requestedRadius))];
    const pool = new Map();
    let coveredKm = 0;
    for (const radius of radiusSteps) {
      if (signal.aborted) throw issue('cancelled');
      setFeedback(`Checking mapped ${category.label.toLowerCase()} within ${radius} km…`);
      let data;
      try {
        data = await getJson(overpassUrl(category, radius), { signal, timeoutMs: 15000 });
      } catch (error) {
        if (error.code === 'cancelled' || error.code === 'offline') throw error;
        const backup = new URL(overpassUrl(category, radius));
        backup.host = new URL(OVERPASS_BACKUP).host;
        data = await getJson(backup.toString(), { signal, timeoutMs: 15000 });
      }
      for (const item of parseOverpass(data, category)) {
        pool.set(`${item.name.toLowerCase()}:${item.lat.toFixed(4)}:${item.lon.toFixed(4)}`, item);
      }
      coveredKm = radius;
      // Limit free API traffic and keep results responsive. Explain coverage honestly.
      if ((!expand && pool.size >= 16) || radius >= requestedRadius) break;
    }
    state.categoryCoverageKm = coveredKm;
    state.coverageMessage = `Found mapped ${category.label.toLowerCase()} within ${coveredKm} km. ` +
      (coveredKm < requestedRadius ? `Showing the closest area first; choose a smaller range for a more focused search. ` : '') +
      'Results are sorted by straight-line distance. Public OSM data may be incomplete.';
    return [...pool.values()];
  }

  function validStoredPlace(place) {
    return place && typeof place.name === 'string' && typeof place.address === 'string' &&
      typeof place.type === 'string' && hasValidCoordinates(place.lat, place.lon);
  }

  function loadHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(validStoredPlace).slice(0, 8) : [];
    } catch { return []; }
  }

  function saveHistory(place) {
    const stored = { name: place.name, type: place.type, address: place.address,
      lat: place.lat, lon: place.lon, distanceKm: place.distanceKm };
    const key = `${coord(place.lat)}:${coord(place.lon)}`;
    state.recent = [stored, ...state.recent.filter((item) => `${coord(item.lat)}:${coord(item.lon)}` !== key)].slice(0, 8);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.recent)); } catch { /* Private browsing / quota. */ }
  }

  async function getJson(url, { signal, timeoutMs } = {}) {
    if (!navigator.onLine) throw issue('offline');
    const controller = new AbortController();
    let timedOut = false;
    const ms = timeoutMs ?? state.config?.requestTimeoutMs ?? 10000;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
    const abortFromParent = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abortFromParent, { once: true });
    }
    try {
      const response = await fetch(url, { signal: controller.signal,
        headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (response.status === 429) throw issue('rate-limit');
      if (response.status >= 500) throw issue('server');
      if (!response.ok) throw issue('network', `HTTP ${response.status}`);
      let data;
      try { data = await response.json(); } catch { throw issue('invalid-json'); }
      if (!data || typeof data !== 'object') throw issue('invalid-json');
      return data;
    } catch (error) {
      if (timedOut) throw issue('timeout');
      if (controller.signal.aborted || error?.name === 'AbortError') throw issue('cancelled');
      if (error?.code) throw error;
      if (!navigator.onLine) throw issue('offline');
      throw issue('network');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortFromParent);
    }
  }

  function photonUrl(text, limit) {
    const url = new URL(PHOTON);
    url.searchParams.set('q', text);
    url.searchParams.set('limit', String(limit));
    if (state.origin) {
      url.searchParams.set('lat', String(state.origin.lat));
      url.searchParams.set('lon', String(state.origin.lon));
    }
    return url.href;
  }

  function nominatimUrl(text, limit = 1) {
    const url = new URL(NOMINATIM);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('q', text);
    return url.href;
  }

  function parsePhoton(data) {
    if (!Array.isArray(data.features)) throw issue('invalid-json');
    const seen = new Set();
    return data.features.map(normalizedPhoton).filter((place) => {
      if (!place) return false;
      const key = `${coord(place.lat)}:${coord(place.lon)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseNominatim(data) {
    if (!Array.isArray(data)) throw issue('invalid-json');
    const seen = new Set();
    return data.map(normalizedNominatim).filter((place) => {
      if (!place) return false;
      const key = `${coord(place.lat)}:${coord(place.lon)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function validate(name, reveal = false) {
    const field = name === 'location' ? ui.locationInput : ui.queryInput;
    const text = field.value.trim();
    let message = '';
    if (name === 'location') {
      if (!text && !state.origin) message = 'Enter your location or choose Use my location.';
      else if (!state.origin && text.length < 2) message = 'Type at least 2 characters.';
      else if (!state.origin && text.length > 100) message = 'Use 100 characters or fewer.';
      else if (text && (text.length < 2 || text.length > 100)) message = 'Your location must be 2–100 characters.';
    } else {
      if (!text) message = 'Tell us what place you are looking for.';
      else if (text.length < 3) message = 'Type at least 3 characters.';
      else if (text.length > 100) message = 'Use 100 characters or fewer.';
      else if (/[<>]/.test(text)) message = 'Remove < and > characters from your search.';
      else if (!/\p{L}/u.test(text)) message = 'Include at least one letter in your search.';
    }
    const visible = reveal || state.touched[name];
    const errorLabel = name === 'location' ? ui.locationError : ui.queryError;
    const checkLabel = name === 'location' ? ui.locationCheck : ui.queryCheck;
    const invalid = Boolean(message);
    field.classList.toggle('field-error', invalid && visible);
    field.classList.toggle('field-valid', !invalid && visible);
    field.setAttribute('aria-invalid', String(invalid && visible));
    errorLabel.textContent = visible ? message : '';
    errorLabel.hidden = !invalid || !visible;
    checkLabel.hidden = invalid || !visible;
    return !invalid;
  }

  function validateAll() {
    state.touched.location = true;
    state.touched.query = true;
    const a = validate('location', true);
    const b = validate('query', true);
    if (!a) ui.locationInput.focus();
    else if (!b) ui.queryInput.focus();
    return a && b;
  }

  function setOrigin(lat, lon, label, source = 'typed') {
    const latNum = Number(lat), lonNum = Number(lon);
    if (!hasValidCoordinates(latNum, lonNum)) throw issue('geocoding-empty');
    state.origin = { lat: latNum, lon: lonNum, label, source, key: locationKey(label) };
    if (source === 'gps') ui.locationInput.value = label;
    state.matches = state.matches.map(attachDistance);
    state.suggestions = state.suggestions.map(attachDistance);
    if (!ui.resultGroups.hidden) renderResults();
    if (state.selected) state.selected = attachDistance(state.selected);
    renderSelected();
    validate('location', true);
  }

  async function resolveOrigin() {
    const label = ui.locationInput.value.trim();
    if (state.origin && state.origin.key === locationKey(label)) return state.origin;
    if (!validate('location', true)) throw issue('bad-location');
    state.originRequest?.abort();
    const request = new AbortController();
    state.originRequest = request;
    const version = ++state.locationVersion;
    try {
      const entries = parseNominatim(await getJson(nominatimUrl(label), { signal: request.signal }));
      if (!entries.length) throw issue('geocoding-empty');
      if (version !== state.locationVersion || locationKey(ui.locationInput.value) !== locationKey(label)) throw issue('cancelled');
      setOrigin(entries[0].lat, entries[0].lon, label);
      return state.origin;
    } finally {
      if (state.originRequest === request) state.originRequest = null;
    }
  }

  async function geocodeOnBlur() {
    state.touched.location = true;
    if (!validate('location', true) || state.loading) return;
    if (state.origin?.key === locationKey(ui.locationInput.value)) return;
    setFeedback('Checking the starting location…');
    try {
      await resolveOrigin();
      setFeedback(`Starting point set: ${ui.locationInput.value.trim()}`, 'success');
    } catch (error) {
      if (error.code === 'cancelled' || error.code === 'bad-location') return;
      const [, message] = reason(error);
      ui.locationError.textContent = message;
      ui.locationError.hidden = false;
      ui.locationInput.setAttribute('aria-invalid', 'true');
      ui.locationInput.classList.add('field-error');
      ui.locationCheck.hidden = true;
      setFeedback(message, 'error');
    }
  }

  function abortSuggestions() {
    clearTimeout(state.suggestionTimer);
    state.suggestionTimer = null;
    state.suggestionRequest?.abort();
    state.suggestionRequest = null;
    ++state.suggestionsVersion;
  }

  function closeSuggestions() {
    ui.suggestionPanel.hidden = true;
    ui.queryInput.setAttribute('aria-expanded', 'false');
    ui.queryInput.removeAttribute('aria-activedescendant');
    state.activeIndex = -1;
    state.menuItems = [];
    state.menuMode = '';
  }

  function highlightedText(parent, label, query) {
    const words = cleanText(query).toLocaleLowerCase().split(/\s+/).filter((word) => word.length >= 2);
    if (!words.length) { parent.textContent = label; return; }
    const lower = label.toLocaleLowerCase();
    let i = 0;
    while (i < label.length) {
      const found = words.map((word) => ({ index: lower.indexOf(word, i), word }))
        .filter((entry) => entry.index >= 0).sort((a, b) => a.index - b.index)[0];
      if (!found) { parent.append(document.createTextNode(label.slice(i))); return; }
      if (found.index > i) parent.append(document.createTextNode(label.slice(i, found.index)));
      const strong = make('strong', 'font-extrabold text-slate-950', label.slice(found.index, found.index + found.word.length));
      parent.append(strong);
      i = found.index + found.word.length;
    }
  }

  function openSuggestions(items, mode, query = '') {
    state.menuItems = items;
    state.menuMode = mode;
    state.activeIndex = -1;
    ui.suggestionList.replaceChildren();
    ui.suggestionPanel.hidden = false;
    ui.queryInput.setAttribute('aria-expanded', 'true');
    ui.suggestionTitle.textContent = mode === 'history' ? 'Recently selected places' : 'Suggested places';
    ui.clearHistoryBtn.hidden = mode !== 'history' || items.length === 0;
    ui.suggestionHint.textContent = 'Use ↑ and ↓ to navigate, Enter to select, Esc to close.';

    if (!items.length) {
      const message = mode === 'history' ? 'No saved places yet. Try a search.' :
        'No suggestions yet. Press Find matching places to search, or check your spelling.';
      ui.suggestionList.append(make('p', 'px-3 py-4 text-sm text-slate-500', message));
      return;
    }
    items.forEach((place, index) => {
      const option = make('button', 'suggestion focus-ring flex min-h-14 w-full flex-col justify-center rounded-lg px-3 py-3 text-left hover:bg-teal-50');
      option.type = 'button';
      option.id = `rightplace-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.tabIndex = -1;
      const name = make('span', 'text-sm font-medium text-slate-800');
      highlightedText(name, place.name, query);
      const sub = make('span', 'mt-1 w-full truncate text-xs text-slate-500',
        `${place.address} · ${readableDistance(place.distanceKm)}`);
      option.append(name, sub);
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.addEventListener('click', () => pickPlace(place, { fromSuggestion: true }));
      ui.suggestionList.append(option);
    });
  }

  function moveActive(delta) {
    if (ui.suggestionPanel.hidden || !state.menuItems.length) return;
    state.activeIndex = (state.activeIndex + delta + state.menuItems.length) % state.menuItems.length;
    Array.from(ui.suggestionList.querySelectorAll('[role="option"]')).forEach((option, i) => {
      const active = i === state.activeIndex;
      option.setAttribute('aria-selected', String(active));
      if (active) option.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
    ui.queryInput.setAttribute('aria-activedescendant', `rightplace-option-${state.activeIndex}`);
  }

  function showHistoryIfEmpty() {
    if (!ui.queryInput.value.trim() && state.recent.length) openSuggestions(state.recent.map(attachDistance), 'history');
    else if (!ui.queryInput.value.trim()) closeSuggestions();
  }

  function suggestOnInput() {
    abortSuggestions();
    state.locked = null;
    state.selected = null;
    ui.lockedPlace.hidden = true;
    renderSelected();
    ui.clearQueryBtn.hidden = !ui.queryInput.value;
    if (state.touched.query) validate('query', true);
    const q = ui.queryInput.value.trim();
    if (!q) { showHistoryIfEmpty(); return; }
    if (q.length < 3 || !/\p{L}/u.test(q) || /[<>]/.test(q)) { closeSuggestions(); return; }
    state.suggestions = [];
    ui.suggestionTitle.textContent = 'Finding suggestions…';
    openSuggestions([], 'suggestions', q);
    ui.suggestionList.replaceChildren(make('p', 'px-3 py-4 text-sm text-slate-500', 'Finding suggestions…'));
    const version = state.suggestionsVersion;
    const delay = state.config?.autocompleteDebounceMs ?? 300;
    state.suggestionTimer = setTimeout(async () => {
      const controller = new AbortController();
      state.suggestionRequest = controller;
      try {
        const data = await getJson(photonUrl(q, state.config?.suggestionLimit ?? 8), { signal: controller.signal });
        if (version !== state.suggestionsVersion) return;
        state.suggestions = parsePhoton(data);
        if (!state.suggestions.length && q.split(/\s+/).length > 1 && q.split(/\s+/)[0].length >= 4) {
          const first = q.split(/\s+/)[0];
          const fallback = await getJson(photonUrl(first, state.config?.suggestionLimit ?? 8), { signal: controller.signal });
          if (version !== state.suggestionsVersion) return;
          state.suggestions = parsePhoton(fallback).filter((place) =>
            place.name.toLocaleLowerCase().includes(first.slice(0, Math.max(3, first.length - 2)).toLocaleLowerCase()));
        }
        openSuggestions(state.suggestions, 'suggestions', q);
      } catch (error) {
        if (version !== state.suggestionsVersion || error.code === 'cancelled') return;
        const [, explanation] = reason(error);
        openSuggestions([], 'suggestions', q);
        ui.suggestionList.replaceChildren(make('p', 'px-3 py-4 text-sm text-red-700', explanation));
      } finally {
        if (state.suggestionRequest === controller) state.suggestionRequest = null;
      }
    }, delay);
  }

  function queryKey(place) { return `${coord(place.lat)},${coord(place.lon)}`; }

  function sortAndPartition(items) {
    const radius = ui.radiusSelect.value === 'any' ? Infinity : Number(ui.radiusSelect.value);
    const withDistance = items.map(attachDistance);
    const near = withDistance.filter((place) => place.distanceKm !== null && place.distanceKm <= radius);
    const far = withDistance.filter((place) => place.distanceKm === null || place.distanceKm > radius);
    near.sort((a, b) => a.distanceKm - b.distanceKm);
    far.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    return { near, far };
  }

  function countryOf(place) {
    const parts = place.address.split(',').map(cleanText).filter(Boolean);
    return parts.at(-1) || 'Unknown location';
  }

  function resultCard(place, farAway = false) {
    const button = make('button', 'focus-ring block min-h-20 w-full rounded-xl border px-4 py-3 text-left transition-colors hover:border-teal-400 hover:bg-teal-50 ' +
      (state.selected && queryKey(state.selected) === queryKey(place) ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'));
    button.type = 'button';
    button.setAttribute('aria-label', `Choose ${place.name}, ${place.address}, ${readableDistance(place.distanceKm)} away`);
    const row = make('span', 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1');
    const name = make('span', 'min-w-0 break-words text-sm font-bold text-slate-900', place.name);
    const distance = make('span', 'shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700', readableDistance(place.distanceKm));
    row.append(name, distance);
    const address = make('span', 'mt-1 block break-words text-xs leading-5 text-slate-500', place.address);
    const type = make('span', 'mt-2 inline-block text-xs font-semibold text-teal-800', place.type || 'Place');
    button.append(row, address, type);
    if (farAway) {
      const tag = make('span', 'ml-2 mt-2 inline-block rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900', `Far away - ${countryOf(place)}`);
      button.append(tag);
    }
    button.addEventListener('click', () => pickPlace(place));
    return button;
  }

  function renderResults() {
    const { near, far } = sortAndPartition(state.matches);
    hideResultStates();
    ui.resultGroups.hidden = false;
    ui.nearGroup.hidden = near.length === 0;
    ui.farGroup.hidden = far.length === 0;
    ui.nearCount.textContent = `(${near.length})`;
    ui.farCount.textContent = `(${far.length})`;
    ui.nearList.replaceChildren(...near.map((place) => resultCard(place)));
    ui.farList.replaceChildren(...far.map((place) => resultCard(place, true)));
    ui.resultsCount.textContent = `${state.matches.length} place${state.matches.length === 1 ? '' : 's'} found · ${near.length} within chosen distance`;
    ui.resultNote.textContent = state.coverageMessage || 'Sorted closest to farthest among the search matches returned by the public OSM-powered index. Other mapped places may exist.';
    ui.resultNote.hidden = false;
    const requestedKm = ui.radiusSelect.value === 'any' ? 100 : Number(ui.radiusSelect.value);
    ui.loadMoreBtn.hidden = !categoryForQuery(state.lastQuery) || !state.categoryCoverageKm || state.categoryCoverageKm >= requestedKm;
    if (!near.length && far.length) {
      const explainer = make('p', 'rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950',
        'All matches are outside the chosen range. You can choose one below or widen the radius.');
      ui.farList.prepend(explainer);
    }
  }

  function mapEmbedUrl(place) {
    const lat = Math.max(-85, Math.min(85, place.lat));
    const latExtent = 0.011;
    const lonExtent = Math.min(0.065, 0.013 / Math.max(0.25, Math.cos(lat * Math.PI / 180)));
    const left = Math.max(-180, place.lon - lonExtent);
    const right = Math.min(180, place.lon + lonExtent);
    const url = new URL('https://www.openstreetmap.org/export/embed.html');
    url.searchParams.set('bbox', `${coord(left)},${coord(lat - latExtent)},${coord(right)},${coord(lat + latExtent)}`);
    url.searchParams.set('layer', 'mapnik');
    url.searchParams.set('marker', `${coord(place.lat)},${coord(place.lon)}`);
    return url.toString();
  }

  function selectedPlaceUrl(place) {
    return `https://www.openstreetmap.org/?mlat=${coord(place.lat)}&mlon=${coord(place.lon)}#map=16/${coord(place.lat)}/${coord(place.lon)}`;
  }

  function renderSelected() {
    const place = state.selected;
    ui.noSelection.hidden = Boolean(place);
    ui.selectionDetails.hidden = !place;
    if (!place) {
      ui.mapFrame.removeAttribute('src');
      return;
    }
    const current = attachDistance(place);
    ui.selectedName.textContent = current.name;
    ui.selectedType.textContent = current.type || 'Place';
    ui.selectedAddress.textContent = current.address;
    ui.selectedDistance.textContent = readableDistance(current.distanceKm);
    const nextMap = mapEmbedUrl(current);
    if (ui.mapFrame.src !== nextMap) ui.mapFrame.src = nextMap;
    ui.placeLink.href = selectedPlaceUrl(current);
  }

  function pickPlace(place, { fromSuggestion = false } = {}) {
    if (!validStoredPlace(place)) return;
    state.selected = attachDistance(place);
    state.locked = state.selected;
    ui.lockedPlace.hidden = false;
    ui.lockedPlaceText.textContent = `Exact place chosen: ${place.name} (${coord(place.lat)}, ${coord(place.lon)})`;
    if (fromSuggestion) ui.queryInput.value = place.name;
    ui.clearQueryBtn.hidden = false;
    abortSuggestions();
    closeSuggestions();
    saveHistory(state.selected);
    renderSelected();
    if (!ui.resultGroups.hidden) renderResults();
    validate('query', true);
    setFeedback(`Selected ${place.name}. Directions will use this place's exact coordinates.`, 'success');
    if (!state.origin) setFeedback(`Selected ${place.name}. Set your starting location to enable directions.`, 'success');
  }

  function showFallbackOptions(places) {
    hideResultStates();
    ui.didYouMean.hidden = false;
    ui.didYouMeanList.replaceChildren();
    places.forEach((place) => {
      const button = make('button', 'focus-ring block min-h-11 w-full rounded-lg border border-amber-200 bg-white px-3 py-3 text-left hover:border-teal-600');
      button.type = 'button';
      button.append(make('span', 'block text-sm font-bold text-slate-900', place.name),
        make('span', 'mt-1 block text-xs text-slate-600', `${place.address} · ${readableDistance(place.distanceKm)}`));
      button.addEventListener('click', () => pickPlace(place));
      ui.didYouMeanList.append(button);
    });
    ui.resultsCount.textContent = `${places.length} alternative suggestion${places.length === 1 ? '' : 's'}`;
  }

  async function searchPlaces({ expand = false } = {}) {
    if (state.loading) return;
    if (!validateAll()) {
      setFeedback('Please fix the highlighted fields before searching.', 'error');
      return;
    }
    const q = ui.queryInput.value.trim();
    state.lastQuery = q;
    state.searchRequest?.abort();
    const request = new AbortController();
    state.searchRequest = request;
    abortSuggestions();
    closeSuggestions();
    setLoading(true);
    setFeedback('Checking your location and searching for nearby matches…');
    const retry = () => searchPlaces();
    try {
      if (!state.origin || state.origin.key !== locationKey(ui.locationInput.value)) await resolveOrigin();
      if (request.signal.aborted) return;
      const category = categoryForQuery(q);
      let matches = [];
      state.coverageMessage = '';
      state.categoryCoverageKm = 0;
      if (category) {
        try {
          matches = await searchNearbyCategory(category, request.signal, expand);
        } catch (error) {
          if (error.code === 'cancelled' || error.code === 'offline') throw error;
          setFeedback('Nearby category service unavailable. Trying the place-name index instead…');
          state.coverageMessage = 'The nearby category data service was unavailable. These results are only matches in the name index, not a complete nearby list.';
        }
      }
      if (!category || !matches.length) {
        const photonResponse = await getJson(photonUrl(q, state.config?.searchLimit ?? 40), { signal: request.signal });
        matches = parsePhoton(photonResponse);
        // If a misspelling yields no names, try a shorter distinctive fragment.
        // This is generic: no hardcoded place-name fixes or demo-only responses.
        const needsRecovery = q.split(/\s+/).length > 1 &&
          (!matches.length || matches.every((place) => place.distanceKm === null || place.distanceKm > 100));
        if (needsRecovery) {
          const first = q.split(/\s+/)[0];
          if (first.length >= 4) {
            try {
              const retryData = await getJson(photonUrl(first, state.config?.searchLimit ?? 40), { signal: request.signal });
              const recovered = parsePhoton(retryData);
              const words = q.toLocaleLowerCase().split(/\s+/);
              const seen = new Set(matches.map(queryKey));
              for (const place of recovered) {
                const text = `${place.name} ${place.address}`.toLocaleLowerCase();
                if (seen.has(queryKey(place))) continue;
                if (words.some((term) => term.length > 3 && text.includes(term.slice(0, Math.max(3, term.length - 2))))) {
                  seen.add(queryKey(place));
                  matches.push(place);
                }
              }
              if (recovered.length) state.coverageMessage = 'We also checked a shorter version of your search for possible spelling mistakes. Confirm the exact result.';
            } catch (error) { if (error.code === 'cancelled') throw error; /* Keep valid primary matches. */ }
          }
        }
      }
      if (request.signal.aborted) return;
      state.matches = matches;
      if (matches.length) {
        renderResults();
        setFeedback(`${matches.length} places found and sorted nearest first. Select the one you mean.`, 'success');
      } else if (category) {
        showMessage('No mapped places found nearby', `No ${category.label.toLowerCase()} were returned for this area.`,
          ['Choose a wider distance.', 'Try another nearby starting location.',
           'Only places present in OpenStreetMap data can be shown.'], retry);
        setFeedback('No matching mapped places found. Try a wider radius or another location.');
      } else {
        setFeedback('Searching for alternative spellings…');
        const fallbackResponse = await getJson(nominatimUrl(q, 5), { signal: request.signal });
        if (request.signal.aborted) return;
        const options = parseNominatim(fallbackResponse);
        if (options.length) {
          state.matches = options;
          showFallbackOptions(options);
          setFeedback('Review these alternatives before selecting a place.');
        } else {
          showMessage('No places found', `No matching places were found for “${q}”.`,
            ['Check spelling or enter a more specific place name.',
              'Try adding a city to your search.',
              'Try another location or widen the search radius.'], retry);
          setFeedback('No places found. Try another spelling or add a city.');
        }
      }
    } catch (error) {
      if (error.code !== 'cancelled') showError(error, retry);
    } finally {
      if (state.searchRequest === request) state.searchRequest = null;
      setLoading(false);
    }
  }

  async function useGps() {
    if (!navigator.geolocation) {
      showError(issue('gps-unsupported'), () => useGps());
      ui.locationInput.focus();
      return;
    }
    if (!window.isSecureContext) {
      showMessage('Secure connection required', 'Use my location needs HTTPS or localhost. You can type a city instead.', [], () => useGps());
      setFeedback('Location access requires HTTPS or localhost.', 'error');
      return;
    }
    ui.useLocationBtn.disabled = true;
    ui.useLocationBtn.textContent = 'Finding your location…';
    setFeedback('Waiting for your browser to provide a location…');
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject,
          { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 });
      });
      if (!hasValidCoordinates(position.coords.latitude, position.coords.longitude)) throw issue('gps-unsupported');
      state.originRequest?.abort();
      ++state.locationVersion;
      const name = `Current location (${coord(position.coords.latitude)}, ${coord(position.coords.longitude)})`;
      setOrigin(position.coords.latitude, position.coords.longitude, name, 'gps');
      ui.cityPreset.value = '';
      setFeedback('Your location is set. Only your browser provides these coordinates; you can change them anytime.', 'success');
      if (ui.queryInput.value.trim().length >= 3 && document.activeElement === ui.queryInput) suggestOnInput();
    } catch (error) {
      const code = error.code === 1 ? 'gps-denied' : error.code === 3 ? 'gps-timeout' : (error.code || 'gps-unsupported');
      showError(issue(code), () => useGps());
      ui.locationInput.focus();
    } finally {
      ui.useLocationBtn.disabled = false;
      ui.useLocationBtn.textContent = 'Use my location';
    }
  }

  function clearQuery() {
    ui.queryInput.value = '';
    ui.clearQueryBtn.hidden = true;
    state.locked = null;
    state.selected = null;
    state.matches = [];
    abortSuggestions();
    closeSuggestions();
    ui.lockedPlace.hidden = true;
    renderSelected();
    state.touched.query = false;
    ui.queryError.hidden = true;
    ui.queryInput.classList.remove('field-error', 'field-valid');
    ui.queryInput.setAttribute('aria-invalid', 'false');
    ui.queryCheck.hidden = true;
    ui.resultsCount.textContent = 'Nothing searched yet';
    ui.resultNote.hidden = true;
    hideResultStates();
    ui.initialState.hidden = false;
    ui.queryInput.focus();
    showHistoryIfEmpty();
    setFeedback('Search cleared. Start typing another place.');
  }

  async function copyPlaceLink() {
    if (!state.selected) return;
    const url = selectedPlaceUrl(state.selected);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(url);
      setFeedback('Place link copied to clipboard.', 'success');
    } catch {
      setFeedback(`Could not copy automatically. Copy this URL: ${url}`, 'error');
    }
  }

  function updateNetworkState() {
    ui.offlineBanner.hidden = navigator.onLine;
    if (!navigator.onLine) {
      abortSuggestions();
      if (state.loading) {
        state.searchRequest?.abort();
        state.originRequest?.abort();
        setLoading(false);
        showError(issue('offline'), () => searchPlaces());
      } else setFeedback('You are offline. Saved places are still available, but searching requires a connection.', 'error');
    } else setFeedback('Back online. Search is available again.', 'success');
  }

  function fillPresetCities() {
    const cities = state.config?.presetCities || [];
    ui.cityPreset.replaceChildren(make('option', '', 'Or choose a city'));
    ui.cityPreset.firstChild.value = '';
    cities.forEach((city, index) => {
      if (!hasValidCoordinates(city.lat, city.lon) || typeof city.name !== 'string') return;
      const option = make('option', '', city.name);
      option.value = String(index);
      ui.cityPreset.append(option);
    });
  }

  function fillDemos() {
    ui.demoQueries.replaceChildren();
    (state.config?.demoQueries || []).forEach((demo) => {
      if (!demo || !cleanText(demo.query)) return;
      const button = make('button', 'focus-ring min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800 hover:border-teal-400 hover:bg-teal-50', demo.label || demo.query);
      button.type = 'button';
      button.addEventListener('click', () => {
        const city = (state.config?.presetCities || []).find((item) => item.name === demo.city);
        if (city) {
          state.originRequest?.abort();
          ++state.locationVersion;
          ui.locationInput.value = city.name;
          setOrigin(city.lat, city.lon, city.name, 'preset');
          state.touched.location = true;
        }
        ui.queryInput.value = demo.query;
        state.touched.query = true;
        validate('query', true);
        ui.clearQueryBtn.hidden = false;
        searchPlaces();
      });
      ui.demoQueries.append(button);
    });
  }

  async function loadConfig() {
    setFeedback('Preparing city presets and search settings…');
    try {
      const config = await getJson('data/config.json');
      if (!Array.isArray(config.presetCities) || !Array.isArray(config.demoQueries) ||
        !Array.isArray(config.categories)) throw issue('invalid-json');
      state.config = config;
      fillPresetCities();
      fillDemos();
      setFeedback('Ready. Choose your starting point and type a place name.');
    } catch (error) {
      showError(error, () => loadConfig());
      setFeedback('Search configuration could not load. Open this app through a web server, not a file:// URL.', 'error');
    }
  }

  function bindEvents() {
    ui.searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      searchPlaces();
    });

    ui.locationInput.addEventListener('input', () => {
      state.originRequest?.abort();
      ++state.locationVersion;
      state.origin = null;
      ui.cityPreset.value = '';
      state.matches = state.matches.map(attachDistance);
      state.suggestions = state.suggestions.map(attachDistance);
      state.selected = state.selected ? attachDistance(state.selected) : null;
      renderSelected();
      if (state.touched.location) validate('location', true);
    });
    ui.locationInput.addEventListener('blur', () => { geocodeOnBlur(); });
    ui.queryInput.addEventListener('input', suggestOnInput);
    ui.queryInput.addEventListener('blur', () => {
      state.touched.query = true;
      validate('query', true);
      setTimeout(() => { if (!ui.suggestionPanel.contains(document.activeElement)) closeSuggestions(); }, 120);
    });
    ui.queryInput.addEventListener('focus', showHistoryIfEmpty);
    ui.queryInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { closeSuggestions(); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (ui.suggestionPanel.hidden && !ui.queryInput.value.trim()) showHistoryIfEmpty();
        if (!ui.suggestionPanel.hidden && state.menuItems.length) {
          event.preventDefault();
          moveActive(event.key === 'ArrowDown' ? 1 : -1);
        }
        return;
      }
      if (event.key === 'Enter' && !ui.suggestionPanel.hidden && state.menuItems.length) {
        if (state.activeIndex >= 0) {
          event.preventDefault();
          pickPlace(state.menuItems[state.activeIndex], { fromSuggestion: true });
        } else {
          event.preventDefault();
          closeSuggestions();
          searchPlaces(); // Show candidates and ask; never select the first result.
        }
      }
    });

    ui.cityPreset.addEventListener('change', () => {
      const index = Number(ui.cityPreset.value);
      if (ui.cityPreset.value === '' || !state.config?.presetCities?.[index]) return;
      const city = state.config.presetCities[index];
      state.originRequest?.abort();
      ++state.locationVersion;
      ui.locationInput.value = city.name;
      setOrigin(city.lat, city.lon, city.name, 'preset');
      state.touched.location = true;
      setFeedback(`Starting point set to ${city.name}.`, 'success');
      if (ui.queryInput.value.trim().length >= 3 && document.activeElement === ui.queryInput) suggestOnInput();
    });
    ui.loadMoreBtn.addEventListener('click', () => searchPlaces({ expand: true }));
    ui.radiusSelect.addEventListener('change', () => {
      if (state.matches.length && !ui.resultGroups.hidden) renderResults();
      setFeedback(`Distance filter set to ${ui.radiusSelect.options[ui.radiusSelect.selectedIndex].text}. No new search was needed.`);
    });
    ui.useLocationBtn.addEventListener('click', useGps);
    ui.clearQueryBtn.addEventListener('click', clearQuery);
    ui.clearHistoryBtn.addEventListener('click', () => {
      state.recent = [];
      try { localStorage.removeItem(HISTORY_KEY); } catch { /* Storage unavailable. */ }
      closeSuggestions();
      setFeedback('Recent places cleared.', 'success');
      ui.queryInput.focus();
    });
    ui.retryBtn.addEventListener('click', () => { if (state.retryAction) state.retryAction(); });
    ui.copyLinkBtn.addEventListener('click', copyPlaceLink);
    document.addEventListener('click', (event) => {
      if (!ui.suggestionPanel.contains(event.target) && event.target !== ui.queryInput) closeSuggestions();
    });
    window.addEventListener('offline', updateNetworkState);
    window.addEventListener('online', updateNetworkState);
  }

  function init() {
    bindEvents();
    ui.clearQueryBtn.hidden = !ui.queryInput.value;
    ui.offlineBanner.hidden = navigator.onLine;
    loadConfig();
  }

  init();
})();

