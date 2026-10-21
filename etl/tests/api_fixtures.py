"""Synthetic public API responses; no source files, secrets, or DB access."""
import json


def stats(**changes):
    row = dict(STDR_YYQU_CD="20251", ADSTRD_CD="11110515",
               ADSTRD_CD_NM="합성동", SVC_INDUTY_CD="CS100010",
               SVC_INDUTY_CD_NM="합성업종", STOR_CO="10",
               SIMILR_INDUTY_STOR_CO="12", FRC_STOR_CO="2",
               OPBIZ_RT="1.25", OPBIZ_STOR_CO="1",
               CLSBIZ_RT="0", CLSBIZ_STOR_CO="0")
    return row | changes


def sales(**changes):
    row = {k: v for k, v in stats().items() if k in
           ("STDR_YYQU_CD", "ADSTRD_CD", "ADSTRD_CD_NM",
            "SVC_INDUTY_CD", "SVC_INDUTY_CD_NM")}
    prefixes = ["THSMON", "MDWK", "WKEND", "MON", "TUES", "WED", "THUR",
                "FRI", "SAT", "SUN", "TMZON_00_06", "TMZON_06_11",
                "TMZON_11_14", "TMZON_14_17", "TMZON_17_21", "TMZON_21_24",
                "ML", "FML", "AGRDE_10", "AGRDE_20", "AGRDE_30",
                "AGRDE_40", "AGRDE_50", "AGRDE_60_ABOVE"]
    row.update({p + "_SELNG_" + suffix: "0" for p in prefixes for suffix in ("AMT", "CO")})
    return row | changes


def store(**changes):
    return dict(bizesId="000001", bizesNm="합성카페", brchNm="",
                indsLclsCd="I2", indsLclsNm="음식", indsMclsCd="I212",
                indsMclsNm="음료", indsSclsCd="I21201", indsSclsNm="카페",
                ksicCd="56221", ksicNm="커피", ctprvnCd="11",
                signguCd="11110", signguNm="합성구", adongCd="1111051500",
                adongNm="합성동", ldongCd="1111010100", ldongNm="합성동",
                lnoAdr="합성 주소", rdnmAdr="합성 도로", lon="126.97",
                lat="37.58", stdrYm="202606") | changes


class FakeClient:
    def __init__(self, *payloads):
        self.payloads = list(payloads)
        self.calls = []

    def get_json(self, url, *, secret):
        self.calls.append(url)
        payload = self.payloads.pop(0)
        return payload, json.dumps(payload, ensure_ascii=False).encode()


def seoul(rows, total=None, service="VwsmAdstrdStorW"):
    return {service: {"RESULT": {"CODE": "INFO-000"},
                      "list_total_count": len(rows) if total is None else total,
                      "row": rows}}


def semas(rows, total=None, page=1, size=2):
    period = rows[0].get("stdrYm", "202606") if rows else "202606"
    items = [{k: v for k, v in row.items() if k != "stdrYm"} for row in rows]
    return {"header": {"resultCode": "00", "stdrYm": period}, "body": {
        "items": items, "totalCount": len(rows) if total is None else total,
        "pageNo": page, "numOfRows": size}}
