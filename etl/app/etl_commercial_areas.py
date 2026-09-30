from pyproj import Transformer
from .config import DATA_DIR, AREA_SOURCE_CRS
from .utils import find_file, read_csv, clean_text, clean_float

FILE = "서울시 상권분석서비스(영역-상권).csv"
REQUIRED = [
    "상권_구분_코드", "상권_구분_코드_명", "상권_코드",
    "상권_코드_명", "엑스좌표_값", "와이좌표_값",
    "자치구_코드", "자치구_코드_명",
    "행정동_코드", "행정동_코드_명", "영역_면적",
]

def run(conn, path=None):
    if not AREA_SOURCE_CRS:
        raise ValueError("상권 좌표 적재 전 원본 좌표계를 확인해 AREA_SOURCE_CRS를 설정하세요.")
    path = path or find_file(DATA_DIR, FILE)
    df = read_csv(path)

    transformer = Transformer.from_crs(
        AREA_SOURCE_CRS, "EPSG:4326", always_xy=True
    )

    rows = []
    for _, r in df.iterrows():
        x = clean_float(r["엑스좌표_값"])
        y = clean_float(r["와이좌표_값"])
        lon = lat = None
        if x is not None and y is not None:
            lon, lat = transformer.transform(x, y, errcheck=True)

        rows.append((
            clean_text(r["상권_코드"]),
            clean_text(r["상권_구분_코드"]),
            clean_text(r["상권_구분_코드_명"]),
            clean_text(r["상권_코드_명"]),
            clean_text(r["자치구_코드"]),
            clean_text(r["자치구_코드_명"]),
            clean_text(r["행정동_코드"]),
            clean_text(r["행정동_코드_명"]),
            clean_float(r["영역_면적"]),
            x, y,
            lon, lat,
        ))

    # x/y 원본 좌표와 변환된 경위도를 DB에 같이 보관한다.
    with conn.cursor() as cur:
        cur.execute("TRUNCATE commercial_areas RESTART IDENTITY")

    # 상권은 소량이므로 PostGIS 좌표 생성과 함께 직접 INSERT한다.
    sql = """
        INSERT INTO commercial_areas
        (commercial_area_code, area_type_code, area_type_name, name,
         sigungu_code, sigungu_name, dong_code, dong_name,
         area_m2, x, y, location)
        VALUES (
         %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
         CASE WHEN %s::double precision IS NULL OR %s::double precision IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint(%s,%s),4326) END
        )
        ON CONFLICT (commercial_area_code) DO UPDATE SET
          area_type_code=EXCLUDED.area_type_code,
          area_type_name=EXCLUDED.area_type_name,
          name=EXCLUDED.name,
          sigungu_code=EXCLUDED.sigungu_code,
          sigungu_name=EXCLUDED.sigungu_name,
          dong_code=EXCLUDED.dong_code,
          dong_name=EXCLUDED.dong_name,
          area_m2=EXCLUDED.area_m2,
          x=EXCLUDED.x,
          y=EXCLUDED.y,
          location=EXCLUDED.location
    """

    with conn.cursor() as cur:
        for row in rows:
            lon, lat = row[11], row[12]
            cur.execute(sql, (
                *row[:11],
                lon, lat, lon, lat
            ))
    print(f"[commercial_areas] {len(rows):,} rows prepared (commit pending)")
