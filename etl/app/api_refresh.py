"""Bounded refresh preparation; publication always needs a caller-owned guarded connection."""
import argparse
import json
from pathlib import Path
import sys

from .api_artifacts import create_file, encoded, write_run
from .api_config import load_keys, private_parent
from .api_http import HttpClient
from .api_records import CollectionError, quarter
from .api_release import connection_ready, load_run, prepare_release, publish_release, stage_release, verify_release
from . import seoul_api, semas_api


def collect_refresh(output, quarters, keys, *, previous_runs=(), client=None, allow_seoul_http=False):
    """Recollect explicit quarters and one CAFE snapshot; keep other validated old quarters.

    No calendar-based claim of latest, automatic empty-quarter skipping, DB connection,
    timer activation or retry of failed whole collections. Every invocation needs a new output.
    """
    if not quarters or len(quarters)>40 or len(set(quarters))!=len(quarters):
        raise CollectionError('EXPLICIT_REFRESH_QUARTERS_REQUIRED_MAX_40')
    quarters=sorted(quarter(value) for value in quarters)
    if not keys.get('SEOUL_OPENAPI_KEY') or not keys.get('SEMAS_SERVICE_KEY'):
        raise CollectionError('REFRESH_KEYS_REQUIRED')
    previous=list(previous_runs)
    baseline=prepare_release(previous) if previous else None  # Validate history before network/output.
    if baseline and baseline['store_scope']!='I21201':
        raise CollectionError('REFRESH_STORE_SCOPE_NARROWING')
    retained=[path for path in previous if (run:=load_run(path))['source']!='semas-stores'
              and run['period'] not in quarters]
    output=private_parent(output)
    try: output.mkdir(mode=0o700)
    except FileExistsError: raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
    client=client or HttpClient()
    runs=list(retained)
    for period in quarters:
        for kind in ('stores','sales'):
            source='seoul-'+kind
            path=output/(source+'-'+period)
            result=write_run(path,seoul_api.pages(client,kind,period,keys['SEOUL_OPENAPI_KEY'],
                page_size=1000,allow_http=allow_seoul_http),source=source,
                scope=dict(quarter=period,region='SEOUL',industry='ALL_SOURCE_INDUSTRIES',
                           transport='http-explicit-opt-in' if allow_seoul_http else 'https',
                           service=seoul_api.SERVICES[kind][0]),mode='collect')
            if result['complete'] is not True: raise CollectionError('REFRESH_SOURCE_INCOMPLETE')
            runs.append(path)
    path=output/'semas-stores'
    result=write_run(path,semas_api.pages(client,keys['SEMAS_SERVICE_KEY'],industry='I21201',page_size=100),
        source='semas-stores',scope=dict(region='11',industry='I21201',transport='https',service='storeListInDong'),mode='collect')
    if result['complete'] is not True: raise CollectionError('REFRESH_SOURCE_INCOMPLETE')
    release=prepare_release([*runs,path])
    if baseline and release['store_reference_month']<baseline['store_reference_month']:
        raise CollectionError('REFRESH_STORE_PERIOD_REGRESSION')
    with create_file(output/'release.json') as target: target.write(encoded(release))
    return release


def refresh_release(conn, release, *, expected_current, verify_identity):
    """Failure before publication leaves current unchanged. CAS rejects overlapping refreshes."""
    verify_release(release)
    connection_ready(conn)
    with conn.transaction():
        verify_identity(conn)
        with conn.cursor() as cur:
            cur.execute("SELECT c.release_id,r.metadata->>'store_reference_month' FROM api_current_release c LEFT JOIN api_releases r ON r.release_id=c.release_id WHERE c.singleton=true")
            current=cur.fetchone()
        if current is None: raise CollectionError('PUBLICATION_POINTER_MISSING')
        if current[0] not in (expected_current,release['release_id']):
            raise CollectionError('CURRENT_RELEASE_CHANGED')
        if current[0] is not None and (not current[1] or release['store_reference_month']<current[1]):
            raise CollectionError('REFRESH_STORE_PERIOD_REGRESSION')
    staged=stage_release(conn,release,verify_identity=verify_identity)
    published=publish_release(conn,release['release_id'],expected_current=expected_current,verify_identity=verify_identity)
    return dict(release_id=release['release_id'],staged=staged,published=published)


def main(argv=None):
    parser=argparse.ArgumentParser(description='API 정기 갱신용 수집·검증. DB 접속·예약 활성화 없음.')
    parser.add_argument('--env-file',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path,help='매 실행마다 새로운 프로젝트 밖 private 디렉터리')
    parser.add_argument('--quarter',required=True,action='append',help='실제 제공 여부를 확인한 분기 YYYYQ; 최대 40개')
    parser.add_argument('--previous-run',action='append',default=[],type=Path,help='이전 공개 묶음의 전체 원본 run 목록')
    parser.add_argument('--allow-seoul-http',action='store_true')
    args=parser.parse_args(argv)
    try:
        release=collect_refresh(args.output,args.quarter,load_keys(args.env_file),
            previous_runs=args.previous_run,allow_seoul_http=args.allow_seoul_http)
        print(json.dumps(dict(status='PREPARED_UNPUBLISHED',release_id=release['release_id'],
            quarters=release['quarters'],store_reference_month=release['store_reference_month'])))
        return 0
    except CollectionError as error: print('ERROR: '+str(error),file=sys.stderr)
    except Exception: print('ERROR: REFRESH_PREPARATION_FAILED',file=sys.stderr)
    return 2


if __name__=='__main__': sys.exit(main())
