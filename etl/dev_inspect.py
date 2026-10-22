"""Fixed redacted inspect selectors for the local Compose namespace only."""
from http.server import ThreadingHTTPServer
from dev_runtime import project,LABEL
import team_inspect_proxy as proxy


def main():
    p=project()
    proxy.PROJECT=p;proxy.OWNER=LABEL
    proxy.SERVICES={'inspect-proxy','preflight','api-postgres','identity','migrate','initialize','api-backend','api-scheduler','frontend'}
    proxy.NETWORKS={p+'-'+role for role in ('data','inspect','access')}
    proxy.VOLUMES={p+'-'+role for role in ('db','control','data','reader','writer')}
    ThreadingHTTPServer(('0.0.0.0',8081),proxy.Handler).serve_forever()


if __name__=='__main__':main()
