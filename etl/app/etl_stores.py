from psycopg.rows import dict_row
from .config import DATA_DIR, STORE_CHUNK_SIZE
from .utils import find_file, read_csv, clean_text, clean_float
from .loaders import copy_rows
from .industry import load_industry_map

FILE = "소상공인시장진흥공단_상가(상권)정보_서울_202606.csv"

USECOLS = [
    "상가업소번호","상호명","지점명",
    "상권업종대분류코드","상권업종대분류명",
    "상권업종중분류코드","상권업종중분류명",
    "상권업종소분류코드","상권업종소분류명",
    "표준산업분류코드","표준산업분류명",
    "시군구코드","시군구명",
    "행정동코드","행정동명",
    "법정동코드","법정동명",
    "지번주소","도로명주소",
    "경도","위도"
]

COLUMNS = [
    "source_store_id","name","branch_name",
    "source_large_category_code","source_large_category_name",
    "source_medium_category_code","source_medium_category_name",
    "source_small_category_code","source_small_category_name",
    "source_standard_industry_code","source_standard_industry_name",
    "industry_id",
    "sigungu_code","sigungu_name",
    "dong_code","dong_name",
    "legal_dong_code","legal_dong_name",
    "jibun_address","road_address",
    "longitude","latitude","location"
]

def run(conn, path=None):
    path = path or find_file(DATA_DIR, FILE)

    industry_map = load_industry_map(conn)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT id FROM industries WHERE code = 'CAFE'")
        cafe = cur.fetchone()
        if cafe is None:
            raise ValueError("점포 적재 전 CAFE industry가 필요합니다.")
        mapped_cafe_id = industry_map.get(("SEMAS", "I21201"))
        if mapped_cafe_id is None:
            raise ValueError("점포 적재 전 SEMAS/I21201 mapping이 필요합니다. V3 적용 상태를 확인하세요.")
        if mapped_cafe_id != cafe["id"]:
            raise ValueError("SEMAS/I21201 mapping이 CAFE industry_id와 일치하지 않습니다.")
        cur.execute("TRUNCATE stores RESTART IDENTITY")
    chunks = read_csv(
        path,
        encoding="utf-8-sig",
        usecols=USECOLS,
        chunksize=STORE_CHUNK_SIZE,
    )

    total = 0
    for df in chunks:
        rows = []

        for _, r in df.iterrows():
            source_small_category_code = clean_text(r["상권업종소분류코드"])
            rows.append((
                clean_text(r["상가업소번호"]),
                clean_text(r["상호명"]),
                clean_text(r["지점명"]),
                clean_text(r["상권업종대분류코드"]),
                clean_text(r["상권업종대분류명"]),
                clean_text(r["상권업종중분류코드"]),
                clean_text(r["상권업종중분류명"]),
                source_small_category_code,
                clean_text(r["상권업종소분류명"]),
                clean_text(r["표준산업분류코드"]),
                clean_text(r["표준산업분류명"]),
                industry_map.get(("SEMAS", source_small_category_code)),
                clean_text(r["시군구코드"]),
                clean_text(r["시군구명"]),
                clean_text(r["행정동코드"]),
                clean_text(r["행정동명"]),
                clean_text(r["법정동코드"]),
                clean_text(r["법정동명"]),
                clean_text(r["지번주소"]),
                clean_text(r["도로명주소"]),
                clean_float(r["경도"]),
                clean_float(r["위도"]),
            ))

        # PostGIS geometry는 EWKT로, 빈 값은 Python None으로 전달한다.
        def with_location():
            for row in rows:
                lon, lat = row[-2], row[-1]
                if lon is not None and not -180 <= lon <= 180:
                    raise ValueError(f"점포 {row[0]}: 경도 범위 오류 {lon}")
                if lat is not None and not -90 <= lat <= 90:
                    raise ValueError(f"점포 {row[0]}: 위도 범위 오류 {lat}")
                location = (
                    f"SRID=4326;POINT({lon} {lat})"
                    if lon is not None and lat is not None else None
                )
                yield (*row, location)

        total += copy_rows(conn, "stores", COLUMNS, with_location())
        print(f"[stores] {total:,} rows prepared (commit pending)")

    print(f"[stores] DONE: {total:,} rows prepared (commit pending)")
