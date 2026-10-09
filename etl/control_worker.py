"""Container-side measured operations. Always bound to an isolated proof."""
import argparse,ast,contextlib,hashlib,io,json,os,sys
from pathlib import Path
sys.path[:0]=['/workspace/etl/tests','/workspace/etl']
import psycopg
from psycopg.rows import dict_row
from integration_support import connect_isolated,snapshot,compare_preserved,V1_TABLES,table_query,digest_records
from control import guard_connection,ControlError,reject_environment
CFG=json.loads(Path('/run/config.json').read_text());T=CFG['target'];OUT=Path('/out')
os.umask(0o077)
PROOF={'container_id':T['container_id'],'system_identifier':T['sid'],'internal':True,'mounts':[],'port_bindings':{},
 'tmpfs':{'/var/lib/postgresql/data':'rw','/docker-entrypoint-initdb.d':'rw'},
 'host':T['host'],'port':T['port'],'user':T['user'],'network':T['network']}
def save(name,x):
 p=OUT/(name+'.json')
 with p.open('x') as f:f.write(json.dumps(x,ensure_ascii=False,sort_keys=True,indent=2,default=str)+'\n')
def load(name):return json.loads((OUT/(name+'.json')).read_text())
def dsn():
 return psycopg.conninfo.make_conninfo(host=T['host'],port=T['port'],dbname=T['dbname'],user=T['user'],password=os.environ['CONTROL_DB_PASSWORD'])
def expected():return {'db':T['dbname'],'user':T['user'],'sid':T['sid'],'data':T['data'],'port':5432}
def connect():
 reject_environment(os.environ)
 c=connect_isolated(dsn(),PROOF)
 c.execute("SET lock_timeout='5s'");c.execute("SET statement_timeout='10min'")
 return guard_connection(c,expected())
def scalar(c,q):
 with c.cursor() as cur:cur.execute(q);return next(iter(cur.fetchone().values()))
