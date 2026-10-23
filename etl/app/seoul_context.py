"""DB-free, all-period Seoul context snapshots; no release or score authority."""
from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, localcontext
import re
from urllib.parse import quote

from .api_records import CollectionError, Page, bigint, integer, number, quarter, required, text

CONTEXT_NORMALIZER_VERSION = 1
AGES = ("10", "20", "30", "40", "50", "60_ABOVE")
TIMES = ("00_06", "06_11", "11_14", "14_17", "17_21", "21_24")
DAYS = ("MON", "TUES", "WED", "THUR", "FRI", "SAT", "SUN")
COMMON_FIELDS = ("STDR_YYQU_CD", "ADSTRD_CD", "ADSTRD_CD_NM")


@dataclass(frozen=True)
class Source:
    service: str
    dataset: str
    numeric_fields: tuple[str, ...]
    text_fields: tuple[str, ...] = ()
    integer_fields: tuple[str, ...] = ()
    annual: bool = False
    period_filter: bool = False


def population_fields(suffix, *, detailed=False):
    fields = tuple(p + "_" + suffix for p in ("TOT", "ML", "FML"))
    fields += tuple("AGRDE_" + age + "_" + suffix for age in AGES)
    if detailed:
        fields += tuple(sex + "_" + age + "_" + suffix for sex in ("MAG", "FAG") for age in AGES)
    return fields


FACILITIES = ("VIATR_FCLTY_CO", "PBLOFC_CO", "BANK_CO", "GEHSPT_CO", "GNRL_HSPTL_CO",
              "PARMACY_CO", "KNDRGR_CO", "ELESCH_CO", "MSKUL_CO", "HGSCHL_CO", "UNIV_CO",
              "DRTS_CO", "SUPMK_CO", "THEAT_CO", "STAYNG_FCLTY_CO", "ARPRT_CO",
              "RLROAD_STATN_CO", "BUS_TRMINL_CO", "SUBWAY_STATN_CO", "BUS_STTN_CO")
CONSUMPTION = ("EXPNDTR_TOTAMT",) + tuple(p + "_EXPNDTR_TOTAMT" for p in
    ("FDSTFFS", "CLTHS_FTWR", "LVSPL", "MCP", "TRNSPORT", "EDC", "PLESR", "LSR_CLTUR", "ETC", "FD"))
APARTMENT_COUNTS = ("APT_HSMP_CO", "AE_66_SQMT_BELO_HSHLD_CO") + tuple(
    "AE_" + area + "_SQMT_HSHLD_CO" for area in ("66", "99", "132", "165")) + (
    "PC_1_HDMIL_BELO_HSHLD_CO",) + tuple("PC_" + p + "_HDMIL_HSHLD_CO" for p in
    ("1", "2", "3", "4", "5")) + ("PC_6_HDMIL_ABOVE_HSHLD_CO",)
SOURCES = {
    "seoul-population": Source("VwsmAdstrdFlpopW", "OA-22178", population_fields("FLPOP_CO")
        + tuple("TMZON_" + t + "_FLPOP_CO" for t in TIMES) + tuple(d + "_FLPOP_CO" for d in DAYS)),
    "seoul-residents": Source("VwsmAdstrdRepopW", "OA-22183", population_fields("REPOP_CO", detailed=True)
        + ("TOT_HSHLD_CO", "APT_HSHLD_CO", "NON_APT_HSHLD_CO"), annual=True),
    "seoul-workers": Source("VwsmAdstrdWrcPopltnW", "OA-22184", population_fields("WRC_POPLTN_CO", detailed=True),
        annual=True, period_filter=True),
    "seoul-facilities": Source("VwsmAdstrdFcltyW", "OA-22169", FACILITIES,
        integer_fields=FACILITIES, annual=True),
    "seoul-change": Source("VwsmAdstrdIxQq", "OA-15575", ("OPR_SALE_MT_AVRG", "CLS_SALE_MT_AVRG",
        "SU_OPR_SALE_MT_AVRG", "SU_CLS_SALE_MT_AVRG"), ("TRDAR_CHNGE_IX", "TRDAR_CHNGE_IX_NM")),
    "seoul-consumption": Source("VwsmAdstrdNcmCnsmpW", "OA-22166", CONSUMPTION,
        integer_fields=CONSUMPTION, annual=True),
    "seoul-apartments": Source("VwsmAdstrdAptW", "OA-22163", APARTMENT_COUNTS + ("AVRG_AE", "AVRG_MKTC"),
        integer_fields=APARTMENT_COUNTS, annual=True),
}


