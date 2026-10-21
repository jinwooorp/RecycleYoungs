"""Quarter-scoped Seoul source paging, independent of the legacy CSV loader."""
from urllib.parse import quote

from .api_records import (CollectionError, Page, integer, normalize_sales,
                          normalize_store_stats, quarter, required)

SERVICES = {"stores": ("VwsmAdstrdStorW", normalize_store_stats),
            "sales": ("VwsmAdstrdSelngW", normalize_sales)}


def pages(client, service, period, key, *, page_size=1000, probe=False, allow_http=False):
    quarter(period)
    if service not in SERVICES or type(page_size) is not int or not 1 <= page_size <= 1000:
        raise CollectionError("INVALID_SEOUL_REQUEST")
    if not key or (key == "sample" and (not probe or page_size > 5)):
        raise CollectionError("INVALID_SEOUL_KEY_SCOPE")
    api, normalize = SERVICES[service]
    base = "http://openapi.seoul.go.kr:8088" if allow_http else "https://openapi.seoul.go.kr:8088"
    expected_total = None
    start = 1
    while True:
        end = start + page_size - 1
        url = f"{base}/{quote(key, safe='')}/json/{api}/{start}/{end}/{period}"
        data, raw = client.get_json(url, secret=key)
        envelope = data.get(api, data)
        required(envelope, ["RESULT"])
        required(envelope["RESULT"], ["CODE"])
        code = envelope["RESULT"]["CODE"]
        if code == "INFO-200" and expected_total is None:
            yield Page(1, 0, (), raw, (period,))
            return
        if code != "INFO-000":
            raise CollectionError("SEOUL_API_ERROR")
        required(envelope, ["list_total_count", "row"])
        total = integer(envelope["list_total_count"])
        rows = envelope["row"]
        if not isinstance(rows, list) or (not probe and total > page_size * 10000):
            raise CollectionError("INVALID_SEOUL_PAGE")
        if expected_total is not None and expected_total != total:
            raise CollectionError("SOURCE_TOTAL_CHANGED")
        expected_total = total
        if len(rows) != min(page_size, max(0, total - start + 1)):
            raise CollectionError("PAGE_LENGTH_MISMATCH")
        yield Page((start - 1) // page_size + 1, total,
                   tuple(normalize(row, period) for row in rows), raw, (period,))
        if probe or end >= total:
            return
        start = end + 1