def audit(c):
 tree=ast.parse(Path('/run/catalog_source.py').read_text())
 node=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SCHEMA_QUERY' for t in n.targets))
 q=eval(compile(ast.Expression(node.value),'existing catalog','eval'),{'quoted':','.join("'"+t+"'" for t in V1_TABLES)})
 node=next(n for n in ast.parse(Path('/run/audit_source.py').read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='audit')
 ns={'V1_TABLES':V1_TABLES,'table_query':table_query,'digest_records':digest_records,'SCHEMA_QUERY':q}
 exec(compile(ast.Module(body=[node],type_ignores=[]),'existing audit','exec'),ns)
 class Adapter:
  identity={'isolated':True}
  def json(self,query):return scalar(c,query)
  def rows(self,query):
   with c.cursor(name='control_audit') as cur:
    cur.itersize=5000;cur.execute(query)
    for row in cur:yield next(iter(row.values()))
 with c.transaction():
  c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  with contextlib.redirect_stdout(io.StringIO()):result=ns['audit'](Adapter())
 if sum(len(v) for v in result['nulls'].values())!=169:raise ControlError('NULL field audit incomplete')
 return result
def equality(a,b,ignore=('identity',)):
 for key in a:
  if key not in ignore and a[key]!=b[key]:raise ControlError('preservation mismatch '+key)
def history(c,label):
 rows=scalar(c,"SELECT jsonb_agg(to_jsonb(h) ORDER BY installed_rank) FROM flyway_schema_history h")
 versions=['1','2'] if label=='v2' else ['1','2','3']
 if [r['version'] for r in rows]!=versions or not all(r['success'] for r in rows):raise ControlError('actual history unexpected')
 before=load('restore')
 if rows[0]!=before['history'][0]:raise ControlError('baseline history changed')
 for row in rows[1:]:
  if row['checksum']!={'2':237765795,'3':617267104}[row['version']] or row['type']!='SQL':raise ControlError('SQL checksum/type differs')
 return {'versions':versions,'expected_checksums':True,'failed':False}
def polygon(kind):
 from app.spatial_main import main
 root=Path('/source/spatial');witness=[]
 def factory(value):
  if psycopg.conninfo.conninfo_to_dict(value)!=psycopg.conninfo.conninfo_to_dict(dsn()):raise ControlError('explicit DSN differs')
  c=connect();witness.append(scalar(c,'SELECT pg_backend_pid()'))
  return c
 args=['--only',kind,'--load','--dsn',dsn()]
 if kind=='admin':args+=['--admin-zip',str(root/'서울시 상권분석서비스(영역-행정동).zip'),'--admin-report',str(root/'validation-results.json')]
 else:args+=['--commercial-zip',str(root/'stage4-research-20261007/official-commercial-area.zip'),'--commercial-report',str(root/'stage56-validation-20261007/results.json'),'--commercial-repair-report',str(root/'six-repair-validation-20261007/results.json')]
 output=io.StringIO()
 with contextlib.redirect_stdout(output):rc=main(args,connection_factory=factory)
 if rc!=0 or len(witness)!=1:raise ControlError('guarded CLI publication failed')
 lines=[json.loads(s) for s in output.getvalue().splitlines()]
 return {'cli_exit':rc,'same_publication_connection_guard':True,'publication':lines[-1]}
def kind_check(c,kind):
 table='admin_dong_boundaries' if kind=='admin' else 'commercial_area_boundaries'
 expected_quality={'VALID_SOURCE':425} if kind=='admin' else {'VALID_SOURCE':1644,'REPAIRED_OPERATIONAL':6}
 actual=scalar(c,f"SELECT jsonb_object_agg(quality_status,n) FROM (SELECT quality_status,count(*) AS n FROM {table} GROUP BY quality_status) q")
 if actual!=expected_quality:raise ControlError('quality inventory differs')
 versions=scalar(c,'SELECT jsonb_agg(to_jsonb(v) ORDER BY boundary_kind) FROM spatial_dataset_versions v')
 for v in versions:
  key='admin' if v['boundary_kind']=='ADMIN_DONG' else 'commercial'
  if v['load_status']!='READY' or not v['is_current'] or v['historical_compatibility_status']!='UNRESOLVED' or v['reference_date'] is not None or v['reference_date_verified'] or v['validation_status']!='PASSED_WITH_LIMITATIONS' or v['processing_profile_sha256']!=CFG['profiles'][key]:raise ControlError('version/profile/limitation differs')
 count=scalar(c,f"SELECT count(*) FROM {table} WHERE ST_SRID(source_geometry)=5181 AND ST_SRID(operational_geometry)=5181 AND ST_GeometryType(operational_geometry)='ST_MultiPolygon' AND ST_IsValid(operational_geometry) AND NOT ST_IsEmpty(operational_geometry) AND source_geometry_sha256=encode(sha256(ST_AsBinary(source_geometry,'NDR')),'hex') AND operational_geometry_sha256=encode(sha256(ST_AsBinary(operational_geometry,'NDR')),'hex')")
 if count!=sum(actual.values()):raise ControlError('geometry/hash inventory differs')
 if kind=='commercial':
  if len(versions)!=2 or scalar(c,'SELECT count(*) FROM commercial_area_boundaries WHERE NOT ST_IsValid(source_geometry)')!=6:raise ControlError('source invalid preservation differs')
  h5=scalar(c,"SELECT jsonb_build_object('sigungu',source_sigungu_code,'dong',source_dong_code,'status',source_attribute_status) FROM commercial_area_boundaries WHERE commercial_area_code='3110531'")
  if h5!={'sigungu':'11110','dong':'11410660','status':'CONFLICT_OBSERVED'}:raise ControlError('H5 modified')
 return {'rows':count,'quality':actual,'geometry_hashes':True,'current_ready':True,'UNRESOLVED':True}
def main():
 p=argparse.ArgumentParser();p.add_argument('operation');p.add_argument('--label');p.add_argument('--kind');a=p.parse_args()
 with connect() as c:
  if a.operation=='identity':result={'identity':expected()}
  elif a.operation=='runtime':
   from app.spatial_geometry import runtime_versions
   tools=runtime_versions()
   if tools!={'python':'3.12.15','pyshp':'3.1.6','shapely':'2.1.2','geos':'3.13.1','pyproj':'3.7.0','proj':'9.4.1'}:raise ControlError('GIS runtime differs')
   result={'python_runtime':tools,'postgres':scalar(c,"SELECT current_setting('server_version')")}
  elif a.operation=='empty':
   if scalar(c,"SELECT count(*) FROM pg_tables WHERE schemaname='public'")!=0:raise ControlError('restore target not empty')
   result={'empty':True}
  elif a.operation=='history':result=history(c,a.label)
  elif a.operation=='polygon':result=polygon(a.kind)
  elif a.operation=='verify':
   value=audit(c);save(a.label,value)
   save('snap-'+a.label,snapshot(c,a.label!='restore'))
   if a.label=='restore':
    ref=json.loads(Path('/run/reference.json').read_text());equality(ref,value)
    result={'actual_backup_restore_equal':True,'NULL_fields':169,'rows':{k:v['rows'] for k,v in value['physical'].items()}}
   elif a.label=='v2':
    equality(load('restore'),value,('identity','history'));history(c,'v2')
    for table in ('spatial_dataset_versions','admin_dong_boundaries','commercial_area_boundaries'):
     if scalar(c,'SELECT count(*) FROM '+table)!=0:raise ControlError('V2 spatial tables not empty')
    if scalar(c,"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('guard_spatial_boundary_write','guard_spatial_dataset_version')")!=2:raise ControlError('V2 guards missing')
    result={'V1_preserved':True,'spatial_empty':True,'history':history(c,'v2')}
   elif a.label=='v3':
    old=load('restore');compare_preserved(load('snap-restore'),load('snap-v3'),True)
    if len(value['mappings'])!=5 or [r for r in value['mappings'] if r['source']=='SEOUL']!=old['mappings']:raise ControlError('mapping preservation differs')
    if [r for r in value['mappings'] if r['source']=='SEMAS'][0]['industry_code']!='CAFE':raise ControlError('CAFE mapping absent')
    if value['stores_summary']['total']!=0 or value['sequences']['industry_mappings_id_seq']!={'last_value':5,'is_called':True}:raise ControlError('backfill/sequence differs')
    result={'V1_other_values_preserved':True,'mapping_added':1,'backfill':0,'history':history(c,'v3')}
   else:
    equality(load('v3'),value);result=kind_check(c,a.label)
  elif a.operation=='final':
   before=snapshot(c,True);polygon('admin');polygon('commercial');after=snapshot(c,True)
   if before!=after:raise ControlError('retry changed spatial snapshot')
   equality(load('v3'),audit(c));result={'full_retry_equal':True,'V1_preserved':True,'admin':kind_check(c,'admin'),'commercial':kind_check(c,'commercial')}
  else:raise ControlError('operation unknown')
 print(json.dumps(result,sort_keys=True,default=str))
if __name__=='__main__':main()
