# Skiptrace Portal

Flask web app that aggregates **free** skip-trace sites: scrapes them in
parallel, normalizes the results across sources, and enriches with free APIs
that don't require keys (libphonenumber + US Census Geocoder).

Sites covered out of the box:

| Source            | Search by      |
| ----------------- | -------------- |
| TruePeopleSearch  | name / address / phone |
| FastPeopleSearch  | name / address / phone |
| ThatsThem         | name / address / phone / email |
| USPhoneBook       | name / phone   |

When a site blocks the request (Cloudflare, captcha, rate limit), that source
is marked `blocked` in the per-source panel and a one-click search URL is
shown so you can open the site in a real browser instead.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000.

`cloudscraper` (in `requirements.txt`) handles most Cloudflare IUAM challenges
without a real browser; without it the app still runs but TruePeopleSearch and
FastPeopleSearch will frequently come back `blocked`.

## Configuration

| Env var               | Default | Notes                                                  |
| --------------------- | ------- | ------------------------------------------------------ |
| `SKIPTRACE_PROVIDER`  | `live`  | Set to `mock` to disable scraping (offline test mode). |
| `SKIPTRACE_SOURCES`   | (all)   | Comma-list, e.g. `truepeoplesearch,thatsthem`.         |

Per-domain rate limits live in each scraper class (`min_interval`, default
6–8 s). They're enforced in-process; **don't run multiple workers against the
same hosts in parallel.**

## Use it responsibly

These sites' Terms of Service prohibit scraping. Reasonable, low-volume use
for legitimate skip-tracing rarely draws attention, but understand the risks:

- **ToS** — every site bans automated access. They can ban your IP.
- **Reliability** — selectors break when sites redesign. Each scraper is
  isolated and easy to update; check `scrapers/<name>.py:parse()`.
- **Legal** — skip-trace data is regulated. Confirm permissible purpose under
  FCRA, GLBA, DPPA, and TCPA before contacting anyone the tool returns.
- **Scaling** — for batch volume, switch to a paid provider with a real API
  (BatchSkipTracing, REIskip, IDI). Replace `_live_lookup` in `providers.py`
  with the API call and keep the rest of the pipeline.

## Architecture

```
app.py             Flask routes, SQLite history, CSV export
providers.py       lookup() — runs scrapers concurrently + merges + enriches
enrichers.py       libphonenumber + US Census Geocoder (both free, no key)
scrapers/
  base.py          BaseScraper: HTTP session (cloudscraper if available),
                   per-domain rate limit, SQLite-backed response cache,
                   captcha/interstitial detection
  truepeoplesearch.py
  fastpeoplesearch.py
  thatsthem.py
  usphonebook.py
templates/         Jinja UI
static/            Vanilla JS + CSS
instance/          SQLite DBs (skiptrace.db = history, scrape_cache.db = HTML cache)
```

## Adding a new source

1. Drop a new file in `scrapers/`, subclass `BaseScraper`, set
   `name`/`label`/`domain`/`min_interval`, implement `build_url(query)` and
   `parse(soup, url) -> list[Person]`.
2. Register it in `scrapers/__init__.py:ALL`.
3. That's it — it picks up rate limiting, caching, block detection,
   aggregation, UI rendering, and history automatically.

## API

| Method | Path                    | Notes |
| ------ | ----------------------- | ----- |
| GET    | `/`                     | Dashboard. |
| POST   | `/api/skiptrace`        | JSON `{name,address,city,state,zip,phone,email}`. |
| POST   | `/api/batch`            | `multipart/form-data` `file=@your.csv` (header row required). |
| POST   | `/api/links`            | Same body as `/api/skiptrace`; returns just the click-through URLs. |
| GET    | `/api/sources`          | Lists configured scrapers + whether cloudscraper is active. |
| GET    | `/api/history?limit=N`  | Recent searches (default 50, max 500). |
| GET    | `/api/export.csv`       | Full history as CSV. |
| DELETE | `/api/history/<id>`     | Remove a row. |

## Result shape

```json
{
  "name": "best-guess merged name",
  "phones":     [{"number": "(512) 555-1212", "sources": ["truepeoplesearch","thatsthem"]}],
  "emails":     [{"email": "...", "sources": [...]}],
  "addresses":  [{"line": "...", "sources": [...]}],
  "relatives":  [{"name": "...", "sources": [...]}],
  "detail_urls": ["https://www.truepeoplesearch.com/find/person/..."],
  "sources": [
    {"source": "truepeoplesearch", "label": "...", "url": "...",
     "status": "ok|no_results|blocked|error|skipped",
     "result_count": 3, "elapsed_ms": 812, "from_cache": false, "error": ""}
  ],
  "quick_links": [{"name": "...", "label": "...", "url": "..."}],
  "confidence": 0-99,
  "enrichment": {
    "phones":    [{"number": "...", "valid": true, "type": "mobile",
                   "carrier": "...", "location": "Austin, TX",
                   "e164": "+15125551212"}],
    "addresses": [{"line": "...", "standardized": "...", "lat": 30.27, "lon": -97.74}]
  }
}
```
