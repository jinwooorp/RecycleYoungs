"""Bounded contract2 refresh; exact baseline archive and required source failures."""
from pathlib import Path

from .api_artifacts import write_run
from .api_config import private_parent
from .api_http import HttpClient
from .api_records import CollectionError, quarter
from .api_release import digest, load_run
from .api_history_quality import require, verify_history_candidate
from .api_context_release import (ACTIVE_SOURCES, HISTORY_STATUS, _assemble_context_release,
    load_context_run, verify_context_release, write_release_bundle)
from . import seoul_api, semas_api, seoul_context


def require_context_coverage(previous, current):
    before={(r['quarter_code'],r['dong_code']) for r in previous['records']}
    after={(r['quarter_code'],r['dong_code']) for r in current['records']}
    require(before<=after,'CONTEXT_COVERAGE_REGRESSION_REQUIRES_REVIEW')


def collect_context_refresh(output, quarters, keys, *, previous_release, client=None, allow_seoul_http=False):
    verify_context_release(previous_release)
    require(bool(quarters) and len(quarters)<=40 and len(set(quarters))==len(quarters)
            and bool(keys.get('SEOUL_OPENAPI_KEY')) and bool(keys.get('SEMAS_SERVICE_KEY')),
            'EXPLICIT_CONTEXT_REFRESH_INPUT_REQUIRED')
    quarters=sorted(quarter(q) for q in quarters)
    require(previous_release['store_scope']=='I21201','REFRESH_STORE_SCOPE_NARROWING')
    output=private_parent(output)
    try:output.mkdir(mode=0o700)
    except FileExistsError:raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
    client=client or HttpClient()
    paths=[]
    for period in quarters:
        for kind in ('stores','sales'):
            source='seoul-'+kind; path=output/(source+'-'+period)
            result=write_run(path,seoul_api.pages(client,kind,period,keys['SEOUL_OPENAPI_KEY'],page_size=1000,
                allow_http=allow_seoul_http),source=source,scope=dict(quarter=period,region='SEOUL',
                industry='ALL_SOURCE_INDUSTRIES',service=seoul_api.SERVICES[kind][0],
                transport='http-explicit-opt-in' if allow_seoul_http else 'https'),mode='collect')
            require(result['complete'] is True,'REFRESH_SOURCE_INCOMPLETE');paths.append(path)
    path=output/'semas-stores'
    result=write_run(path,semas_api.pages(client,keys['SEMAS_SERVICE_KEY'],industry='I21201',page_size=100),
        source='semas-stores',scope=dict(region='11',industry='I21201',service='storeListInDong',transport='https'),mode='collect')
    require(result['complete'] is True,'REFRESH_SOURCE_INCOMPLETE');paths.append(path)
    runs=[r for r in previous_release['runs'] if r['source']!='semas-stores' and r['period'] not in quarters]
    runs=sorted([*runs,*[load_run(p) for p in paths]],key=lambda r:(r['source'],r['period']))
    snapshot=next(r for r in runs if r['source']=='semas-stores')
    require(snapshot['period']>=previous_release['store_reference_month'],'REFRESH_STORE_PERIOD_REGRESSION')
    context_runs=[]
    for source in ACTIVE_SOURCES:
        spec=seoul_context.SOURCES[source];path=output/source
        result=write_run(path,seoul_context.pages(client,source,keys['SEOUL_OPENAPI_KEY'],allow_http=allow_seoul_http),
            source=source,scope=dict(region='SEOUL',service=spec.service,dataset=spec.dataset,
                period_scope='ALL_SOURCE_PERIODS',observation_date=None,spatial_unit='ADMINISTRATIVE_DONG',
                annual_repeated_values=spec.annual,transport='http-explicit-opt-in' if allow_seoul_http else 'https'),mode='collect')
        require(result['complete'] is True,'REFRESH_CONTEXT_SOURCE_INCOMPLETE')
        run=load_context_run(path)
        require_context_coverage(previous_release['context_sources'][source.removeprefix('seoul-')]['run'],run)
        context_runs.append(run)
    archive=previous_release.get('baseline_archive')
    if archive is None:
        prior={(r['source'],r['period']):r for r in previous_release['runs']}
        archive=[prior[(r['source'],r['period'])] for r in previous_release['baseline']['runs']]
    history={k:previous_release[k] for k in ('contract_version','text_policy','baseline','quality_policy')}
    history.update(runs=runs,quarters=sorted({r['period'] for r in runs if r['source']=='seoul-stores'}),
        store_reference_month=snapshot['period'],store_scope=snapshot['scope']['industry'],
        collected_at=max(r['collected_at'] for r in runs),candidate_status=HISTORY_STATUS)
    require(set(previous_release['quarters'])<=set(history['quarters']),'RELEASE_PERIOD_LOSS')
    history['release_id']=digest(history)
    verify_history_candidate(history,baseline_archive=archive)
    release=_assemble_context_release(history,context_runs,baseline_archive=archive,refresh_parent=previous_release['release_id'])
    write_release_bundle(output/'bundle',release)
    return release