def specification(source, period=None):
    if source not in SOURCES:
        raise CollectionError("INVALID_CONTEXT_SOURCE")
    spec = SOURCES[source]
    if period is not None:
        quarter(period)
        if not spec.period_filter:
            raise CollectionError("CONTEXT_PERIOD_FILTER_UNSUPPORTED")
    return spec


def exact_metric(value, *, integral=False):
    result = number(value)
    if result is None:
        return None
    # Bound both output size and arithmetic; never silently round Decimal values.
    if result < 0 or result > Decimal("9223372036854775807") or result.as_tuple().exponent < -12:
        raise CollectionError("INVALID_CONTEXT_NUMBER")
    return bigint(result) if integral else format(result, "f")


def normalize(source, row):
    spec = specification(source)
    identity = row_identity(source, row)
    return identity | dict(metrics={k: exact_metric(row[k], integral=k in spec.integer_fields) for k in spec.numeric_fields},
                           attributes={k: text(row[k]) for k in spec.text_fields})


def row_identity(source, row):
    spec = specification(source)
    fields = set(COMMON_FIELDS + spec.numeric_fields + spec.text_fields)
    required(row, fields)
    if set(row) != fields:
        raise CollectionError("CONTEXT_SCHEMA_CHANGED")
    period = quarter(text(row["STDR_YYQU_CD"], nullable=False))
    code = text(row["ADSTRD_CD"], nullable=False)
    if not re.fullmatch(r"11\d{6}", code):
        raise CollectionError("INVALID_CONTEXT_DONG_CODE")
    return dict(quarter_code=period, dong_code=code, dong_name=text(row["ADSTRD_CD_NM"], nullable=False))


@dataclass(frozen=True)
class ContextPage(Page):
    quarantined: tuple[dict, ...] = ()


def quarantine_consumption(row):
    """Keep only identity/error references; the original bad values stay in the raw page."""
    identity = row_identity("seoul-consumption", row)
    negative = []
    for field in CONSUMPTION:
        value = number(row[field])
        if value is not None and value < 0:
            # Validate magnitude and integrality, without admitting this value to normalized data.
            exact_metric(value.copy_abs(), integral=True)
            negative.append(field)
        else:
            exact_metric(value, integral=True)
    if not negative:
        raise CollectionError("INVALID_CONTEXT_NUMBER")
    return identity | dict(error="NEGATIVE_SOURCE_VALUE", fields=negative)


def pages(client, source, key, *, period=None, page_size=1000, probe=False, allow_http=False,
          quarantine_negative=False):
    spec = specification(source, period)
    if quarantine_negative and source != "seoul-consumption":
        raise CollectionError("CONTEXT_QUARANTINE_SCOPE_UNSUPPORTED")
    if type(page_size) is not int or not 1 <= page_size <= 1000:
        raise CollectionError("INVALID_CONTEXT_PAGE_SIZE")
    if not key or (key == "sample" and (not probe or page_size > 5)):
        raise CollectionError("INVALID_SEOUL_KEY_SCOPE")
    base = "http://openapi.seoul.go.kr:8088" if allow_http else "https://openapi.seoul.go.kr:8088"
    expected_total, start = None, 1
    while True:
        end = start + page_size - 1
        url = f"{base}/{quote(key, safe='')}/json/{spec.service}/{start}/{end}/{period or ''}"
        data, raw = client.get_json(url, secret=key)
        envelope = data.get(spec.service, data)
        required(envelope, ("RESULT",)); required(envelope["RESULT"], ("CODE",))
        code = envelope["RESULT"]["CODE"]
        if code == "INFO-200" and expected_total is None:
            yield Page(1, 0, (), raw)
            return
        if code != "INFO-000":
            raise CollectionError("SEOUL_API_ERROR")
        required(envelope, ("list_total_count", "row"))
        total = integer(envelope["list_total_count"]); rows = envelope["row"]
        if not isinstance(rows, list) or (not probe and total > page_size * 10000):
            raise CollectionError("INVALID_SEOUL_PAGE")
        if expected_total is not None and expected_total != total:
            raise CollectionError("SOURCE_TOTAL_CHANGED")
        expected_total = total
        if len(rows) != min(page_size, max(0, total - start + 1)):
            raise CollectionError("PAGE_LENGTH_MISMATCH")
        records, quarantined = [], []
        for row in rows:
            try:
                records.append(normalize(source, row))
            except CollectionError as error:
                if not quarantine_negative or str(error) != "INVALID_CONTEXT_NUMBER":
                    raise
                quarantined.append(quarantine_consumption(row))
        if period is not None and any(row["quarter_code"] != period for row in records):
            raise CollectionError("QUARTER_MISMATCH")
        yield ContextPage((start - 1) // page_size + 1, total, tuple(records), raw,
                          tuple(sorted({r["quarter_code"] for r in records + quarantined})), tuple(quarantined))
        if probe or end >= total:
            return
        start = end + 1


