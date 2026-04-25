"""Base scraper: HTTP session, rate limiting, on-disk cache, parsing helpers.

Design notes:
- Rate limiting is per-domain and lives in-process (a dict + lock). Conservative
  default of 6s between hits; sites can override `min_interval`.
- Responses are cached in SQLite by URL hash with a TTL so repeat lookups don't
  re-hit the source. Cache is keyed by URL only — change `build_url` to bust.
- Cloudflare's IUAM challenges are handled by `cloudscraper` if installed.
  Without it, requests-only mode still works for sites that aren't behind CF.
- Selectors rot. Each adapter's `parse()` should be defensive: try several
  selector strategies and degrade gracefully — at minimum, every result
  contains the search URL so the user can click through manually.
"""

from __future__ import annotations

import hashlib
import logging
import re
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

try:
    import cloudscraper  # type: ignore
    _SESSION: requests.Session = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
    _CLOUDSCRAPER = True
except Exception:  # pragma: no cover
    _SESSION = requests.Session()
    _CLOUDSCRAPER = False

log = logging.getLogger("skiptrace.scrape")

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Upgrade-Insecure-Requests": "1",
}

CACHE_DB = Path(__file__).resolve().parent.parent / "instance" / "scrape_cache.db"
CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days

_RATE_STATE: dict[str, float] = {}
_RATE_LOCK = threading.Lock()


@dataclass
class Person:
    name: str = ""
    age: str = ""
    addresses: list[str] = field(default_factory=list)
    phones: list[str] = field(default_factory=list)
    emails: list[str] = field(default_factory=list)
    relatives: list[str] = field(default_factory=list)
    detail_url: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "age": self.age,
            "addresses": self.addresses,
            "phones": self.phones,
            "emails": self.emails,
            "relatives": self.relatives,
            "detail_url": self.detail_url,
        }


@dataclass
class ScrapeResult:
    source: str
    label: str
    url: str
    status: str = "ok"  # ok | no_results | blocked | error | skipped
    persons: list[Person] = field(default_factory=list)
    error: str = ""
    elapsed_ms: int = 0
    from_cache: bool = False

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "label": self.label,
            "url": self.url,
            "status": self.status,
            "persons": [p.to_dict() for p in self.persons],
            "result_count": len(self.persons),
            "error": self.error,
            "elapsed_ms": self.elapsed_ms,
            "from_cache": self.from_cache,
        }


class BaseScraper:
    """Subclass and implement `build_url` and `parse`."""

    name: str = ""
    label: str = ""
    domain: str = ""
    min_interval: float = 6.0  # seconds between requests to this domain
    timeout: float = 20.0

    def build_url(self, query: dict) -> str:
        raise NotImplementedError

    def parse(self, soup: BeautifulSoup, url: str) -> list[Person]:
        raise NotImplementedError

    def search(self, query: dict) -> ScrapeResult:
        result = ScrapeResult(source=self.name, label=self.label, url="")
        try:
            result.url = self.build_url(query)
        except ValueError as e:
            result.status = "skipped"
            result.error = str(e)
            return result

        start = time.perf_counter()
        try:
            html, from_cache = self._fetch(result.url)
            result.from_cache = from_cache
        except _Blocked as e:
            result.status = "blocked"
            result.error = str(e)
            return result
        except Exception as e:
            result.status = "error"
            result.error = f"{type(e).__name__}: {e}"
            return result
        finally:
            result.elapsed_ms = int((time.perf_counter() - start) * 1000)

        try:
            soup = BeautifulSoup(html, "lxml")
        except Exception:
            soup = BeautifulSoup(html, "html.parser")

        if _looks_like_block_page(soup, html):
            result.status = "blocked"
            result.error = "site returned a captcha or interstitial"
            return result

        try:
            result.persons = self.parse(soup, result.url) or []
        except Exception as e:
            log.exception("parse failed for %s", self.name)
            result.status = "error"
            result.error = f"parse: {type(e).__name__}: {e}"
            return result

        # Strip the source's own contact emails (support@, info@, etc. on the site's
        # own domain) which often appear in page footers.
        self_host = self.domain.replace("www.", "").lower()
        for p in result.persons:
            p.emails = [e for e in p.emails if not e.lower().endswith("@" + self_host)]

        # Drop persons that ended up with no useful data after filtering.
        result.persons = [
            p for p in result.persons
            if p.name or p.phones or p.addresses or p.emails
        ]

        if not result.persons:
            result.status = "no_results"
        return result

    def _fetch(self, url: str) -> tuple[str, bool]:
        cached = _cache_get(url)
        if cached is not None:
            return cached, True

        domain = urlparse(url).netloc
        _rate_limit_wait(domain, self.min_interval)

        log.info("GET %s", url)
        try:
            resp = _SESSION.get(url, headers=DEFAULT_HEADERS, timeout=self.timeout)
        except requests.RequestException as e:
            raise _Blocked(f"network error: {e}") from e

        if resp.status_code in (403, 429):
            raise _Blocked(f"HTTP {resp.status_code} from {domain}")
        if resp.status_code >= 400:
            raise RuntimeError(f"HTTP {resp.status_code} from {domain}")

        body = resp.text
        _cache_put(url, body)
        return body, False


