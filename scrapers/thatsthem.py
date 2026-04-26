"""ThatsThem adapter.

ThatsThem is the most reliably-scrapeable of the free sites — it usually
returns plain HTML even without Cloudflare bypass.

URL patterns:
- phone:   /phone/555-555-1212
- email:   /email/foo@bar.com
- address: /address/123-Main-St
- name:    /name/John-Smith/Austin-TX
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .base import EMAIL_RE, PHONE_RE, BaseScraper, Person, text


class ThatsThem(BaseScraper):
    name = "thatsthem"
    label = "ThatsThem"
    domain = "thatsthem.com"
    min_interval = 5.0

    BASE = "https://thatsthem.com"

    def build_url(self, q: dict) -> str:
        if q.get("phone"):
            digits = re.sub(r"\D", "", q["phone"])
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) != 10:
                raise ValueError("phone must be 10 digits")
            return f"{self.BASE}/phone/{digits[:3]}-{digits[3:6]}-{digits[6:]}"
        if q.get("email"):
            return f"{self.BASE}/email/{q['email']}"
        if q.get("address"):
            slug = re.sub(r"\s+", "-", q["address"].strip())
            return f"{self.BASE}/address/{slug}"
        if q.get("name"):
            name_slug = re.sub(r"\s+", "-", q["name"].strip())
            csz = "-".join(p for p in (q.get("city"), q.get("state")) if p)
            csz = re.sub(r"\s+", "-", csz)
            if csz:
                return f"{self.BASE}/name/{name_slug}/{csz}"
            return f"{self.BASE}/name/{name_slug}"
        raise ValueError("need name, address, phone, or email")

    def parse(self, soup: BeautifulSoup, url: str) -> list[Person]:
        cards = soup.select("article.tt-result, div.search-result, div.result")
        people: list[Person] = []
        for card in cards[:25]:
            p = self._parse_card(card)
            if p.name or p.phones or p.addresses or p.emails:
                people.append(p)

        if not people:
            # Some pages are single-record with no card wrapper.
            single = self._parse_single_record(soup)
            if single:
                people.append(single)
        return people

    def _parse_card(self, card) -> Person:
        person = Person()
        h = card.select_one("h2, h3, .result-name, .name")
        person.name = text(h)

        whole = text(card)
        for m in PHONE_RE.findall(whole):
            if m not in person.phones:
                person.phones.append(m)
        for e in EMAIL_RE.findall(whole):
            if e not in person.emails:
                person.emails.append(e)

        for a in card.select("a"):
            href = a.get("href", "")
            if href.startswith("/p/") or href.startswith("/name/"):
                person.detail_url = self.BASE + href
                break

        for li in card.select("li, .address, .city-state"):
            t = text(li)
            if any(s.lower() in t.lower() for s in ("ave", "st", "rd", "blvd", "ln", "dr", "way")):
                if t not in person.addresses:
                    person.addresses.append(t)
        return person

    def _parse_single_record(self, soup: BeautifulSoup) -> Person | None:
        h1 = soup.select_one("h1")
        if not h1:
            return None
        person = Person(name=text(h1))
        whole = text(soup.select_one("main") or soup.body or soup)
        for m in PHONE_RE.findall(whole):
            if m not in person.phones:
                person.phones.append(m)
        for e in EMAIL_RE.findall(whole):
            if e not in person.emails:
                person.emails.append(e)
        return person if (person.phones or person.emails) else None
