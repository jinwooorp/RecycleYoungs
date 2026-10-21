"""DB-independent source normalization. Numeric output is exact decimal text."""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import re

NORMALIZER_VERSION = 2


class CollectionError(ValueError):
    """Only fixed, non-sensitive error codes may cross the CLI boundary."""


@dataclass(frozen=True)
class Page:
    number: int
    total: int
    records: tuple[dict, ...]
    raw: bytes
    source_periods: tuple[str, ...] = ()


SEOUL_INDUSTRIES = {"CS100010": "CAFE", "CS200028": "HAIR",
                    "CS100001": "KFOOD", "CS100009": "PUB"}
COMMON = {"STDR_YYQU_CD": "quarter_code", "ADSTRD_CD": "dong_code",
          "ADSTRD_CD_NM": "dong_name", "SVC_INDUTY_CD": "source_industry_code",
          "SVC_INDUTY_CD_NM": "source_industry_name"}
STORE_COUNTS = {"STOR_CO": "store_count", "SIMILR_INDUTY_STOR_CO": "similar_store_count",
                "FRC_STOR_CO": "franchise_store_count", "OPBIZ_STOR_CO": "opening_store_count",
                "CLSBIZ_STOR_CO": "closing_store_count"}
SALES = {"THSMON_SELNG_AMT": "sales_amount", "THSMON_SELNG_CO": "transaction_count"}
for source, target in [("MDWK", "weekday"), ("WKEND", "weekend"), ("MON", "mon"),
                       ("TUES", "tue"), ("WED", "wed"), ("THUR", "thu"),
                       ("FRI", "fri"), ("SAT", "sat"), ("SUN", "sun")]:
    SALES[source + "_SELNG_AMT"] = target + "_sales_amount"
    SALES[source + "_SELNG_CO"] = target + "_transactions"
for source, target in ([("TMZON_" + s, "time_" + s) for s in
                        ("00_06", "06_11", "11_14", "14_17", "17_21", "21_24")]
                       + [("ML", "male"), ("FML", "female")]
                       + [("AGRDE_" + s, "age_" + s) for s in ("10", "20", "30", "40", "50")]
                       + [("AGRDE_60_ABOVE", "age_60_plus")]):
    SALES[source + "_SELNG_AMT"] = target + "_sales"
    SALES[source + "_SELNG_CO"] = target + "_transactions"
SEMAS = {"bizesId": "source_store_id", "bizesNm": "name", "brchNm": "branch_name",
         "ksicCd": "source_standard_industry_code", "ksicNm": "source_standard_industry_name",
         "signguCd": "sigungu_code", "signguNm": "sigungu_name", "adongCd": "dong_code",
         "adongNm": "dong_name", "ldongCd": "legal_dong_code", "ldongNm": "legal_dong_name",
         "lnoAdr": "jibun_address", "rdnmAdr": "road_address"}
for prefix, target in [("Lcls", "large"), ("Mcls", "medium"), ("Scls", "small")]:
    SEMAS["inds" + prefix + "Cd"] = "source_" + target + "_category_code"
    SEMAS["inds" + prefix + "Nm"] = "source_" + target + "_category_name"


def required(row, keys):
    if not isinstance(row, dict) or not set(keys).issubset(row):
        raise CollectionError("SCHEMA_MISMATCH")


def text(value, *, nullable=True):
    if value is None or value == "":
        if nullable:
            return None
        raise CollectionError("MISSING_VALUE")
    if not isinstance(value, str):
        raise CollectionError("INVALID_TEXT")
    normalized = value.strip()
    if not normalized:
        if nullable:
            return None
        raise CollectionError("MISSING_VALUE")
    return normalized  # Same outer-whitespace rule as legacy clean_text; preserve punctuation and identifier zeroes.


def number(value, *, nullable=True):
    if value is None or value == "":
        if nullable:
            return None
        raise CollectionError("MISSING_NUMBER")
    if isinstance(value, (bool, float)) or not isinstance(value, (str, int, Decimal)):
        raise CollectionError("INVALID_NUMBER")
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise CollectionError("INVALID_NUMBER") from None
    if not result.is_finite():
        raise CollectionError("NONFINITE_NUMBER")
    return result


def integer(value):
    result = number(value, nullable=False)
    if result != result.to_integral_value() or not 0 <= result <= 9223372036854775807:
        raise CollectionError("INVALID_INTEGER")
    return int(result)


def bigint(value):
    return None if value is None or value == "" else str(integer(value))


def quarter(value):
    if not isinstance(value, str) or not re.fullmatch(r"[12]\d{3}[1-4]", value):
        raise CollectionError("INVALID_QUARTER")
    return value


def common(row, expected):
    quarter(expected)
    required(row, COMMON)
    result = {target: text(row[source], nullable=False) for source, target in COMMON.items()}
    if result["quarter_code"] != expected:
        raise CollectionError("QUARTER_MISMATCH")
    if not re.fullmatch(r"\d{8}", result["dong_code"]):
        raise CollectionError("INVALID_DONG_CODE")
    if not re.fullmatch(r"CS\d{6}", result["source_industry_code"]):
        raise CollectionError("INVALID_INDUSTRY_CODE")
    result["industry_code"] = SEOUL_INDUSTRIES.get(result["source_industry_code"])
    return result


def normalize_store_stats(row, expected):
    result = common(row, expected)
    required(row, set(STORE_COUNTS) | {"OPBIZ_RT", "CLSBIZ_RT"})
    result.update({target: bigint(row[source]) for source, target in STORE_COUNTS.items()})
    for source, target in [("OPBIZ_RT", "opening_rate"), ("CLSBIZ_RT", "closing_rate")]:
        rate = number(row[source])
        if rate is not None and rate < 0:
            raise CollectionError("INVALID_RATE")
        result[target] = str(rate) if rate is not None else None
    return result


def normalize_sales(row, expected):
    result = common(row, expected)
    required(row, SALES)
    result.update({target: bigint(row[source]) for source, target in SALES.items()})
    return result


def reference_month(value):
    month = text(value, nullable=False)
    if not re.fullmatch(r"[12]\d{3}(0[1-9]|1[0-2])", month):
        raise CollectionError("INVALID_REFERENCE_MONTH")
    return month


def normalize_store(row, industry=None, *, source_reference_month=None):
    required(row, set(SEMAS) | {"ctprvnCd", "lon", "lat"})
    result = {target: text(row[source]) for source, target in SEMAS.items()}
    text(result["source_store_id"], nullable=False)
    text(result["name"], nullable=False)
    if text(row["ctprvnCd"], nullable=False) != "11" or not (result["sigungu_code"] or "").startswith("11"):
        raise CollectionError("REGION_MISMATCH")
    if industry is not None and result["source_small_category_code"] != industry:
        raise CollectionError("INDUSTRY_MISMATCH")
    month = reference_month(source_reference_month if source_reference_month is not None else row.get("stdrYm"))
    if source_reference_month is not None and "stdrYm" in row and reference_month(row["stdrYm"]) != month:
        raise CollectionError("SOURCE_REFERENCE_CONFLICT")
    lon, lat = number(row["lon"]), number(row["lat"])
    if (lon is not None and not -180 <= lon <= 180) or (lat is not None and not -90 <= lat <= 90):
        raise CollectionError("INVALID_COORDINATES")
    result.update(longitude=str(lon) if lon is not None else None,
                  latitude=str(lat) if lat is not None else None,
                  location=f"SRID=4326;POINT({lon} {lat})" if lon is not None and lat is not None else None,
                  source_reference_month=month,
                  industry_code="CAFE" if result["source_small_category_code"] == "I21201" else None)
    return result
