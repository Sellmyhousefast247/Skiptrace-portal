"""Scraper registry.

To enable/disable sources at runtime, set:
    SKIPTRACE_SOURCES=truepeoplesearch,fastpeoplesearch,thatsthem,usphonebook

If unset, all registered scrapers run.
"""

from __future__ import annotations

import os
from typing import Iterable

from .base import BaseScraper, ScrapeResult
from .fastpeoplesearch import FastPeopleSearch
from .thatsthem import ThatsThem
from .truepeoplesearch import TruePeopleSearch
from .usphonebook import USPhoneBook

ALL: list[type[BaseScraper]] = [
    TruePeopleSearch,
    FastPeopleSearch,
    ThatsThem,
    USPhoneBook,
]

BY_NAME: dict[str, type[BaseScraper]] = {cls.name: cls for cls in ALL}


def enabled_scrapers() -> list[BaseScraper]:
    raw = os.environ.get("SKIPTRACE_SOURCES", "").strip()
    if not raw:
        return [cls() for cls in ALL]
    names = [n.strip() for n in raw.split(",") if n.strip()]
    return [BY_NAME[n]() for n in names if n in BY_NAME]


__all__ = [
    "ALL",
    "BY_NAME",
    "BaseScraper",
    "ScrapeResult",
    "enabled_scrapers",
    "FastPeopleSearch",
    "ThatsThem",
    "TruePeopleSearch",
    "USPhoneBook",
]


def all_search_urls(query: dict) -> Iterable[dict]:
    """Yield {name, url} for every scraper, even disabled ones — for the UI's
    quick-launch panel so the user can always click through manually."""
    for cls in ALL:
        try:
            yield {"name": cls.name, "label": cls.label, "url": cls().build_url(query)}
        except Exception:
            continue