class _Blocked(Exception):
    pass


# --- rate limiting -----------------------------------------------------------

def _rate_limit_wait(domain: str, min_interval: float) -> None:
    if min_interval <= 0:
        return
    with _RATE_LOCK:
        last = _RATE_STATE.get(domain, 0.0)
        now = time.monotonic()
        wait = (last + min_interval) - now
        if wait > 0:
            time.sleep(wait)
        _RATE_STATE[domain] = time.monotonic()


# --- cache (SQLite) ----------------------------------------------------------

def _cache_conn() -> sqlite3.Connection:
    CACHE_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(CACHE_DB, timeout=10)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS scrape_cache (
            url_hash TEXT PRIMARY KEY,
            fetched_at TEXT NOT NULL,
            body TEXT NOT NULL
        )
    """)
    return conn


def _cache_get(url: str) -> str | None:
    h = hashlib.sha256(url.encode()).hexdigest()
    try:
        with _cache_conn() as c:
            row = c.execute(
                "SELECT fetched_at, body FROM scrape_cache WHERE url_hash = ?",
                (h,),
            ).fetchone()
    except sqlite3.Error:
        return None
    if not row:
        return None
    fetched_at, body = row
    try:
        ts = datetime.fromisoformat(fetched_at)
    except ValueError:
        return None
    age = (datetime.now(timezone.utc) - ts).total_seconds()
    if age > CACHE_TTL_SECONDS:
        return None
    return body


def _cache_put(url: str, body: str) -> None:
    h = hashlib.sha256(url.encode()).hexdigest()
    try:
        with _cache_conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO scrape_cache (url_hash, fetched_at, body) VALUES (?, ?, ?)",
                (h, datetime.now(timezone.utc).isoformat(timespec="seconds"), body),
            )
    except sqlite3.Error:
        pass


# --- helpers shared by adapters ---------------------------------------------

PHONE_RE = re.compile(r"\(?\b\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}\b")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def text(node: Any) -> str:
    if node is None:
        return ""
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _looks_like_block_page(soup: BeautifulSoup, html: str) -> bool:
    title = (soup.title.string or "").lower() if soup.title and soup.title.string else ""
    if any(w in title for w in (
        "just a moment", "attention required", "access denied", "captcha",
        "humanity check", "are you human", "verify you are a human",
        "site can't be reached", "blocked", "challenge",
    )):
        return True
    body_lower = html.lower()
    if "cf-chl" in body_lower and "challenge-platform" in body_lower:
        return True
    if "px-captcha" in body_lower or "perimeterx" in body_lower:
        return True
    if "humanity check" in body_lower or "verify you are human" in body_lower:
        return True
    if "hcaptcha.com" in body_lower or "g-recaptcha" in body_lower:
        return True
    if '"http_status_code":"403"' in body_lower or '"page_subtype":"403"' in body_lower:
        return True
    return False


def has_cloudscraper() -> bool:
    return _CLOUDSCRAPER
