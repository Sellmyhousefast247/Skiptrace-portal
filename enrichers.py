"""Free enrichment APIs that don't require a key.

- `enrich_phone(num)` — uses libphonenumber for offline carrier/type/region.
- `enrich_address(addr_dict)` — calls the US Census Geocoder (free, no auth)
  to standardize and geocode the address.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import phonenumbers
import requests
from phonenumbers import carrier as ph_carrier
from phonenumbers import geocoder as ph_geocoder
from phonenumbers import number_type as ph_type
from phonenumbers import PhoneNumberFormat as PNF
from phonenumbers import PhoneNumberType as PNT

log = logging.getLogger("skiptrace.enrich")

CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
CENSUS_TIMEOUT = 8.0

_TYPE_NAMES = {
    PNT.MOBILE: "mobile",
    PNT.FIXED_LINE: "landline",
    PNT.FIXED_LINE_OR_MOBILE: "mobile/landline",
    PNT.VOIP: "voip",
    PNT.TOLL_FREE: "toll-free",
    PNT.PREMIUM_RATE: "premium",
    PNT.SHARED_COST: "shared-cost",
    PNT.PERSONAL_NUMBER: "personal",
    PNT.PAGER: "pager",
    PNT.UAN: "uan",
    PNT.VOICEMAIL: "voicemail",
    PNT.UNKNOWN: "unknown",
}


def enrich_phone(raw: str, region: str = "US") -> dict[str, Any]:
    """Return formatted, validity, type, carrier, region for a phone string."""
    out: dict[str, Any] = {"input": raw}
    try:
        parsed = phonenumbers.parse(raw, region)
    except phonenumbers.NumberParseException as e:
        out["error"] = str(e)
        return out

    out["valid"] = phonenumbers.is_valid_number(parsed)
    out["possible"] = phonenumbers.is_possible_number(parsed)
    out["e164"] = phonenumbers.format_number(parsed, PNF.E164)
    out["national"] = phonenumbers.format_number(parsed, PNF.NATIONAL)
    out["international"] = phonenumbers.format_number(parsed, PNF.INTERNATIONAL)
    out["country"] = phonenumbers.region_code_for_number(parsed) or region
    out["type"] = _TYPE_NAMES.get(ph_type(parsed), "unknown")
    try:
        out["carrier"] = ph_carrier.name_for_number(parsed, "en") or ""
    except Exception:
        out["carrier"] = ""
    try:
        out["location"] = ph_geocoder.description_for_number(parsed, "en") or ""
    except Exception:
        out["location"] = ""
    return out


def enrich_address(addr: dict[str, Any]) -> dict[str, Any]:
    """Call the US Census Geocoder to standardize a US address. Returns
    {standardized, lat, lon, county} on success, or {error} on failure."""
    one_line = ", ".join(
        s for s in (addr.get("line") or addr.get("address"),
                    addr.get("city"), addr.get("state"), addr.get("zip"))
        if s
    )
    if not one_line.strip():
        return {"error": "empty address"}

    try:
        resp = requests.get(
            CENSUS_URL,
            params={
                "address": one_line,
                "benchmark": "Public_AR_Current",
                "format": "json",
            },
            timeout=CENSUS_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException as e:
        return {"error": f"census: {e}"}
    except ValueError:
        return {"error": "census: invalid JSON"}

    matches = (data.get("result") or {}).get("addressMatches") or []
    if not matches:
        return {"error": "no match"}

    m = matches[0]
    coords = m.get("coordinates") or {}
    return {
        "standardized": m.get("matchedAddress", ""),
        "lat": coords.get("y"),
        "lon": coords.get("x"),
        "tigerline": (m.get("tigerLine") or {}).get("tigerLineId", ""),
    }


def normalize_phone_string(s: str) -> str:
    """Return a canonical (XXX) XXX-XXXX form, or the original if not 10 digits."""
    digits = re.sub(r"\D", "", s or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return s
