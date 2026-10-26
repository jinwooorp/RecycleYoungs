"""Explicit DB-free API collection. Run from etl/: python3 -m app.collect_main."""
import argparse
import json
from pathlib import Path
import sys

from .api_artifacts import write_run
from .api_config import KEY_NAMES, init_config, load_keys
from .api_http import HttpClient
from .api_records import CollectionError
from . import semas_api, seoul_api, seoul_context
from . import seoul_reference


def parser():
    root = argparse.ArgumentParser(description="Private API collection only; never connects to a DB or publishes data.")
    commands = root.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init-config", help="Create a new key template; never overwrite an existing file")
    init.add_argument("--env-file", type=Path, required=True)
    check = commands.add_parser("check-config", help="Report SET/MISSING only; no network")
    check.add_argument("--env-file", type=Path)
    for name in ("probe", "collect"):
        command = commands.add_parser(name, help="One small page" if name == "probe" else "All pages in the explicit scope")
        command.add_argument("source", choices=("seoul-stores", "seoul-sales", "semas-stores", *seoul_context.SOURCES, *seoul_reference.SOURCES))
        command.add_argument("--env-file", type=Path)
        command.add_argument("--output", type=Path, required=True, help="New absolute run directory under a private 0700 parent outside Git")
        command.add_argument("--quarter", help="Required for stores/sales; optional for workers; unsupported for other context snapshots")
        command.add_argument("--industry", choices=("I21201",), help="Optional SEMAS CAFE-only filter; omission means all Seoul stores")
        command.add_argument("--page-size", type=int)
        command.add_argument("--allow-seoul-http", action="store_true", help="Explicitly send Seoul credentials via the documented plaintext HTTP endpoint")
        command.add_argument("--quarantine-negative-consumption", action="store_true",
                             help="Consumption only: retain negative-value rows only in raw, mark run incomplete and quarantined")
    return root


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "init-config":
            init_config(args.env_file)
            print("CONFIG_CREATED: edit the private file locally; never send key values to chat or Git.")
            return 0
        keys = load_keys(args.env_file)
        if args.command == "check-config":
            print(json.dumps({name: "SET" if keys[name] else "MISSING" for name in KEY_NAMES}))
            return 0 if all(keys.values()) else 2
        probe = args.command == "probe"
        page_size = args.page_size if args.page_size is not None else (5 if probe else 100)
        if probe and not 1 <= page_size <= 5:
            raise CollectionError("PROBE_MAX_FIVE_ROWS")
        if args.source in seoul_reference.SOURCES:
            if args.quarter or args.industry or args.quarantine_negative_consumption:
                raise CollectionError("REFERENCE_CURRENT_SNAPSHOT_ONLY")
            if not keys['SEOUL_OPENAPI_KEY']:
                raise CollectionError("SEOUL_KEY_MISSING")
            result = seoul_reference.collect_reference(args.output, args.source, keys['SEOUL_OPENAPI_KEY'],
                page_size=page_size, probe=probe, allow_http=args.allow_seoul_http)
            print(json.dumps({k: result[k] for k in ('status', 'complete', 'published', 'received_count', 'declared_count')}))
            return 0
        if args.source in seoul_context.SOURCES:
            spec = seoul_context.specification(args.source, args.quarter)
            if args.quarantine_negative_consumption and args.source != "seoul-consumption":
                raise CollectionError("CONTEXT_QUARANTINE_SCOPE_UNSUPPORTED")
            if args.industry:
                raise CollectionError("CONTEXT_INDUSTRY_FILTER_UNSUPPORTED")
            key = keys["SEOUL_OPENAPI_KEY"]
            if not key:
                raise CollectionError("SEOUL_KEY_MISSING")
            pages = seoul_context.pages(HttpClient(), args.source, key, period=args.quarter,
                page_size=page_size, probe=probe, allow_http=args.allow_seoul_http,
                quarantine_negative=args.quarantine_negative_consumption)
            scope = dict(region="SEOUL", spatial_unit="ADMINISTRATIVE_DONG", service=spec.service,
                dataset=spec.dataset, period_scope=args.quarter or "ALL_SOURCE_PERIODS",
                transport="http-explicit-opt-in" if args.allow_seoul_http else "https",
                observation_date=None, annual_repeated_values=spec.annual,
                quarantine_negative_consumption=args.quarantine_negative_consumption)
        elif args.source.startswith("seoul-"):
            if args.quarantine_negative_consumption:
                raise CollectionError("CONTEXT_QUARANTINE_SCOPE_UNSUPPORTED")
            if not args.quarter or args.industry:
                raise CollectionError("SEOUL_QUARTER_REQUIRED_NO_INDUSTRY_FILTER")
            key = keys["SEOUL_OPENAPI_KEY"]
            if not key:
                raise CollectionError("SEOUL_KEY_MISSING")
            pages = seoul_api.pages(HttpClient(), args.source.removeprefix("seoul-"), args.quarter, key,
                                    page_size=page_size, probe=probe, allow_http=args.allow_seoul_http)
            scope = dict(quarter=args.quarter, region="SEOUL", industry="ALL_SOURCE_INDUSTRIES",
                         transport="http-explicit-opt-in" if args.allow_seoul_http else "https",
                         service=seoul_api.SERVICES[args.source.removeprefix("seoul-")][0])
        else:
            if args.quarantine_negative_consumption:
                raise CollectionError("CONTEXT_QUARANTINE_SCOPE_UNSUPPORTED")
            if args.quarter or args.allow_seoul_http:
                raise CollectionError("INVALID_SEMAS_OPTIONS")
            key = keys["SEMAS_SERVICE_KEY"]
            if not key:
                raise CollectionError("SEMAS_KEY_MISSING")
            pages = semas_api.pages(HttpClient(), key, industry=args.industry, page_size=page_size, probe=probe)
            scope = dict(region="11", industry=args.industry or "ALL_SOURCE_INDUSTRIES", transport="https",
                         service="storeListInDong")
        result = write_run(args.output, pages, source=args.source, scope=scope, mode=args.command)
        print(json.dumps({k: result[k] for k in ("status", "complete", "published", "received_count", "declared_count")}))
        if result["status"] == "QUARANTINED_UNPUBLISHED":
            return 3
        return 0
    except CollectionError as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 2
    except OSError:
        print("ERROR: PRIVATE_FILE_OPERATION_FAILED", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("ERROR: COLLECTION_INTERRUPTED", file=sys.stderr)
        return 130
    except Exception:
        print("ERROR: UNEXPECTED_COLLECTION_FAILURE", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