def reconciliation_groups(source):
    suffix = {"seoul-population": "FLPOP_CO", "seoul-residents": "REPOP_CO",
              "seoul-workers": "WRC_POPLTN_CO"}.get(source)
    if suffix:
        groups = {"sex": ("TOT_" + suffix, ("ML_" + suffix, "FML_" + suffix)),
                  "age": ("TOT_" + suffix, tuple("AGRDE_" + a + "_" + suffix for a in AGES))}
        if source == "seoul-population":
            groups.update(time=("TOT_FLPOP_CO", tuple("TMZON_" + t + "_FLPOP_CO" for t in TIMES)),
                          weekday=("TOT_FLPOP_CO", tuple(d + "_FLPOP_CO" for d in DAYS)))
        else:
            groups.update(male_age=("ML_" + suffix, tuple("MAG_" + a + "_" + suffix for a in AGES)),
                          female_age=("FML_" + suffix, tuple("FAG_" + a + "_" + suffix for a in AGES)))
        if source == "seoul-residents":
            groups["households"] = ("TOT_HSHLD_CO", ("APT_HSHLD_CO", "NON_APT_HSHLD_CO"))
        return groups
    if source == "seoul-facilities": return {"facility_categories": (FACILITIES[0], FACILITIES[1:])}
    if source == "seoul-consumption": return {"spending_categories": (CONSUMPTION[0], CONSUMPTION[1:])}
    return {}


def equal_observations(left, right):
    def values(metrics):
        return {k: None if v is None else Decimal(v) for k, v in metrics.items()}
    return left[1] == right[1] and values(left[0]) == values(right[0])


