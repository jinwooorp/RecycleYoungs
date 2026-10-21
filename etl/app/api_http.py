"""Small GET-only transport: no redirects, URL logging, or insecure fallback."""
from decimal import Decimal
from http.client import IncompleteRead
import json
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .api_records import CollectionError

MAX_BYTES = 16 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, timeout):
    opener = build_opener(NoRedirect())
    try:
        with opener.open(Request(url, headers={"Accept": "application/json"}), timeout=timeout) as response:
            body = response.read(MAX_BYTES + 1)
            return response.status, body
    except HTTPError as error:
        status = error.code
        error.close()
        return status, b""  # Never propagate the error URL or upstream error body.


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CollectionError("DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def invalid_constant(value):
    raise CollectionError("NONFINITE_JSON_NUMBER")


class HttpClient:
    def __init__(self, *, transport=request, sleep=time.sleep):
        self.transport = transport
        self.sleep = sleep

    def get_json(self, url, *, secret):
        for attempt in range(3):
            try:
                status, raw = self.transport(url, 20)
            except (URLError, OSError, TimeoutError, IncompleteRead):
                status, raw = 503, b""
            if status in (429, 500, 502, 503, 504):
                if attempt < 2:
                    self.sleep(2 ** attempt)
                    continue
                raise CollectionError("HTTP_RETRIES_EXHAUSTED") from None
            if status != 200:
                raise CollectionError("HTTP_REQUEST_REJECTED")
            if not isinstance(raw, bytes) or len(raw) > MAX_BYTES:
                raise CollectionError("RESPONSE_TOO_LARGE")
            try:
                decoded = raw.decode("utf-8-sig")
                data = json.loads(decoded, parse_float=Decimal, parse_constant=invalid_constant,
                                  object_pairs_hook=unique_object)
            except (UnicodeError, json.JSONDecodeError, RecursionError):
                raise CollectionError("INVALID_JSON_RESPONSE") from None
            if not isinstance(data, dict):
                raise CollectionError("INVALID_JSON_ENVELOPE")
            if secret and (secret in decoded or quote(secret, safe="") in decoded
                           or secret in json.dumps(data, ensure_ascii=False, default=str)):
                raise CollectionError("RESPONSE_CONTAINS_CREDENTIAL")
            return data, raw
        raise CollectionError("HTTP_RETRIES_EXHAUSTED")
