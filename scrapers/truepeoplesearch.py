"""TruePeopleSearch adapter.

Search URL patterns:
- by name + city/state: /results?name=John+Smith&citystatezip=Austin+TX
- by phone:             /results?phoneno=5125551212
- by address:           /results?streetaddress=123+Main+St&citystatezip=Austin+TX

Selectors target `.card-summary` blocks; if the markup changes, update
`_parse_card`.
"""

from __future__ import annotations

import re
from urllib.parse import urlencode

from bs4 import BeautifulSoup

from .base import EMAIL_RE, PHONE_RE, BaseScraper, Person, text


class TruePeopleSearch(BaseScraper):
    name = "truepeoplesearch"
    label = "TruePeopleSearch"
    domain = "www.truepeoplesearch.com"
    min_interval = 8.0

    BASE = "https://www.truepeoplesearch.com"

    def build_url(self, q: dict) -> str:
        if q.get("phone"):
            digits = re.sub(r"\D", "", q["phone"])
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) != 10:
                raise ValueError("phone must be 10 digits")
            return f"{self.BASE}/results?{urlencode({'phoneno': digits})}"
        if q.get("address"):
            params = {"streetaddress": q["address"]}
            csz = " ".join(p for p in (q.get("city"), q.get("state"), q.get("zip")) if p)
            if csz:
                params["citystatezip"] = csz
            return f"{self.BASE}/results?{urlencode(params)}"
        if q.get("name"):
            params = {"name": q["name"]}
            csz = " ".join(p for p in (q.get("city"), q.get("state"), q.get("zip")) if p)
            if csz:
                params["citystatezip"] = csz
            return f"{self.BASE}/results?{urlencode(params)}"
        raise ValueError("need name, address, or phone")

    def parse(self, soup: BeautifulSoup, url: str) -> list[Person]:
        cards = soup.select("div.card-summary") or soup.select("[data-detail-link]")
        people: list[Person] = []
        for card in cards[:25]:
            p = self._parse_card(card)
            if p.name or p.phones or p.addresses:
                people.append(p)
        return people

    def _parse_card(self, card) -> Person:
        person = Person()
        name_el = card.select_one("div.h4, .card-title, [data-link-to-more='name']")
        person.name = text(name_el)

        for label, attr in (
            ("Age", "age"),
        ):
            tag = card.find(string=re.compile(rf"\b{label}\b", re.I))
            if tag:
                m = re.search(r"\d{1,3}", tag.parent.get_text(" ", strip=True))
                if m:
                    setattr(person, attr, m.group(0))

        addr_block = card.find(string=re.compile(r"current address", re.I))
        if addr_block:
            container = addr_block.find_parent(["div", "section"])
            if container:
                addr = text(container.find_next("a") or container.find_next("div"))
                if addr:
                    person.addresses.append(addr)

        for a in card.select("a"):
            href = a.get("href", "")
            txt = text(a)
            if href.startswith("/find/person/"):
                person.detail_url = "https://www.truepeoplesearch.com" + href
            if PHONE_RE.fullmatch(txt) and txt not in person.phones:
                person.phones.append(txt)
            if href.startswith("tel:"):
                num = PHONE_RE.search(href) or PHONE_RE.search(txt)
                if num and num.group(0) not in person.phones:
                    person.phones.append(num.group(0))

        whole = text(card)
        for m in PHONE_RE.findall(whole):
            if m not in person.phones:
                person.phones.append(m)
        for e in EMAIL_RE.findall(whole):
            if e not in person.emails:
                person.emails.append(e)

        return person
