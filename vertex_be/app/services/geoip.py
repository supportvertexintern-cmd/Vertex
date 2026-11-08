"""Country of an address (admin monitoring, owner's decision 2026-11-07): a
free offline database bundled in the backend image and refreshed monthly,
DB-IP's "IP to Country Lite" (CC BY 4.0: the pages that show a country
credit it). scripts/fetch_geoip.py fetches it at build time into
GEOIP_DIR. Without it (a bare uvicorn, tests, a failed download) every
lookup answers None and the new-country check stays off.
"""

from __future__ import annotations

import ipaddress
import logging
import threading
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import log_event

ATTRIBUTION = "IP geolocation by DB-IP (db-ip.com), CC BY 4.0"
_lock = threading.Lock()
_reader: Any = None
_loaded = False


def _open() -> Any:
    global _reader, _loaded
    with _lock:
        if not _loaded:
            _loaded = True
            path = Path(settings.GEOIP_DIR) / "dbip-country-lite.mmdb"
            if path.is_file():
                try:
                    import maxminddb  # noqa: PLC0415

                    _reader = maxminddb.open_database(str(path))
                except Exception as err:  # noqa: BLE001
                    log_event(logging.ERROR, "geoip.open_failed", error=type(err).__name__)
            else:
                log_event(logging.WARNING, "geoip.missing", path=str(path))
    return _reader


def database_month() -> str | None:
    """The month of the bundled database, e.g. "2026-11"."""
    try:
        return (Path(settings.GEOIP_DIR) / "MONTH").read_text().strip() or None
    except OSError:
        return None


def country_of(ip: str | None) -> str | None:
    """The ISO country code of a public address, or None (unknown, private, no database)."""
    if not ip:
        return None
    try:
        address = ipaddress.ip_address(ip.strip())
    except ValueError:
        return None
    if not address.is_global:
        return None
    reader = _open()
    if reader is None:
        return None
    try:
        record = reader.get(str(address)) or {}
    except Exception:  # noqa: BLE001
        return None
    code = (record.get("country") or {}).get("iso_code") if isinstance(record, dict) else None
    return code if isinstance(code, str) and code else None
