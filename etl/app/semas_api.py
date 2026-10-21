"""Read-only Seoul store baseline. No mutation or inferred closure handling."""
from urllib.parse import urlencode

from .api_records import CollectionError, Page, integer, normalize_store, reference_month, required

BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong"


def pages(client, key, *, industry=None, page_size=100, probe=False):
    if not key or (industry is not None and industry != "I21201"):
        raise CollectionError("INVALID_SEMAS_SCOPE")
    if type(page_size) is not int or not 1 <= page_size <= 100:
        raise CollectionError("INVALID_SEMAS_PAGE_SIZE")
    expected_total, expected_periods, page = None, None, 1
    while True:
        params = dict(ServiceKey=key, pageNo=page, numOfRows=page_size,
                      divId="ctprvnCd", key="11", type="json")
        if industry:
            params["indsSclsCd"] = industry
        data, raw = client.get_json(BASE + "?" + urlencode(params), secret=key)
        envelope = data.get("response", data)
        required(envelope, ["header", "body"])
        required(envelope["header"], ["resultCode"])
        if envelope["header"]["resultCode"] != "00":
            raise CollectionError("SEMAS_API_ERROR")
        required(envelope["header"], ["stdrYm"])
        month = reference_month(envelope["header"]["stdrYm"])
        periods = (month,)
        if expected_periods is not None and periods != expected_periods:
            raise CollectionError("SOURCE_REFERENCE_CHANGED")
        expected_periods = periods
        body = envelope["body"]
        required(body, ["totalCount", "pageNo", "numOfRows", "items"])
        total = integer(body["totalCount"])
        if integer(body["pageNo"]) != page or integer(body["numOfRows"]) != page_size:
            raise CollectionError("PAGE_METADATA_MISMATCH")
        if not probe and total > page_size * 10000:
            raise CollectionError("PAGE_LIMIT_EXCEEDED")
        if expected_total is not None and expected_total != total:
            raise CollectionError("SOURCE_TOTAL_CHANGED")
        expected_total = total
        rows = body["items"]
        if isinstance(rows, dict) and "item" in rows:
            rows = rows["item"]
            if isinstance(rows, dict):
                rows = [rows]
        if rows in (None, "") and total == 0:
            rows = []
        if not isinstance(rows, list) or len(rows) != min(page_size, max(0, total - (page - 1) * page_size)):
            raise CollectionError("PAGE_LENGTH_MISMATCH")
        records = tuple(normalize_store(row, industry, source_reference_month=month) for row in rows)
        yield Page(page, total, records, raw, periods)
        if probe or page * page_size >= total:
            return
        page += 1
