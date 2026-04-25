"""Skip-trace provider adapter.

This module exposes a single function `lookup(query)` that the rest of the app
calls. It returns a dict with phones, emails, addresses, relatives, and a
confidence score.

The default implementation is a deterministic mock so the portal is usable
end-to-end without external credentials. To wire in a real provider
(BatchSkipTracing, REIskip, SkipGenie, IDI, etc.), replace `_mock_lookup` with
an HTTP call to the provider and map their response into the same shape.
"""

from __future__ import annotations

import hashlib
import os
import random
from typing import Any

MOCK_NOTICE = (
    "Mock data — wire providers.lookup() to a real skip-trace API in production."
)


def lookup(query: dict[str, Any]) -> dict[str, Any]:
    """Run a skip-trace lookup. Returns a normalized result dict."""
    if os.environ.get("SKIPTRACE_PROVIDER", "mock").lower() == "mock":
        return _mock_lookup(query)
    raise NotImplementedError(
        "Set SKIPTRACE_PROVIDER=mock or implement a real provider in providers.py"
    )


def _mock_lookup(query: dict[str, Any]) -> dict[str, Any]:
    seed_src = "|".join(f"{k}={query.get(k, '')}" for k in sorted(query))
    seed = int(hashlib.sha256(seed_src.encode()).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)

    name = query.get("name") or _fake_name(rng)
    base_state = (query.get("state") or rng.choice(["TX", "FL", "GA", "AZ", "NC", "TN"]))[:2].upper()

    phones = [
        {
            "number": _fake_phone(rng),
            "type": rng.choice(["mobile", "landline", "voip"]),
            "score": rng.randint(60, 99),
        }
        for _ in range(rng.randint(1, 3))
    ]
    emails = [_fake_email(rng, name) for _ in range(rng.randint(0, 2))]
    addresses = [
        {
            "line": query.get("address") or _fake_address(rng),
            "city": query.get("city") or rng.choice(["Austin", "Dallas", "Atlanta", "Tampa", "Phoenix"]),
            "state": base_state,
            "zip": query.get("zip") or f"{rng.randint(10000, 99999)}",
            "type": "current",
        }
    ]
    if rng.random() < 0.6:
        addresses.append({
            "line": _fake_address(rng),
            "city": rng.choice(["Austin", "Dallas", "Atlanta", "Tampa", "Phoenix"]),
            "state": base_state,
            "zip": f"{rng.randint(10000, 99999)}",
            "type": "previous",
        })

    relatives = [_fake_name(rng) for _ in range(rng.randint(0, 3))]

    return {
        "name": name,
        "phones": phones,
        "emails": emails,
        "addresses": addresses,
        "relatives": relatives,
        "confidence": rng.randint(55, 98),
        "notice": MOCK_NOTICE,
    }


def _fake_name(rng: random.Random) -> str:
    first = rng.choice([
        "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
        "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    ])
    last = rng.choice([
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
        "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson", "Thomas",
    ])
    return f"{first} {last}"


def _fake_phone(rng: random.Random) -> str:
    area = rng.randint(200, 989)
    mid = rng.randint(200, 999)
    last = rng.randint(1000, 9999)
    return f"({area}) {mid}-{last}"


def _fake_email(rng: random.Random, name: str) -> str:
    handle = name.lower().replace(" ", ".")
    domain = rng.choice(["gmail.com", "yahoo.com", "outlook.com", "icloud.com"])
    return f"{handle}{rng.randint(1, 99)}@{domain}"


def _fake_address(rng: random.Random) -> str:
    num = rng.randint(100, 9999)
    street = rng.choice(["Maple", "Oak", "Pine", "Cedar", "Elm", "Birch", "Walnut", "Ash"])
    suffix = rng.choice(["St", "Ave", "Rd", "Ln", "Dr", "Way"])
    return f"{num} {street} {suffix}"
