# RightPlace

A responsive, single-page OpenStreetMap-powered search companion. The primary page addresses exactly three user difficulties:

1. **Spelling errors:** Photon fuzzy search and generic partial-query recovery help find intended place names despite typing mistakes.
2. **Missing suggestions:** live, debounced autocomplete previews OSM-derived places while typing; keyboard users can use arrow keys, Enter, and Escape.
3. **Poor proximity ordering:** every returned match is ranked by Haversine distance from the chosen starting location. Nearby categories such as `church`, `pharmacy`, or `ATM` query actual OSM points of interest using Overpass. More distant matches are also distance-sorted. Users explicitly choose their result.

This is **not an official OpenStreetMap product** and does not claim to replace OpenStreetMap. The two additional pages (`explore.html` and `saved.html`) deliberately display **Coming soon**, with working navigation back to the search page.

## Stack

- HTML5 + Tailwind CSS loaded from `https://cdn.tailwindcss.com`.
- Vanilla ES2020+ JavaScript: no framework or build tooling.
- HTML5 OSM iframe for the selected destination preview.
- Photon (OSM-derived place-name suggestions and fuzzy search).
- Nominatim (starting-location geocoding on blur/submit only, not autocomplete).
- Overpass API (mapped local category search). A backup public Overpass endpoint is attempted if the first fails.
- Haversine distance calculation and JSON parsing in the browser.

## Run locally

Do not double-click `index.html`: local `file://` URLs may block Fetch of `data/config.json`.

```sh
cd rightplace
python -m http.server 8000
```

Open <http://localhost:8000/>.

The `Use my location` browser API needs **localhost or HTTPS** and user permission. External API calls require an internet connection. The Tailwind CDN script also requires an internet connection.

## Live testing checklist

- Choose **Bengaluru**, enter `church`, submit. Returned mapped churches should be presented closest first, with a distance on each result.
- Choose **Hyderabad**, enter `pharmacy`, submit. Search uses OSM category tags and distance ranking; results vary based on contributed geographic data.
- Choose **Paris**, enter `eiffel towr`. Suggestions are queried from Photon; if the full query returns nothing, the app attempts a shorter generic query. Public data quality varies.
- Choose **Rome**, enter `coloseum rome` and inspect candidates.
- Search for a common name present in multiple cities, e.g. `forum mall` in **Bengaluru**, and confirm near matches appear before distant matches among the results returned by the name index.
- Try submitting an empty field, `ab`, and `<b>` to verify inline validation.
- Try keyboard navigation (`Tab`, `ArrowDown`, `ArrowUp`, `Enter`, `Escape`).
- Open the site at mobile and desktop widths. The placeholder pages should also open and provide navigation back.
- Try clearing the query, pressing Retry on a network error, and checking recent selections while the search field is empty.

## Automated browser regression tests

The included `tests/test_rightplace.py` runs Chromium through Playwright with **mocked** Photon, Nominatim and Overpass responses, avoiding live external requests. It covers misspelled names, exact place selection, sorting in multiple countries, nearest-first categories, expanded radius, keyboard behavior, validation, 429/invalid-JSON/offline error states, and multiple viewport widths.

```sh
pip install playwright
python -m playwright install chromium
python tests/test_rightplace.py
```

Latest result in the build environment: **21/21 tests passed** using mocked API responses.

**Important verification limit:** The build environment did not permit direct access to public internet services from the browser or Python runtime. The API integration follows official documented response shapes, but **live Photon/Nominatim/Overpass responses and live Tailwind CDN visual rendering could not be independently verified here**. Run the live-testing checklist after hosting the app on an internet-connected machine. Tests at 360/768/1440px checked functional rendering with mock responses, not the externally loaded Tailwind CSS output.

## Data accuracy, completeness, and public-API limits

- Distances are **straight-line estimates**, not walking or driving distances.
- Place-name results are ranked over the **matches returned** by the Photon public service, not necessarily every matching OSM object worldwide. The UI makes this limitation explicit.
- Category searches inspect local OSM features using progressive search radii; when enough results are found nearby, the app limits requests for responsiveness. The user can request a larger area. The results are not a claim of exhaustive coverage.
- OSM mapping coverage is contributed by volunteers and can be incomplete or outdated. Public services may be slow, unavailable, or rate-limited; this app deliberately reports those states.
- The app sends search terms and the selected/permission-granted location to its external providers. No accounts or server-side storage are used. Recent selections are stored only in the current browser's localStorage, with a clear-history option.
- Respect the usage policies of Photon, Nominatim, OSM embed tiles, and Overpass. This demo is intended for limited coursework usage rather than large-scale commercial traffic.

## Deployment

This is a static project. Publish the repository root as a static website on **GitHub Pages**, **Netlify**, **Cloudflare Pages**, or an equivalent static hosting provider. No build command or backend is necessary. Use HTTPS for geolocation.

Map © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Data is from OpenStreetMap via Photon, Nominatim and Overpass.
