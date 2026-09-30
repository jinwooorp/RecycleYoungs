import argparse
from pathlib import Path
import sys

from pyproj import CRS

from .config import AREA_SOURCE_CRS, DATA_DIR, STORE_CHUNK_SIZE
from .db import get_connection
from . import etl_commercial_areas, etl_store_stats, etl_sales, etl_stores
from .preflight import InputSpec, validate_inputs

QUARTERS_2025 = ("20251", "20252", "20253", "20254")
INPUTS = (
    InputSpec(
        "commercial_areas", etl_commercial_areas.FILE, "cp949",
        tuple(etl_commercial_areas.REQUIRED), ("상권_코드",), ("상권_코드_명",),
    ),
    InputSpec(
        "store_stats_dong", etl_store_stats.FILE, "cp949",
        tuple(etl_store_stats.REQUIRED),
        ("기준_년분기_코드", "행정동_코드", "서비스_업종_코드"),
        ("행정동_코드_명",), QUARTERS_2025,
    ),
    InputSpec(
        "sales_dong", etl_sales.FILE_DONG, "cp949",
        tuple(etl_sales.REQUIRED_COMMON + ["행정동_코드", "행정동_코드_명"]),
        ("기준_년분기_코드", "행정동_코드", "서비스_업종_코드"),
        ("행정동_코드_명",), QUARTERS_2025,
    ),
    InputSpec(
        "sales_commercial_area", etl_sales.FILE_AREA, "cp949",
        tuple(etl_sales.REQUIRED_COMMON + ["상권_코드", "상권_코드_명"]),
        ("기준_년분기_코드", "상권_코드", "서비스_업종_코드"),
        expected_quarters=QUARTERS_2025,
    ),
    InputSpec(
        "stores", etl_stores.FILE, "utf-8-sig",
        tuple(etl_stores.USECOLS), ("상가업소번호",),
    ),
)
JOBS = {
    "commercial_areas": etl_commercial_areas.run,
    "store_stats_dong": etl_store_stats.run,
    "sales_dong": etl_sales.run_dong,
    "sales_commercial_area": etl_sales.run_commercial_area,
    "stores": etl_stores.run,
}


def main(argv=None):
    parser = argparse.ArgumentParser(description="서울시 CSV 입력 검사 및 원자적 DB 적재")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--only", nargs="+", choices=list(JOBS), help="선택한 테이블만 처리")
    parser.add_argument("--validate-only", action="store_true", help="DB 접속 없이 CSV 검사")
    args = parser.parse_args(argv)
    specs = [spec for spec in INPUTS if not args.only or spec.name in args.only]
    print("=== Startup Analysis ETL ===")
    print("서울시 전체 길단위인구 파일은 지역별 분석 대상에서 제외합니다.")
    try:
        reports = validate_inputs(args.data_dir.expanduser(), specs)
        if args.validate_only:
            print("=== CSV validation completed (no DB connection) ===")
            return 0
        if "commercial_areas" in reports:
            if not AREA_SOURCE_CRS:
                raise ValueError("원본 좌표계를 확인해 AREA_SOURCE_CRS를 설정하세요.")
            CRS.from_user_input(AREA_SOURCE_CRS)
        if "stores" in reports and STORE_CHUNK_SIZE <= 0:
            raise ValueError("STORE_CHUNK_SIZE는 0보다 큰 정수여야 합니다.")

        conn = get_connection()
        try:
            # DELETE/TRUNCATE와 모든 청크를 함께 commit하거나 함께 rollback한다.
            with conn.transaction():
                for spec in specs:
                    JOBS[spec.name](conn, reports[spec.name].path)
        finally:
            conn.close()
        print("=== ETL committed successfully ===")
        return 0
    except Exception as exc:
        print(f"ETL 실패 (CSV 검사 단계 또는 DB 트랜잭션 rollback): {exc}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