class QualityReport:
    """Profile evidence, never infer closed stores, observation dates, or score readiness."""
    def __init__(self, source):
        self.source = source; self.spec = specification(source)
        self.rows = defaultdict(dict); self.names = defaultdict(set)
        self.quarantined = []
        self.fields = {k: dict(null_count=0, zero_count=0, fractional_count=0, minimum=None, maximum=None)
                       for k in self.spec.numeric_fields}
        self.groups = reconciliation_groups(source)
        self.reconciliations = {k: dict(compared_count=0, incomplete_count=0, mismatch_count=0,
            max_absolute_difference="0") for k in self.groups}

    def observe(self, row):
        period, code = row["quarter_code"], row["dong_code"]
        if code in self.rows[period]: raise CollectionError("DUPLICATE_SOURCE_KEY")
        self.rows[period][code] = (row["metrics"], row["attributes"])
        self.names[code].add(row["dong_name"])
        for k, value in row["metrics"].items():
            f = self.fields[k]
            if value is None: f["null_count"] += 1; continue
            n = Decimal(value)
            f["zero_count"] += n == 0
            f["fractional_count"] += n != n.to_integral_value()
            for target, compare in (("minimum", min), ("maximum", max)):
                f[target] = value if f[target] is None else format(compare(Decimal(f[target]), n), "f")
        # Wider than max 19 integer + 12 fractional digits and up to 20 summands.
        with localcontext() as context:
            context.prec = 50
            for name, (total, parts) in self.groups.items():
                q = self.reconciliations[name]; values = [row["metrics"][k] for k in (total,) + parts]
                if None in values: q["incomplete_count"] += 1; continue
                difference = abs(Decimal(values[0]) - sum((Decimal(v) for v in values[1:]), Decimal(0)))
                q["compared_count"] += 1; q["mismatch_count"] += difference != 0
                q["max_absolute_difference"] = format(max(Decimal(q["max_absolute_difference"]), difference), "f")

    def quarantine(self, row):
        self.quarantined.append(row)

    def finish(self, *, complete, raw_complete=None):
        quarantined_codes = defaultdict(set)
        for row in self.quarantined:
            quarantined_codes[row["quarter_code"]].add(row["dong_code"])
        all_periods = set(self.rows) | set(quarantined_codes)
        union = set().union(*(set(self.rows[p]) | quarantined_codes[p] for p in all_periods)) if all_periods else set()
        periods = {p: dict(row_count=len(self.rows[p]), dong_count=len(self.rows[p]),
                          raw_row_count=len(self.rows[p]) + len(quarantined_codes[p]),
                          quarantined_count=len(quarantined_codes[p]),
                          absent_from_observed_union=sorted(union - set(self.rows[p]) - quarantined_codes[p]))
                   for p in sorted(all_periods)}
        annual = {}
        if self.spec.annual:
            for p, rows in sorted(self.rows.items()):
                previous = str(int(p[:4]) - 1) + "4" if p[-1] == "1" else p[:4] + str(int(p[-1]) - 1)
                if previous not in self.rows: continue
                common = set(rows) & set(self.rows[previous])
                unchanged = sum(equal_observations(rows[c], self.rows[previous][c]) for c in common)
                annual[previous + "->" + p] = dict(compared=len(common), unchanged=unchanged,
                    changed=len(common) - unchanged, expected_annual_repeat=p[-1] != "4")
        warnings = ["OBSERVATION_DATE_AND_UNITS_REQUIRE_SOURCE_REVIEW", "NON_ATOMIC_PAGING_NOT_PROVEN",
                    "HISTORICAL_BOUNDARIES_NOT_VERIFIED", "COVERAGE_USES_OBSERVED_UNION_ONLY"]
        if any(q["mismatch_count"] for q in self.reconciliations.values()): warnings.append("AGGREGATE_COMPONENT_DIFFERENCES")
        conflicts = {code: sorted(names) for code, names in self.names.items() if len(names) > 1}
        if conflicts: warnings.append("DONG_NAME_CHANGES_OR_CONFLICTS")
        if self.spec.annual: warnings.append("ANNUAL_VALUES_MAY_REPEAT_ACROSS_QUARTERS")
        if any(v["expected_annual_repeat"] and v["changed"] for v in annual.values()):
            warnings.append("ANNUAL_REPEAT_EXPECTATION_MISMATCH")
        if any(v["absent_from_observed_union"] for v in periods.values()):
            warnings.append("MISSING_ROWS_FROM_OBSERVED_UNION")
        if self.quarantined: warnings.append("NEGATIVE_CONSUMPTION_ROWS_QUARANTINED")
        return dict(schema_version=1, source=self.source, collection_complete=complete,
                    raw_complete=complete if raw_complete is None else raw_complete,
                    status="QUARANTINED" if self.quarantined else "REVIEW_REQUIRED",
                    score_ready=False, historical_boundary_compatible=False, observation_date=None,
                    coverage_reference="OBSERVED_UNION_NOT_OFFICIAL_EXPECTED", observed_dong_count=len(union),
                    source_periods=sorted(periods), periods=periods, fields=self.fields,
                    reconciliations=self.reconciliations, annual_comparisons=annual,
                    reconciliation_basis="CANDIDATE_GROUPINGS_NOT_CONFIRMED_DEFINITIONS",
                    quarantined_count=len(self.quarantined), quarantined_rows=self.quarantined,
                    quarantined_period_counts={p: len(c) for p, c in sorted(quarantined_codes.items())},
                    name_conflict_count=len(conflicts), name_conflicts=conflicts, warnings=warnings)
