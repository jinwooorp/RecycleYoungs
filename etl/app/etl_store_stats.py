from .config import DATA_DIR
from .utils import find_file, read_csv, clean_text, clean_int, clean_float
from .loaders import upsert_rows
from .industry import load_industry_map

FILE = "서울시 상권분석서비스(점포-행정동)_2025년.csv"
REQUIRED = [
    "기준_년분기_코드", "행정동_코드", "행정동_코드_명",
    "서비스_업종_코드", "서비스_업종_코드_명", "점포_수",
    "유사_업종_점포_수", "개업_율", "개업_점포_수",
    "폐업_률", "폐업_점포_수", "프랜차이즈_점포_수",
]

def run(conn, path=None):
    path = path or find_file(DATA_DIR, FILE)
    df = read_csv(path)
    industry_map = load_industry_map(conn)

    rows = []
    for _, r in df.iterrows():
        code = clean_text(r["서비스_업종_코드"])
        rows.append((
            clean_int(r["기준_년분기_코드"]),
            clean_text(r["행정동_코드"]),
            clean_text(r["행정동_코드_명"]),
            code,
            clean_text(r["서비스_업종_코드_명"]),
            industry_map.get(("SEOUL", code)),
            clean_int(r["점포_수"]),
            clean_int(r["유사_업종_점포_수"]),
            clean_float(r["개업_율"]),
            clean_int(r["개업_점포_수"]),
            clean_float(r["폐업_률"]),
            clean_int(r["폐업_점포_수"]),
            clean_int(r["프랜차이즈_점포_수"]),
        ))

    columns = [
        "quarter_code","dong_code","dong_name","source_industry_code",
        "source_industry_name","industry_id","store_count",
        "similar_store_count","opening_rate","opening_store_count",
        "closing_rate","closing_store_count","franchise_store_count"
    ]

    # 재실행 가능한 ETL을 위해 해당 연도 데이터만 비운다.
    with conn.cursor() as cur:
        cur.execute("DELETE FROM store_stats_dong WHERE quarter_code BETWEEN 20251 AND 20254")
    count = upsert_rows(
        conn, "store_stats_dong", columns, rows,
        ["quarter_code","dong_code","source_industry_code"]
    )
    print(f"[store_stats_dong] {count:,} rows prepared (commit pending)")
