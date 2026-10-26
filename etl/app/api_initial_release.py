"""Fresh contract2 initialization using the approved history/context collectors.

No DB, restoration, private seed or automatic fallback. Only the two previously
approved unmapped-industry count issues are held, with exact raw evidence. A
verified self-contained bundle replaces disposable collection copies.
"""
from pathlib import Path
import shutil

from .api_artifacts import write_run
from .api_config import private_parent
from .api_http import HttpClient
from .api_records import CollectionError, quarter
from .api_history_quality import POLICY, approved_cases, collect_sales, require
from .api_context_release import (ACTIVE_SOURCES, prepare_initial_history,
    prepare_context_release, write_release_bundle, read_release_bundle)
from . import seoul_api, semas_api, seoul_context


def initial_quality_policy():
    # Exact public classification rules from the approved current contract.
    # These are not corrections or a general permission to drop negative rows.
    return dict(schema_version=1, policy_id=POLICY, cases=[
        dict(quarter_code='20222', dong_code='11470610', source_industry_code='CS300043',
             fields={'TMZON_06_11_SELNG_CO':'-1'}),
        dict(quarter_code='20243', dong_code='11440655', source_industry_code='CS200024',
             fields={'TMZON_06_11_SELNG_CO':'-1'}),
    ])


def collect_initial_release(output, quarters, keys, *, client=None, allow_seoul_http=False):
    require(bool(quarters) and len(quarters)<=40 and len(set(quarters))==len(quarters)
            and bool(keys.get('SEOUL_OPENAPI_KEY')) and bool(keys.get('SEMAS_SERVICE_KEY')),
            'EXPLICIT_INITIAL_COLLECTION_REQUIRED')
    quarters=sorted(quarter(q) for q in quarters)
    numbers=[int(q[:4])*4+int(q[4])-1 for q in quarters]
    require(quarters[0]=='20211' and numbers==list(range(numbers[0],numbers[-1]+1)),
            'INITIAL_HISTORY_START_OR_GAP')
    policy=initial_quality_policy()
    held_periods={key[0] for key in approved_cases(policy)}
    require(held_periods<=set(quarters) and any(q>='20251' for q in quarters), 'INITIAL_BASELINE_REQUIRED')
    output=private_parent(output)
    try:output.mkdir(mode=0o700)
    except FileExistsError:raise CollectionError('OUTPUT_ALREADY_EXISTS') from None
    client=client or HttpClient()
    normal=[];quality=[];baseline=[];collected=[]
    for period in quarters:
        for kind in ('stores','sales'):
            source='seoul-'+kind;path=output/(source+'-'+period)
            if kind=='sales' and period in held_periods:
                collect_sales(path,period,keys['SEOUL_OPENAPI_KEY'],policy,
                              client=client,allow_http=allow_seoul_http)
                quality.append(path)
            else:
                result=write_run(path,seoul_api.pages(client,kind,period,keys['SEOUL_OPENAPI_KEY'],
                    page_size=1000,allow_http=allow_seoul_http),source=source,
                    scope=dict(quarter=period,region='SEOUL',industry='ALL_SOURCE_INDUSTRIES',
                        service=seoul_api.SERVICES[kind][0],transport='http-explicit-opt-in' if allow_seoul_http else 'https'),mode='collect')
                require(result['complete'] is True,'INITIAL_SOURCE_INCOMPLETE')
                normal.append(path)
                if period>='20251':baseline.append(path)
            collected.append(path)
    path=output/'semas-stores'
    result=write_run(path,semas_api.pages(client,keys['SEMAS_SERVICE_KEY'],industry='I21201',page_size=100),
        source='semas-stores',scope=dict(region='11',industry='I21201',transport='https',service='storeListInDong'),mode='collect')
    require(result['complete'] is True,'INITIAL_SOURCE_INCOMPLETE')
    normal.append(path);baseline.append(path);collected.append(path)
    context=[]
    for source in ACTIVE_SOURCES:
        spec=seoul_context.SOURCES[source];path=output/source
        result=write_run(path,seoul_context.pages(client,source,keys['SEOUL_OPENAPI_KEY'],allow_http=allow_seoul_http),
            source=source,scope=dict(region='SEOUL',service=spec.service,dataset=spec.dataset,
                period_scope='ALL_SOURCE_PERIODS',observation_date=None,spatial_unit='ADMINISTRATIVE_DONG',
                annual_repeated_values=spec.annual,transport='http-explicit-opt-in' if allow_seoul_http else 'https'),mode='collect')
        require(result['complete'] is True,'INITIAL_CONTEXT_SOURCE_INCOMPLETE')
        context.append(path);collected.append(path)
    history=prepare_initial_history(dict(runs=normal,quality_runs=quality,baseline_runs=baseline,quarters=quarters),policy)
    release=prepare_context_release(history,context)
    bundle=write_release_bundle(output/'bundle',release)
    verified=read_release_bundle(bundle)
    require(verified['release_id']==release['release_id'],'INITIAL_BUNDLE_CHANGED')
    # All returned records and raw/quarantine evidence now belong to the bundle.
    # Do not retain a second full collection copy or delete anything on failure.
    for path in collected:
        require(path.parent==output and not path.is_symlink(),'INITIAL_COLLECTION_PATH_CHANGED')
        shutil.rmtree(path)
    return verified
