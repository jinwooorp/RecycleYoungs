"""Inactive-scheduler entry point: exclusive, bounded collection only; never opens a DB."""
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import secrets
import stat
import sys
import argparse

from .api_config import private_parent, load_keys
from .api_records import CollectionError
from .api_refresh import collect_refresh


@contextmanager
def job_lock(parent):
    parent=private_parent(Path(parent)/'refresh.lock').parent
    try: fd=os.open(parent/'refresh.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600)
    except OSError: raise CollectionError('PRIVATE_JOB_LOCK_REQUIRED') from None
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:
            raise CollectionError('PRIVATE_JOB_LOCK_REQUIRED')
        try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise CollectionError('REFRESH_ALREADY_RUNNING') from None
        yield
    finally: os.close(fd)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--env-file',required=True,type=Path)
    p.add_argument('--output-parent',required=True,type=Path)
    p.add_argument('--previous-run-list',required=True,type=Path,help='이전 전체 run 절대 경로의 private JSON 배열')
    p.add_argument('--quarter',required=True,action='append')
    p.add_argument('--allow-seoul-http',action='store_true')
    args=p.parse_args(argv)
    try:
        path=private_parent(args.previous_run_list)
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd) as source:
            info=os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_mode&0o077 or info.st_uid!=os.getuid():
                raise CollectionError('PRIVATE_RUN_LIST_REQUIRED')
            text=source.read(32769)
        if len(text)>32768: raise CollectionError('RUN_LIST_TOO_LARGE')
        previous=json.loads(text)
        if not isinstance(previous,list) or not 3<=len(previous)<=81 or any(not isinstance(p,str) for p in previous):
            raise CollectionError('COMPLETE_PREVIOUS_RUN_LIST_REQUIRED')
        for item in previous: private_parent(Path(item)/'manifest.json')
        with job_lock(args.output_parent):
            output=args.output_parent/('run-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(4))
            release=collect_refresh(output,args.quarter,load_keys(args.env_file),previous_runs=previous,
                allow_seoul_http=args.allow_seoul_http)
        print(json.dumps(dict(status='PREPARED_UNPUBLISHED',release_id=release['release_id'],quarters=release['quarters'],
            store_reference_month=release['store_reference_month'],database_connected=False)))
        return 0
    except CollectionError as error: print('ERROR: '+str(error),file=sys.stderr)
    except Exception: print('ERROR: REFRESH_JOB_FAILED',file=sys.stderr)
    return 2


if __name__=='__main__': sys.exit(main())
