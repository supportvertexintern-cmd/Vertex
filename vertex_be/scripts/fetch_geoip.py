"""Fetches DB-IP's free "IP to Country Lite" database (CC BY 4.0, monthly,
no account needed) for the backend image: python scripts/fetch_geoip.py <dir>.

This month's file, or last month's if this month's isn't out yet. If both
fail, the image is built without it: country lookups answer "unknown" and
the new-country check is off, nothing else changes. The image build passes
the month (GEOIP_MONTH), so the first build each month fetches the new one.
"""

from __future__ import annotations

import datetime
import gzip
import sys
import urllib.request
from pathlib import Path

URL = "https://download.db-ip.com/free/dbip-country-lite-{month}.mmdb.gz"
# DB-IP refuses Python's default client name.
HEADERS = {"User-Agent": "vertex-backend-image-build/1.0"}


def main(target: Path) -> int:
    target.mkdir(parents=True, exist_ok=True)
    first = datetime.date.today().replace(day=1)
    for month in (first.strftime("%Y-%m"), (first - datetime.timedelta(days=1)).strftime("%Y-%m")):
        try:
            request = urllib.request.Request(URL.format(month=month), headers=HEADERS)
            with urllib.request.urlopen(request, timeout=120) as res:  # noqa: S310 (a fixed https URL)
                data = gzip.decompress(res.read())
            if b"MaxMind.com" not in data[-500_000:]:  # the format's metadata marker
                raise ValueError("not a MaxMind DB file")
        except Exception as err:  # noqa: BLE001
            print(f"geoip: {month}: {err}", file=sys.stderr)
            continue
        (target / "dbip-country-lite.mmdb").write_bytes(data)
        (target / "MONTH").write_text(month)
        print(f"geoip: DB-IP country lite {month}, {len(data) // 1024} KiB")
        return 0
    print("geoip: no database; country lookups are off", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1] if len(sys.argv) > 1 else "/opt/geoip")))
