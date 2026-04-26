"""FastPeopleSearch adapter.

URL patterns observed in production:
- by name + location: /name/{first-last}_{city-state}
- by phone:           /{1234567890}
- by address:         /address/{slug-of-address}_{city-state}
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .base import EMAIL_RE, PHONE_RE, BaseScraper, Person, slugify, text


class FastPeopleSearch(BaseScraper):
    name = "fastpeoplesearch"
    label = "FastPeopleSearch"
    domain = "www.fastpeoplesearch.com"
    min_interval = 8.0

    BASE = "https://www.fastpeoplesearch.com"

    def build_url(self, q: dict) -> str:
        if q.get("phone"):
            digits = re.sub(r"\D", "", q["phone"])
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) != 10:
                raise ValueError("phone must be 10 digits")
            return f"{self.BASE}/{digits}"
        if q.get("address"):
            addr_slug = slugify(q["address"])
            csz = " ".join(p for p in (q.get("city"), q.get("state")) if p)
            csz_slug = slugify(csz) if csz else ""
            if csz_slug:
                return f"{self.BASE}/address/{addr_slug}_{csz_slug}"
            return f"{self.BASE}/address/{addr_slug}"
        if q.get("name"):
            name_slug = slugify(q["name"])
            csz = " ".join(p for p in (q.get("city"), q.get("state")) if p)
            csz_slug = slugify(csz) if csz else ""
            if csz_slug:
                return f"{self.BASE}/name/{name_slug}_{csz_slug}"
            return f"{self.BASE}/name/{name_slug}"
        raise ValueError("need name, address, or phone")

    def parse(self, soup: BeautifulSoup, url: str) -> list[Person]:
        cards = soup.select("div.card-block, div.people-card, .card.card-block")
        people: list[Person] = []
        for card in cards[:25]:
            p = self._parse_card(card)
            if p.name or p.phones or p.addresses:
                people.append(p)
        return people

    def _parse_card(self, card) -> Person:
        person = Person()
        name_el = card.select_one("h2, .card-title, .larger.larger")
        person.name = text(name_el)

        age_match = re.search(r"Age\s*(\d{1,3})", text(card), re.I)
        if age_match:
            person.age = age_match.group(1)

        for a in card.select("a"):
            href = a.get("href", "")
            if href.startswith("/name/") and "detail_url" not in person.__dict__.get("detail_url", ""):
                person.detail_url = "https://www.fastpeoplesearch.com" + href
                break

        addr_section = card.find(string=re.compile(r"address|lives in", re.I))
        if addr_section:
            container = addr_section.find_parent(["div", "section", "li"])
            if container:
                for a in container.select("a"):
                    t = text(a)
                    if t and t not in person.addresses and not PHONE_RE.fullmatch(t):
                        person.addresses.append(t)

        whole = text(card)
        for m in PHONE_RE.findall(whole):
            if m not in person.phones:
                person.phones.append(m)
        for e in EMAIL_RE.findall(whole):
            if e not in person.emails:
                person.emails.append(e)

        return person
