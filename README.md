# Skiptrace Portal

Two ways to use this:

1. **Hosted static dashboard** (recommended) — runs in your browser, no install,
   no backend. Generates one-click search URLs into 15+ free skip-trace sites,
   enriches phone numbers (libphonenumber) and addresses (US Census Geocoder),
   batch CSV upload, history in localStorage. Deployed via GitHub Pages.
2. **Local Flask app** — same idea but with a Python backend that *attempts* to
   scrape the sites directly. Less reliable (sites block scrapers aggressively)
   but useful when paired with a residential IP.

## 1. Hosted dashboard — enable GitHub Pages

The static dashboard lives in `docs/`. After this branch is merged (or while
you're working on it), enable Pages once:

1. Go to your repo's **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or run the workflow manually under **Actions → Deploy
   dashboard to GitHub Pages → Run workflow**).

The included workflow (`.github/workflows/pages.yml`) auto-deploys
`docs/` on every push to `main` or this feature branch.

Your dashboard URL will be:

```
https://<your-github-username>.github.io/<repo-name>/
```

For this repo that's:

```
https://sellmyhousefast247.github.io/Skiptrace-portal/
```

(The exact URL appears at the top of **Settings → Pages** after the first
successful deployment.)

### What the dashboard does

- **Single lookup**: enter name / address / phone / email; one click opens
  every applicable free skip-trace site pre-filled in a new tab. "Open all in
  tabs" launches them all at once.
- **Phone enrichment**: libphonenumber gives line type (mobile/landline/voip),
  region, validity, and E.164 format.
- **Address enrichment**: US Census Geocoder standardizes the address and
  gives lat/lon plus a Google Maps link.
- **Batch CSV**: upload a CSV (header row required), get a table with one
  column per source containing the pre-filled search URL for that row, plus
  download an "enriched CSV" with all the URLs as columns.
- **History**: stored in your browser's localStorage; rerun, delete, export.

### Sources covered

TruePeopleSearch · FastPeopleSearch · ThatsThem · USPhoneBook · Spokeo ·
Whitepages · Radaris · 411.com · AnyWho · BeenVerified · PeopleFinders ·
SearchPeopleFREE · Google · Facebook · LinkedIn.

To add a new site, append an object to `SOURCES` in `docs/app.js`:

```js
{
  key: "newsite",
  label: "NewSite",
  build(q) {
    if (q.phone) return `https://newsite.com/lookup/${digitsOnly(q.phone)}`;
    return null;
  },
}
```

## 2. Local Flask app (optional — actual scraping)

The original Flask app is still here. It runs the same kind of free-site
searches but tries to scrape them directly with cloudscraper, parses the HTML,
and merges results across sources with source attribution and confidence
scoring. Falls back to click-through URLs (same as the static dashboard) when
a site blocks the request.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000.

| Env var               | Default | Notes                                                  |
| --------------------- | ------- | ------------------------------------------------------ |
| `SKIPTRACE_PROVIDER`  | `live`  | Set to `mock` for offline test mode.                   |
| `SKIPTRACE_SOURCES`   | (all)   | Comma-list, e.g. `truepeoplesearch,thatsthem`.         |

See `app.py`, `providers.py`, `scrapers/`, `enrichers.py` for details.

## Compliance

Skip-trace data is regulated. Confirm your use case is permissible under
FCRA, GLBA, DPPA, and TCPA before contacting anyone returned by either tool.
Each site's Terms of Service prohibits automated access — keep volume low if
you use the local Flask scraper.
