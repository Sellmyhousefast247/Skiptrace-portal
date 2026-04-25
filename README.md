# Skiptrace Portal

A small Flask web app for skip-trace lookups: single search, batch CSV upload,
search history, and CSV export.

The lookup layer ships with a deterministic **mock provider** so the portal is
usable end-to-end without API credentials. Wire `providers.lookup()` to a real
service (BatchSkipTracing, REIskip, SkipGenie, IDI, etc.) before relying on the
results.

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000.

## Layout

- `app.py` — Flask routes, SQLite history, CSV export.
- `providers.py` — `lookup(query)` adapter. Replace `_mock_lookup` with real provider calls.
- `templates/` — `base.html`, `dashboard.html`.
- `static/css/styles.css`, `static/js/app.js` — UI.
- `instance/skiptrace.db` — SQLite history (auto-created, gitignored).

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/api/skiptrace` | JSON `{name, address, city, state, zip, phone, email}` — at least one of name/address/phone/email required. |
| `POST` | `/api/batch` | `multipart/form-data` with a `file` field; CSV with header row. |
| `GET` | `/api/history?limit=N` | Recent searches (default 50, max 500). |
| `GET` | `/api/export.csv` | Full history as CSV. |
| `DELETE` | `/api/history/<id>` | Remove a row from history. |

## Wiring a real provider

In `providers.py`, replace `_mock_lookup` with an HTTP call to your provider
and map the response into this shape:

```json
{
  "name": "...",
  "phones":    [{"number": "...", "type": "mobile|landline|voip", "score": 0-100}],
  "emails":    ["..."],
  "addresses": [{"line": "...", "city": "...", "state": "..", "zip": "...", "type": "current|previous"}],
  "relatives": ["..."],
  "confidence": 0-100
}
```

Set `SKIPTRACE_PROVIDER` to anything other than `mock` once you've implemented
the real branch — the mock will then refuse to run.

## Compliance

Skip-trace data is regulated. Confirm your use case is permissible under FCRA,
GLBA, DPPA, and TCPA before contacting anyone returned by this tool.
