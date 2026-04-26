"""USPhoneBook adapter.

URL patterns:
- phone: /5555551212
- name:  /john-smith/austin-tx
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .base import EMAIL_RE, PHONE_RE, BaseScraper, Person, slugify, text


class USPhoneBook(BaseScraper):
    name = "usphonebook"
    label = "USPhoneBook"
    domain = "www.usphonebook.com"
    min_interval = 6.0

    BASE = "https://www.usphonebook.com"

    def build_url(self, q: dict) -> str:
        if q.get("phone"):
            digits = re.sub(r"\D", "", q["phone"])
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) != 10:
                raise ValueError("phone must be 10 digits")
            return f"{self.BASE}/{digits}"
        if q.get("name"):
            name_slug = slugify(q["name"])
            csz = "-".join(p for p in (q.get("city"), q.get("state")) if p)
            csz_slug = slugify(csz) if csz else ""
            if csz_slug:
                return f"{self.BASE}/{name_slug}/{csz_slug}"
            return f"{self.BASE}/{name_slug}"
        raise ValueError("USPhoneBook needs name or phone")

    def parse(self, soup: BeautifulSoup, url: str) -> list[Person]:
        cards = soup.select(".search-result, .listing, .result-card, article")
        people: list[Person] = []
        for card in cards[:25]:
            p = self._parse_card(card)
            if p.name or p.phones or p.addresses:
                people.append(p)

        if not people:
            single = self._parse_phone_page(soup)
            if single:
                people.append(single)
        return people

    def _parse_card(self, card) -> Person:
        person = Person()
        h = card.select_one("h2, h3, .name, .person-name")
        person.name = text(h)

        whole = text(card)
        for m in PHONE_RE.findall(whole):
            if m not in person.phones:
                person.phones.append(m)
        for e in EMAIL_RE.findall(whole):
            if e not in person.emails:
                person.emails.append(e)

        for a in card.select("a[href^='/']"):
            href = a.get("href", "")
            if "-" in href and href.count("/") >= 2:
                person.detail_url = self.BASE + href
                break
        return person

    def _parse_phone_page(self, soup: BeautifulSoup) -> Person | None:
        h1 = soup.select_one("h1")
        if not h1:
            return None
        whole = text(soup.select_one("main") or soup.body or soup)
        person = Person(name=text(h1))
        for m in PHONE_RE.findall(whole):
            if m not in person.phones:
                person.phones.append(m)
        for e in EMAIL_RE.findall(whole):
            if e not in person.emails:
                person.emails.append(e)
        owner = soup.find(string=re.compile(r"owner|registered to|belongs to", re.I))
        if owner and not person.name:
            person.name = text(owner.parent)
        return person if person.phones or person.name else None
