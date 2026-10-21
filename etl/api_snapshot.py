"""Full value/geometry/catalog/ACL snapshots for the newly owned API environment only."""
import hashlib,json,re,sys
from psycopg import sql
from api_runtime import connect,verify_connection,require

CATALOG={
 'relations':"SELECT n.nspname,c.relname,c.relkind,c.relowner::regrole::text,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','api_runtime') AND c.relkind IN ('r','v','S','p') ORDER BY 1,2",
 'columns':"SELECT n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),a.attcollation::regcollation::text,a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN ('public','api_runtime') AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3",
 'constraints':"SELECT n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','api_runtime') ORDER BY 1,2,3",
 'indexes':"SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes WHERE schemaname IN ('public','api_runtime') ORDER BY 1,2,3",
 'triggers':"SELECT n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','api_runtime') AND NOT t.tgisinternal ORDER BY 1,2,3",
 'functions':"SELECT n.nspname,p.oid::regprocedure::text,p.proowner::regrole::text,p.proacl::text,p.proconfig::text,pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','api_runtime') AND p.prokind IN ('f','p') ORDER BY 1,2",
 'schemas':"SELECT nspname,nspowner::regrole::text,nspacl::text FROM pg_namespace WHERE nspname IN ('public','api_runtime') ORDER BY 1",
 'types':"SELECT n.nspname,t.typname,t.typtype,t.typowner::regrole::text,t.typacl::text FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('public','api_runtime') ORDER BY 1,2",
 'sequences':"SELECT schemaname,sequencename,sequenceowner,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname IN ('public','api_runtime') ORDER BY 1,2",
 'extensions':"SELECT extname,extversion,extowner::regrole::text FROM pg_extension ORDER BY 1",
 'roles':"SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil::text,rolconfig::text FROM pg_roles WHERE rolname IN ('ry_api_owner','api_writer','api_reader') ORDER BY 1",
 'memberships':"SELECT r.rolname,m.rolname,g.rolname,a.admin_option FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor WHERE m.rolname IN ('ry_api_owner','api_writer','api_reader') ORDER BY 1,2,3",
 'database':"SELECT datdba::regrole::text,encoding,datcollate,datctype,datacl::text FROM pg_database WHERE datname=current_database()",
 'views':"SELECT schemaname,viewname,viewowner,definition FROM pg_views WHERE schemaname IN ('public','api_runtime') ORDER BY 1,2",
}

def row_digest(rows):
    h=hashlib.sha256();count=0
    for row in rows:
        b=row.encode();h.update(len(b).to_bytes(8,'big'));h.update(b);count+=1
    return dict(rows=count,sha256=h.hexdigest())

def normalize_constraint(value):
    # pg_dump roundtrips unconstrained varchar literal arrays as individual text casts.
    # Normalize only these binary-compatible literal forms, never column/type/length casts.
    literal=r"'(?:[^']|'')*'"
    pattern=r"\(ARRAY\[((?:"+literal+r"::character varying)(?:, "+literal+r"::character varying)*)\]\)::text\[\]"
    value=re.sub(pattern,lambda m:'ARRAY['+re.sub('('+literal+')::character varying',r'\1::text',m[1])+']',value)
    return re.sub(r"\(("+literal+r")::character varying\)::text",r'\1::text',value)

