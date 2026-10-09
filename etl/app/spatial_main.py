"""Explicit Polygon ETL entry point, independent of CSV jobs and DB environment defaults."""

import argparse
from collections import Counter
from dataclasses import asdict
import json
from pathlib import Path
import sys

from .spatial_sources import SPECS


def connect_database(dsn):
    from psycopg import connect
    return connect(dsn, autocommit=True)


def main(argv=None, *, connection_factory=None):
    parser = argparse.ArgumentParser(description='고정 공식 Polygon 검증/적재 (기본: 검증만, DB 접속 없음)')
    parser.add_argument('--only', nargs='+', choices=('admin', 'commercial'), default=['admin', 'commercial'])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--validate-only', action='store_true', help='ZIP/report/geometry 검증만, DB 접속 없음')
    mode.add_argument('--load', action='store_true', help='명시한 DB에 종류별 transaction으로 적재')
    parser.add_argument('--dsn', help='--load에서만 사용하는 명시적 PostgreSQL connection string; 기본값 없음')
    for option in ['admin-zip', 'admin-report', 'commercial-zip', 'commercial-report', 'commercial-repair-report']:
        parser.add_argument('--' + option, type=Path)
    args = parser.parse_args(argv)
    if len(args.only) != len(set(args.only)):
        parser.error('--only 종류를 중복 지정할 수 없습니다')
    if args.load and not args.dsn or args.dsn and not args.load:
        parser.error('--load와 --dsn을 함께 명시해야 합니다')
    inputs = {}
    for key in args.only:
        archive = getattr(args, key + '_zip')
        reports = {'quality': getattr(args, key + '_report')}
        if key == 'commercial':
            reports['repair'] = args.commercial_repair_report
        if archive is None or any(value is None for value in reports.values()):
            parser.error(f'{key}: 명시적인 ZIP와 모든 고정 report 경로가 필요합니다')
        inputs[key] = archive.expanduser(), {role: path.expanduser() for role, path in reports.items()}
    try:
        # Lazy imports also keep --help independent of GIS processing or DB initialization.
        from .spatial_geometry import prepare_dataset, profile_sha256
        prepared = [prepare_dataset(SPECS[key], *inputs[key]) for key in args.only]
        for dataset in prepared:
            print(json.dumps({'dataset_id': dataset.spec.dataset_id, 'features': len(dataset.features),
                              'quality': dict(Counter(f.quality_status for f in dataset.features)),
                              'offline_base_profile_sha256': profile_sha256(dataset.profile)}, ensure_ascii=False))
        if not args.load:
            return 0
        from .spatial_load import publish
        conn = (connect_database if connection_factory is None else connection_factory)(args.dsn)
        try:
            for dataset in prepared:
                result = publish(conn, dataset)
                print(json.dumps({'dataset_id': dataset.spec.dataset_id, **asdict(result)}, ensure_ascii=False))
        finally:
            conn.close()
        return 0
    except Exception as exc:
        print(f'Polygon ETL 실패 (해당 kind transaction rollback): {exc}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
