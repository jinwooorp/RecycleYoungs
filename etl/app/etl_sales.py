from .config import DATA_DIR
from .utils import find_file, read_csv, clean_text, clean_int
from .loaders import upsert_rows
from .industry import load_industry_map

SALES_AMOUNT_FIELDS = [
    ("당월_매출_금액", "sales_amount"),
    ("주중_매출_금액", "weekday_sales_amount"),
    ("주말_매출_금액", "weekend_sales_amount"),
    ("월요일_매출_금액", "mon_sales_amount"),
    ("화요일_매출_금액", "tue_sales_amount"),
    ("수요일_매출_금액", "wed_sales_amount"),
    ("목요일_매출_금액", "thu_sales_amount"),
    ("금요일_매출_금액", "fri_sales_amount"),
    ("토요일_매출_금액", "sat_sales_amount"),
    ("일요일_매출_금액", "sun_sales_amount"),
    ("시간대_00~06_매출_금액", "time_00_06_sales"),
    ("시간대_06~11_매출_금액", "time_06_11_sales"),
    ("시간대_11~14_매출_금액", "time_11_14_sales"),
    ("시간대_14~17_매출_금액", "time_14_17_sales"),
    ("시간대_17~21_매출_금액", "time_17_21_sales"),
    ("시간대_21~24_매출_금액", "time_21_24_sales"),
    ("남성_매출_금액", "male_sales"),
    ("여성_매출_금액", "female_sales"),
    ("연령대_10_매출_금액", "age_10_sales"),
    ("연령대_20_매출_금액", "age_20_sales"),
    ("연령대_30_매출_금액", "age_30_sales"),
    ("연령대_40_매출_금액", "age_40_sales"),
    ("연령대_50_매출_금액", "age_50_sales"),
    ("연령대_60_이상_매출_금액", "age_60_plus_sales"),
]

TRANSACTION_FIELDS = [
    ("당월_매출_건수", "transaction_count"),
    ("주중_매출_건수", "weekday_transactions"),
    ("주말_매출_건수", "weekend_transactions"),
    ("월요일_매출_건수", "mon_transactions"),
    ("화요일_매출_건수", "tue_transactions"),
    ("수요일_매출_건수", "wed_transactions"),
    ("목요일_매출_건수", "thu_transactions"),
    ("금요일_매출_건수", "fri_transactions"),
    ("토요일_매출_건수", "sat_transactions"),
    ("일요일_매출_건수", "sun_transactions"),
    ("시간대_건수~06_매출_건수", "time_00_06_transactions"),
    ("시간대_건수~11_매출_건수", "time_06_11_transactions"),
    ("시간대_건수~14_매출_건수", "time_11_14_transactions"),
    ("시간대_건수~17_매출_건수", "time_14_17_transactions"),
    ("시간대_건수~21_매출_건수", "time_17_21_transactions"),
    ("시간대_건수~24_매출_건수", "time_21_24_transactions"),
    ("남성_매출_건수", "male_transactions"),
    ("여성_매출_건수", "female_transactions"),
    ("연령대_10_매출_건수", "age_10_transactions"),
    ("연령대_20_매출_건수", "age_20_transactions"),
    ("연령대_30_매출_건수", "age_30_transactions"),
    ("연령대_40_매출_건수", "age_40_transactions"),
    ("연령대_50_매출_건수", "age_50_transactions"),
    ("연령대_60_이상_매출_건수", "age_60_plus_transactions"),
]

def _value(r, col):
    return clean_int(r[col])

FILE_DONG = "서울시 상권분석서비스(추정매출-행정동)_2025년.csv"
FILE_AREA = "서울시 상권분석서비스(추정매출-상권)_2025년.csv"
REQUIRED_COMMON = [
    "기준_년분기_코드", "서비스_업종_코드", "서비스_업종_코드_명",
] + [src for src, _ in SALES_AMOUNT_FIELDS + TRANSACTION_FIELDS]


def run_dong(conn, path=None):
    path = path or find_file(DATA_DIR, FILE_DONG)
    df = read_csv(path)
    industry_map = load_industry_map(conn)

    rows = []
    for _, r in df.iterrows():
        code = clean_text(r["서비스_업종_코드"])
        base = [
            clean_int(r["기준_년분기_코드"]),
            clean_text(r["행정동_코드"]),
            clean_text(r["행정동_코드_명"]),
            code,
            clean_text(r["서비스_업종_코드_명"]),
            industry_map.get(("SEOUL", code)),
        ]
        rows.append(tuple(base + [
            _value(r, src) for src, _ in SALES_AMOUNT_FIELDS
        ] + [
            _value(r, src) for src, _ in TRANSACTION_FIELDS
        ]))

    columns = [
        "quarter_code","dong_code","dong_name","source_industry_code",
        "source_industry_name","industry_id"
    ] + [dst for _, dst in SALES_AMOUNT_FIELDS] + [dst for _, dst in TRANSACTION_FIELDS]

    with conn.cursor() as cur:
        cur.execute("DELETE FROM sales_dong WHERE quarter_code BETWEEN 20251 AND 20254")
    count = upsert_rows(
        conn, "sales_dong", columns, rows,
        ["quarter_code","dong_code","source_industry_code"]
    )
    print(f"[sales_dong] {count:,} rows prepared (commit pending)")

def run_commercial_area(conn, path=None):
    path = path or find_file(DATA_DIR, FILE_AREA)
    df = read_csv(path)
    industry_map = load_industry_map(conn)

    rows = []
    for _, r in df.iterrows():
        code = clean_text(r["서비스_업종_코드"])
        base = [
            clean_int(r["기준_년분기_코드"]),
            clean_text(r["상권_코드"]),
            clean_text(r["상권_코드_명"]),
            code,
            clean_text(r["서비스_업종_코드_명"]),
            industry_map.get(("SEOUL", code)),
        ]
        rows.append(tuple(base + [
            _value(r, src) for src, _ in SALES_AMOUNT_FIELDS
        ] + [
            _value(r, src) for src, _ in TRANSACTION_FIELDS
        ]))

    columns = [
        "quarter_code","commercial_area_code","commercial_area_name",
        "source_industry_code","source_industry_name","industry_id"
    ] + [dst for _, dst in SALES_AMOUNT_FIELDS] + [dst for _, dst in TRANSACTION_FIELDS]

    with conn.cursor() as cur:
        cur.execute("DELETE FROM sales_commercial_area WHERE quarter_code BETWEEN 20251 AND 20254")
    count = upsert_rows(
        conn, "sales_commercial_area", columns, rows,
        ["quarter_code","commercial_area_code","source_industry_code"]
    )
    print(f"[sales_commercial_area] {count:,} rows prepared (commit pending)")
