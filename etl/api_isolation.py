"""Adapter for disposable API integration only. No team/production mode or default DSN."""
import re
import os
import psycopg

from control import PROTECTED_ID, PROTECTED_SID, CONNECTION_SQL, check_target
from demo_safety import DB_IMAGE, reject_environment


class IsolationError(ValueError): pass


def validate_target(target):
    owner=target.get('label','')
    if (not re.fullmatch('[0-9a-f]{24}',owner)
        or target.get('host')!='ry-8c1-db-'+owner or target.get('network')!='ry-8c1-net-'+owner
        or target.get('dbname')!='recycleyoungs_integration_test_'+owner
        or target.get('user')!='integration_test' or target.get('port')!='5432'
        or target.get('data')!='/var/lib/postgresql/data/pgdata' or target.get('db_image')!=DB_IMAGE
        or not re.fullmatch('[0-9a-f]{64}',target.get('container_id',''))
        or not re.fullmatch('[0-9a-f]{64}',target.get('network_id',''))
        or target.get('container_id')==PROTECTED_ID or target.get('sid')==PROTECTED_SID
        or not re.fullmatch('[0-9]+',target.get('sid',''))):
        raise IsolationError('ISOLATED_TARGET_REJECTED')


def verify_docker(target, container, network):
    validate_target(target)
    check_target(target,container,network)


def verify_connection(conn,target,*,actor='integration_test',read_only=False):
    validate_target(target)
    with conn.cursor() as cur:
        cur.execute(CONNECTION_SQL)
        actual=cur.fetchone()
    expected=(target['dbname'],actor,actor,target['sid'],target['data'],5432,'5s','10min','on' if read_only else 'off')
    if actual!=expected: raise IsolationError('ISOLATED_CONNECTION_IDENTITY_REJECTED')


def connect_target(target,password,*,actor='integration_test',read_only=False):
    validate_target(target)
    try: reject_environment(os.environ)
    except ValueError: raise IsolationError('AMBIENT_DATABASE_SETTINGS_REJECTED') from None
    except RuntimeError: raise IsolationError('AMBIENT_DATABASE_SETTINGS_REJECTED') from None
    if actor not in ('integration_test','api_writer','api_reader') or (actor=='api_reader')!=read_only:
        raise IsolationError('ISOLATED_ACTOR_REJECTED')
    conn=psycopg.connect(host=target['host'],port=5432,dbname=target['dbname'],user=actor,
        password=password,connect_timeout=5,autocommit=True,
        options='-c lock_timeout=5s -c statement_timeout=600000 -c default_transaction_read_only='+('on' if read_only else 'off'))
    try: verify_connection(conn,target,actor=actor,read_only=read_only)
    except BaseException:
        conn.close()
        raise IsolationError('ISOLATED_CONNECTION_IDENTITY_REJECTED') from None
    return conn
