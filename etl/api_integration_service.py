"""Serve only a verified new API DB through a loopback HTTP bridge; no DB host port."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import time

from api_integration import ROOT, JAVA_IMAGE, command, inspect_target
from app.api_artifacts import create_file, encoded
from app.api_config import private_parent
from demo_safety import reject_environment

MAIN='com.example.backend.location.ApiIntegrationApplication'


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--work',required=True,type=Path)
    p.add_argument('--port',type=int,default=18089)
    args=p.parse_args()
    reject_environment(os.environ)
    work=private_parent(args.work/'service.private.json').parent
    config=json.loads((work/'service.private.json').read_text())
    target=config['target']; inspect_target(target)
    artifact=work/'service-container.json'
    if artifact.exists(): raise ValueError('SERVICE_ALREADY_CREATED')
    folder=ROOT/'backend/build/location-integration'
    if not (folder/'classes/com/example/backend/location/ApiIntegrationApplication.class').is_file():
        raise ValueError('PREPARE_LOCATION_INTEGRATION_REQUIRED')
    # Binding the bridge before container creation prevents a busy port leaving an unknown service.
    class Bridge(BaseHTTPRequestHandler):
        def log_message(self,*unused): pass
        def do_GET(self):
            if not self.path.startswith('/api/') or len(self.path)>5000:
                self.send_error(404); return
            try:
                inspect_target(target)
                raw=command(['docker','exec',container,'java','-cp','/service/classes:/service/lib/*',MAIN,'probe',self.path],timeout=90)
                result=json.loads(raw); body=result['body'].encode()
                self.send_response(result['status']); self.send_header('Content-Type','application/json; charset=utf-8')
                self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
            except Exception:
                self.send_response(502); self.end_headers(); self.wfile.write(b'{"code":"ISOLATED_BRIDGE_FAILED"}')
    server=ThreadingHTTPServer(('127.0.0.1',args.port),Bridge)
    try:
        container=command(['docker','run','-d','--pull=never','--read-only','--tmpfs','/tmp',
            '--network',target['network'],'--name','ry-api-service-'+target['label'],
            '--label','recycleyoungs.control='+target['label'],
            '--mount',f'type=bind,src={folder},dst=/service,readonly',
            '-e','API_ISOLATION_TARGET','-e','API_READER_PASSWORD','--entrypoint','java',JAVA_IMAGE,
            '-cp','/service/classes:/service/lib/*',MAIN,'serve'],
            env={'API_ISOLATION_TARGET':json.dumps(target),'API_READER_PASSWORD':config['password']}).decode().strip()
        with create_file(artifact) as f: f.write(encoded(dict(container_id=container,owner=target['label'],port=args.port)))
        for _ in range(90):
            logs=command(['docker','logs',container]).decode()
            if 'API_SERVICE_READY readOnly=true migrations=false' in logs: break
            state=json.loads(command(['docker','inspect',container]))[0]['State']
            if not state['Running']: raise RuntimeError('NEW_SERVICE_START_FAILED')
            time.sleep(1)
        else: raise RuntimeError('NEW_SERVICE_START_TIMEOUT')
        print(json.dumps(dict(status='READY',http='http://127.0.0.1:'+str(args.port),reader='READ_ONLY',db_host_port=False)),flush=True)
        server.serve_forever()
    finally: server.server_close()


if __name__=='__main__':
    try: main()
    except KeyboardInterrupt: pass
    except Exception as error:
        print(json.dumps(dict(status='FAIL',type=type(error).__name__,code=str(error) if isinstance(error,ValueError) else 'ISOLATED_SERVICE_FAILED')),file=sys.stderr)
        sys.exit(2)
