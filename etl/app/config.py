import os
from pathlib import Path

DATA_DIR = Path(os.getenv(
    "DATA_DIR", str(Path(__file__).resolve().parents[2] / "data" / "raw" / "dataset")
)).expanduser()
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "startup_analysis")
DB_USER = os.getenv("DB_USER", "app")
DB_PASSWORD = os.getenv("DB_PASSWORD", "app")

# 원본의 좌표계 메타데이터 확인 전에는 좌표계를 추정하지 않는다.
AREA_SOURCE_CRS = os.getenv("AREA_SOURCE_CRS", "").strip()
STORE_CHUNK_SIZE = int(os.getenv("STORE_CHUNK_SIZE", "50000"))
