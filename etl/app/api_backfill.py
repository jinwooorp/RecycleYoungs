"""Explicit DB-free historical additions; existing quarters and SEMAS are immutable inputs."""
import argparse
import json
from pathlib import Path
import sys

from .api_artifacts import create_file, encoded, write_run
from .api_config import load_keys, private_parent
from .api_http import HttpClient
from .api_records import CollectionError, quarter
from .api_release import digest, prepare_release
from . import seoul_api


def signatures(release):
    return {(r['source'], r['period']): digest({k: v for k, v in r.items() if k != 'records'})
            for r in release['runs']}


def collect_backfill(output, quarters, keys, *, previous_runs, client=None, allow_seoul_http=False):
    if not quarters or len(quarters) > 40 or len(set(quarters)) != len(quarters):
        raise CollectionError('EXPLICIT_BACKFILL_QUARTERS_REQUIRED_MAX_40')
    periods = sorted(quarter(q) for q in quarters)
    if not keys.get('SEOUL_OPENAPI_KEY'):
        raise CollectionError('SEOUL_KEY_MISSING')
    previous = [Path(p) for p in previous_runs]
    baseline = prepare_release(previous)  # Reject incomplete/tampered baselines before network or output.
    if set(periods) & set(baseline['quarters']):
        raise CollectionError('BACKFILL_EXISTING_QUARTER_REJECTED')
    if len(set(periods) | set(baseline['quarters'])) > 40:
        raise CollectionError('BACKFILL_TOTAL_QUARTERS_EXCEEDS_40')
    baseline_id, before = baseline['release_id'], signatures(baseline)
    del baseline
    output = private_parent(output)
    try:
        output.mkdir(mode=0o700)
    except FileExistsError:
        raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
    report = dict(status='IN_PROGRESS', published=False, current_publication_checked=False,
                  baseline_release_id=baseline_id, requested_quarters=periods, added_runs=[],
                  requires_current_registry_validation=True)
    with create_file(output / 'backfill-start.json') as target:
        target.write(encoded(report))
    client = client or HttpClient()
    added = []
    try:
        for period in periods:
            for kind in ('stores', 'sales'):
                source = 'seoul-' + kind
                path = output / (source + '-' + period)
                run = write_run(path, seoul_api.pages(client, kind, period, keys['SEOUL_OPENAPI_KEY'],
                    page_size=1000, allow_http=allow_seoul_http), source=source,
                    scope=dict(quarter=period, region='SEOUL', industry='ALL_SOURCE_INDUSTRIES',
                        service=seoul_api.SERVICES[kind][0],
                        transport='http-explicit-opt-in' if allow_seoul_http else 'https'), mode='collect')
                if not run['complete']:
                    raise CollectionError('BACKFILL_SOURCE_INCOMPLETE')
                added.append(path)
                report['added_runs'].append(dict(source=source, quarter=period, rows=run['received_count']))
        release = prepare_release([*previous, *added])
        after = signatures(release)
        if any(after.get(key) != value for key, value in before.items()):
            raise CollectionError('BACKFILL_BASELINE_CHANGED')
        with create_file(output / 'release.json') as target:
            target.write(encoded(release))
        report.update(status='PREPARED_UNPUBLISHED', release_id=release['release_id'],
                      quarters=release['quarters'], retained_runs=len(previous),
                      source_run_paths=[str(p) for p in [*previous, *added]], baseline_preserved=True)
    except BaseException as error:
        report.update(status='FAILED', error=str(error) if isinstance(error, CollectionError) else 'BACKFILL_INTERRUPTED')
        with create_file(output / 'backfill.json') as target:
            target.write(encoded(report))
        raise
    with create_file(output / 'backfill.json') as target:
        target.write(encoded(report))
    return release


def main(argv=None):
    parser = argparse.ArgumentParser(description='과거 분기 추가 수집·공개 후보 준비. DB 접속·공개·SEMAS 재수집 없음.')
    parser.add_argument('--env-file', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--quarter', required=True, action='append')
    parser.add_argument('--previous-run', required=True, action='append', type=Path)
    parser.add_argument('--allow-seoul-http', action='store_true')
    args = parser.parse_args(argv)
    try:
        release = collect_backfill(args.output, args.quarter, load_keys(args.env_file),
            previous_runs=args.previous_run, allow_seoul_http=args.allow_seoul_http)
        print(json.dumps(dict(status='PREPARED_UNPUBLISHED', published=False,
            release_id=release['release_id'], quarters=release['quarters'],
            rows=sum(len(r['records']) for r in release['runs']))))
        return 0
    except CollectionError as error:
        print('ERROR: ' + str(error), file=sys.stderr)
    except KeyboardInterrupt:
        print('ERROR: BACKFILL_INTERRUPTED', file=sys.stderr)
        return 130
    except Exception:
        print('ERROR: BACKFILL_PREPARATION_FAILED', file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main())
