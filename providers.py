"""Skip-trace provider — aggregates the free-site scrapers + enrichers.

`lookup(query)` runs every enabled scraper concurrently (one task per
domain, with per-domain rate limiting inside the scrapers themselves), merges
the results into a single canonical record, and runs enrichers
(libphonenumber, US Census Geocoder) on top.

Set `SKIPTRACE_PROVIDER=mock` to force the deterministic offline mock used by
the original scaffold.
"""

from __future__ import annotations

import hashlib
import logging
import os
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from enrichers import enrich_address, enrich_phone, normalize_phone_string
from scrapers import all_search_urls, enabled_scrapers

log = logging.getLogger("skiptrace.providers")

MOCK_NOTICE = (
    "Mock data — set SKIPTRACE_PROVIDER=live (default) to scrape free sites."
)


def lookup(query: dict[str, Any]) -> dict[str, Any]:
    mode = os.environ.get("SKIPTRACE_PROVIDER", "live").lower()
    if mode == "mock":
        return _mock_lookup(query)
    return _live_lookup(query)


# --- live aggregation -------------------------------------------------------

def _live_lookup(query: dict[str, Any]) -> dict[str, Any]:
    scrapers = enabled_scrapers()
    sources: list[dict] = []
    persons: list[dict] = []

    if scrapers:
        with ThreadPoolExecutor(max_workers=min(4, len(scrapers))) as pool:
            futures = {pool.submit(s.search, query): s for s in scrapers}
            for fut in as_completed(futures):
                try:
                    res = fut.result()
                except Exception as e:
                    s = futures[fut]
                    sources.append({
                        "source": s.name, "label": s.label, "url": "",
                        "status": "error", "error": str(e),
                        "result_count": 0, "elapsed_ms": 0, "from_cache": False,
                    })
                    continue
                d = res.to_dict()
                sources.append(d)
                for p in d["persons"]:
                    p["_source"] = res.source
                    persons.append(p)

    # Click-through URLs for every source so the user can verify manually.
    quick_links = list(all_search_urls(query))

    merged = _merge_persons(persons, query)
    merged["sources"] = sources
    merged["quick_links"] = quick_links
    merged["confidence"] = _confidence(sources, merged)
    merged["enrichment"] = _enrich(merged)
    return merged


def _merge_persons(persons: list[dict], query: dict) -> dict:
    names: dict[str, int] = {}
    phones: dict[str, dict] = {}
    emails: dict[str, dict] = {}
    addresses: dict[str, dict] = {}
    relatives: dict[str, set[str]] = {}
    detail_urls: list[str] = []

    for p in persons:
        n = (p.get("name") or "").strip()
        if n:
            names[n] = names.get(n, 0) + 1
        for raw in p.get("phones") or []:
            num = normalize_phone_string(raw)
            phones.setdefault(num, {"number": num, "sources": set()})
            phones[num]["sources"].add(p["_source"])
        for raw in p.get("emails") or []:
            e = raw.strip().lower()
            emails.setdefault(e, {"email": e, "sources": set()})
            emails[e]["sources"].add(p["_source"])
        for raw in p.get("addresses") or []:
            a = raw.strip()
            addresses.setdefault(a, {"line": a, "sources": set()})
            addresses[a]["sources"].add(p["_source"])
        for r in p.get("relatives") or []:
            relatives.setdefault(r.strip(), set()).add(p["_source"])
        if p.get("detail_url"):
            detail_urls.append(p["detail_url"])

    best_name = max(names, key=names.get) if names else (query.get("name") or "")

    return {
        "name": best_name,
        "phones": [
            {"number": v["number"], "sources": sorted(v["sources"])}
            for v in phones.values()
        ],
        "emails": [
            {"email": v["email"], "sources": sorted(v["sources"])}
            for v in emails.values()
        ],
        "addresses": [
            {"line": v["line"], "sources": sorted(v["sources"])}
            for v in addresses.values()
        ],
        "relatives": [
            {"name": k, "sources": sorted(v)} for k, v in relatives.items()
        ],
        "detail_urls": detail_urls[:10],
    }


def _enrich(merged: dict) -> dict:
    out: dict[str, Any] = {"phones": [], "addresses": []}
    for p in merged.get("phones", [])[:10]:
        info = enrich_phone(p["number"])
        out["phones"].append({"number": p["number"], **info})
    for a in merged.get("addresses", [])[:5]:
        info = enrich_address({"line": a["line"]})
        out["addresses"].append({"line": a["line"], **info})
    return out


def _confidence(sources: list[dict], merged: dict) -> int:
    ok = sum(1 for s in sources if s["status"] == "ok")
    blocked = sum(1 for s in sources if s["status"] == "blocked")
    no_results = sum(1 for s in sources if s["status"] == "no_results")
    if not sources:
        return 0

    base = int(100 * ok / max(len(sources), 1))
    base -= 10 * blocked
    base -= 3 * no_results
    bonus = min(20, 4 * (len(merged.get("phones", [])) + len(merged.get("addresses", []))))
    return max(0, min(99, base // 2 + bonus + 20 * (ok > 0)))


# --- offline mock (kept for testing) ----------------------------------------

def _mock_lookup(query: dict[str, Any]) -> dict[str, Any]:
    seed_src = "|".join(f"{k}={query.get(k, '')}" for k in sorted(query))
    seed = int(hashlib.sha256(seed_src.encode()).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)

    def fake_phone() -> str:
        return f"({rng.randint(200, 989)}) {rng.randint(200, 999)}-{rng.randint(1000, 9999)}"

    name = query.get("name") or "Jane Doe"
    return {
        "name": name,
        "phones": [{"number": fake_phone(), "sources": ["mock"]} for _ in range(2)],
        "emails": [{"email": f"{name.lower().replace(' ', '.')}@example.com", "sources": ["mock"]}],
        "addresses": [{"line": query.get("address") or "123 Main St", "sources": ["mock"]}],
        "relatives": [],
        "detail_urls": [],
        "sources": [{"source": "mock", "label": "Mock provider", "url": "",
                     "status": "ok", "result_count": 1, "error": "",
                     "elapsed_ms": 0, "from_cache": False, "persons": []}],
        "quick_links": list(all_search_urls(query)),
        "confidence": 60,
        "enrichment": {"phones": [], "addresses": []},
        "notice": MOCK_NOTICE,
    }