def snapshot(conn):
    result={'tables':{},'catalog':{},'sequence_state':{}}
    conn.execute("SET LOCAL timezone='UTC'")
    tables=conn.execute("SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','api_runtime') AND c.relkind='r' ORDER BY 1,2").fetchall()
    for schema,table in tables:
        fields=conn.execute("SELECT a.attname,t.typname FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid WHERE a.attrelid=%s::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum",(schema+'.'+table,)).fetchall()
        expressions=[sql.SQL("encode(ST_AsEWKB({}),'hex')").format(sql.Identifier(name)) if kind=='geometry' else sql.Identifier(name) for name,kind in fields]
        query=sql.SQL('SELECT value FROM (SELECT jsonb_build_array({})::text AS value FROM {}.{}) q ORDER BY value COLLATE "C"').format(sql.SQL(',').join(expressions),sql.Identifier(schema),sql.Identifier(table))
        with conn.cursor() as cur:
            cur.execute(query)
            def rows():
                while True:
                    batch=cur.fetchmany(2000)
                    if not batch:break
                    for row in batch:yield row[0]
            result['tables'][schema+'.'+table]=row_digest(rows())
    for key,query in CATALOG.items():
        values=conn.execute(query).fetchall()
        if key=='constraints':values=[(*row[:3],normalize_constraint(row[3])) for row in values]
        result['catalog'][key]=row_digest(json.dumps(row,default=str,separators=(',',':')) for row in values)
    for schema,name in conn.execute("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('public','api_runtime') ORDER BY 1,2").fetchall():
        result['sequence_state'][schema+'.'+name]=list(conn.execute(sql.SQL('SELECT last_value,is_called FROM {}.{}').format(sql.Identifier(schema),sql.Identifier(name))).fetchone())
    return result

def main():
    mode=sys.argv[1]
    if mode=='hold':
        conn,t=connect('/api-control','ry_api_owner',True)
        with conn:
            require(conn.execute('SELECT pg_try_advisory_lock(20261021,51)').fetchone()==(True,),'WRITER_BUSY')
            with conn.transaction():
                conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                verify_connection(conn,t,'ry_api_owner',True)
                require(conn.execute('SELECT status FROM api_runtime.state').fetchone()[0] in ('IDLE','SUCCEEDED'),'JOB_NOT_QUIESCENT')
                print(json.dumps(dict(snapshot=conn.execute('SELECT pg_export_snapshot()').fetchone()[0])),flush=True)
                print(json.dumps(snapshot(conn)),flush=True)
                require(sys.stdin.readline()=='release\n','SNAPSHOT_RELEASE_REQUIRED')
    elif mode=='restore':
        import re,psycopg
        config=json.load(sys.stdin);t=config['target']
        require(bool(re.fullmatch('recycleyoungs_api_restore_[0-9a-f]{24}',t['dbname'])) and t['host']=='ry-api-restore-'+t['nonce'],'RESTORE_ROUTE_REJECTED')
        with psycopg.connect(host=t['host'],port=5432,dbname=t['dbname'],user='ry_api_owner',password=config['password'],autocommit=True,
                options='-c default_transaction_read_only=on -c lock_timeout=5s -c statement_timeout=600000') as conn:
            with conn.transaction():
                conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
                actual=conn.execute("SELECT current_database(),current_user,session_user,(SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout'),current_setting('transaction_read_only')").fetchone()
                require(actual==(t['dbname'],'ry_api_owner','ry_api_owner',t['sid'],'/var/lib/postgresql/data/api','5432','5s','10min','on'),'RESTORE_CONNECTION_REJECTED')
                measured=snapshot(conn)
        with psycopg.connect(host=t['host'],port=5432,dbname=t['dbname'],user='api_reader',password=config['reader_password'],autocommit=True,
                options='-c default_transaction_read_only=on -c lock_timeout=5s -c statement_timeout=600000') as reader:
            with reader.transaction():
                row=reader.execute("SELECT current_database(),current_user,session_user,(SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),current_setting('port'),current_setting('transaction_read_only')").fetchone()
                require(row==(t['dbname'],'api_reader','api_reader',t['sid'],'/var/lib/postgresql/data/api','5432','on'),'RESTORE_READER_REJECTED')
                require(not reader.execute("SELECT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname IN ('public','api_runtime') AND has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE'))").fetchone()[0],'RESTORE_READER_WRITE_PRIVILEGE')
        print(json.dumps(measured),flush=True)
    else:raise ValueError('explicit mode required')

if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps(dict(status='FAIL',type=type(e).__name__,sqlstate=getattr(e,'sqlstate',None))),file=sys.stderr);sys.exit(2)
