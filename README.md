# Skiptrace Portal

Real-time skip-trace dashboard with two parts that work together:

1. **Static dashboard** on GitHub Pages (`docs/`) — the UI you visit.
2. **Flask backend** deployable in one click to Render (`app.py`, `render.yaml`)
   — does the actual scraping and returns merged phones, addresses, emails, and
   relatives that show up inline on the dashboard.

Without the backend, the dashboard runs in **links-only mode**: it generates
pre-filled URLs into 15+ free people-search sites that you click through
manually. With the backend, you get phones and relatives **on the dashboard
itself**.

## Setup (5 minutes, one-time)

### Step 1: Enable GitHub Pages (the dashboard)

1. **Settings → Pages**: https://github.com/Sellmyhousefast247/Skiptrace-portal/settings/pages
2. Under **Source**, select **GitHub Actions**.
3. Push to `main` (or run the workflow manually). Your dashboard will be live at:

   **https://sellmyhousefast247.github.io/Skiptrace-portal/**

### Step 2: Deploy the backend to Render (free)

1. Click here: **https://render.com/deploy?repo=https://github.com/Sellmyhousefast247/Skiptrace-portal**
2. Sign in (free, GitHub login works).
3. Render reads `render.yaml` automatically. Click **Apply**.
4. Wait ~3 minutes for the first build. You'll get a URL like
   `https://skiptrace-portal-backend.onrender.com`.

> **Free tier note:** Render spins the service down after 15 minutes of
> inactivity. The first lookup after a cold start takes ~30–60 s while it
> wakes up. Subsequent lookups are fast (5–15 s).

### Step 3: Connect them

1. Open your dashboard.
2. Click **⚙ Settings** (top right).
3. Paste the Render URL into **Backend URL** (e.g.
   `https://skiptrace-portal-backend.onrender.com`).
4. Click **Test connection** → should say "✓ Connected".
5. Click **Save**.

The banner at the top should now read **"✓ Backend connected"**. Run a
lookup — phones, addresses, and relatives appear inline.

## What you see in backend mode

For each lookup the dashboard shows:

- **📞 Phones** — number, line type (mobile/landline/voip), region, validity
  (libphonenumber), one-tap **Call** and **Text** links, and which sites it
  came from.
- **👨‍👩‍👧 Relatives & associates** — clickable; each has a "Look up phones →"
  button that runs a fresh skip trace on that relative.
- **🏠 Addresses** — original + Census-standardized + Google Maps link.
- **✉ Emails**.
- **Sources panel** (collapsed) — per-site status: `ok`, `blocked`, `no_results`,
  `error`. Tells you exactly which sites returned data and which ones got
  blocked, with timing.
- **Open at source manually** (collapsed) — the same 15 free-site quick-launch
  links as a fallback.

## Realistic expectations

These free sites actively block scrapers. From a Render datacenter IP, you
should usually expect:

- ✅ **ThatsThem** — typically returns data.
- ⚠️ **TruePeopleSearch / Spokeo** — coin flip; cloudscraper helps, but
  Cloudflare sometimes wins.
- ❌ **FastPeopleSearch / USPhoneBook** — frequently blocked from datacenter IPs.

When a site is blocked you see it clearly in the Sources panel, and the
quick-launch link still opens it in your browser as a manual fallback. For
near-100% coverage you'd need either a paid skip-trace API (BatchSkipTracing,
REIskip — wire into `providers.py`) or a residential proxy.

## Sources covered

TruePeopleSearch · FastPeopleSearch · ThatsThem · USPhoneBook · Spokeo ·
Whitepages · Radaris · 411.com · AnyWho · BeenVerified · PeopleFinders ·
SearchPeopleFREE · Google · Facebook · LinkedIn.

(The first four are scraped by the backend; all 15 are quick-launchable from
the dashboard.)

## Local development

Run the backend locally:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000 to use the Flask-served version, or open the
static dashboard from `docs/` and point Settings → Backend URL at
`http://localhost:5000`.

| Env var                       | Default | Notes                                                          |
| ----------------------------- | ------- | -------------------------------------------------------------- |
| `SKIPTRACE_PROVIDER`          | `live`  | Set to `mock` for offline test mode.                           |
| `SKIPTRACE_SOURCES`           | (all)   | Comma-list, e.g. `truepeoplesearch,thatsthem`.                 |
| `SKIPTRACE_ALLOWED_ORIGINS`   | github.io + localhost | Extra origins allowed via CORS.                       |
| `SKIPTRACE_ALLOW_ALL_ORIGINS` | `0`     | Set to `1` to allow any origin (dev only).                     |
| `PORT`                        | `5000`  | Server port (Render sets this automatically).                  |

## Architecture

```
docs/                  Static dashboard (GitHub Pages)
  index.html           UI shell, settings modal
  app.js               Backend client + links-only fallback
  styles.css

app.py                 Flask: routes, history (SQLite), CORS, /healthz
providers.py           lookup() — runs scrapers concurrently, merges, enriches
enrichers.py           libphonenumber + US Census Geocoder (no API keys)
scrapers/
  base.py              HTTP session (cloudscraper), rate limit, cache, block detection
  truepeoplesearch.py
  fastpeoplesearch.py
  thatsthem.py
  usphonebook.py

render.yaml            Render Blueprint (one-click deploy)
Procfile               Heroku-style start command
.github/workflows/
  pages.yml            Deploys docs/ to GitHub Pages
```

## Compliance

Skip-trace data is regulated. Confirm your use case is permissible under
**FCRA, GLBA, DPPA, and TCPA** before contacting anyone returned. Each free
site's ToS prohibits scraping — keep volume low, don't run multiple workers
in parallel, and respect the per-domain rate limits (6–8 s) baked into the
scrapers.
