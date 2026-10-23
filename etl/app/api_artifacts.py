"""Streaming private run artifacts. Collection never implies publication."""
from datetime import datetime, timezone
import hashlib
import json
import os

from .api_config import private_parent
from .api_records import CollectionError, NORMALIZER_VERSION
from .seoul_context import SOURCES as CONTEXT_SOURCES, CONTEXT_NORMALIZER_VERSION, QualityReport


class EvidenceRecords(list):
    """Source location is private process state, never part of a release digest."""
    def __init__(self, values, source_path):
        super().__init__(values)
        self.source_path = source_path


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def create_file(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb")


def manifest_write(output, manifest, *, first=False):
    name = "manifest.json" if first else "manifest.next.json"
    with create_file(output / name) as target:
        target.write(encoded(manifest))
    if not first:
        os.replace(output / name, output / "manifest.json")


def write_run(output, pages, *, source, scope, mode):
    context_source = source in CONTEXT_SOURCES
    if source not in ("seoul-stores", "seoul-sales", "semas-stores") and not context_source:
        raise CollectionError("INVALID_RUN_SCOPE")
    if mode not in ("probe", "collect"):
        raise CollectionError("INVALID_RUN_SCOPE")
    output = private_parent(output)
    try:
        output.mkdir(mode=0o700)
    except FileExistsError:
        raise CollectionError("OUTPUT_ALREADY_EXISTS") from None
    (output / "pages").mkdir(mode=0o700)
    manifest = dict(schema_version=1, normalizer_version=CONTEXT_NORMALIZER_VERSION if context_source else NORMALIZER_VERSION,
                    source=source, scope=scope,
                    mode=mode, started_at=now(), status="IN_PROGRESS", complete=False,
                    published=False, received_count=0, unique_key_count=0, declared_count=None,
                    page_count=0, source_periods=[], pages=[],
                    methodology="SEOUL_2026-07-03_NOTICE_REQUIRES_PARITY_REVIEW" if source.startswith("seoul-") else None,
                    limitations=["Source snapshot consistency and historical parity are not established.",
                                 "Store absence or source deletion is not proof of business closure."])
    manifest_write(output, manifest, first=True)
    keys, digest, periods = set(), hashlib.sha256(), set()
    quality = QualityReport(source) if context_source else None
    if context_source:
        manifest.update(normalized_count=0, quarantined_count=0, raw_complete=False)
    try:
        with create_file(output / "normalized.jsonl") as target:
            for page in pages:
                if page.number != manifest["page_count"] + 1:
                    raise CollectionError("PAGE_SEQUENCE_MISMATCH")
                if manifest["declared_count"] is not None and page.total != manifest["declared_count"]:
                    raise CollectionError("SOURCE_TOTAL_CHANGED")
                manifest["declared_count"] = page.total
                for row in page.records:
                    key = row["source_store_id"] if source == "semas-stores" else tuple(
                        row[k] for k in (("quarter_code", "dong_code") if context_source else
                                         ("quarter_code", "dong_code", "source_industry_code")))
                    if key in keys:
                        raise CollectionError("DUPLICATE_SOURCE_KEY")
                    keys.add(key)
                    if quality is not None:
                        quality.observe(row)
                quarantined = getattr(page, "quarantined", ()) if context_source else ()
                for row in quarantined:
                    key = (row["quarter_code"], row["dong_code"])
                    if key in keys:
                        raise CollectionError("DUPLICATE_SOURCE_KEY")
                    keys.add(key)
                    quality.quarantine(row)
                # Keep only validated raw pages; an interrupted run remains unpublished.
                name = f"{page.number:06d}.json"
                with create_file(output / "pages" / name) as raw:
                    raw.write(page.raw)
                for row in page.records:
                    line = encoded(row)
                    target.write(line)
                    digest.update(line)
                periods.update(page.source_periods)
                manifest["page_count"] += 1
                manifest["received_count"] += len(page.records) + len(quarantined)
                if context_source:
                    manifest["normalized_count"] += len(page.records)
                    manifest["quarantined_count"] += len(quarantined)
                manifest["unique_key_count"] = len(keys)
                manifest["pages"].append(dict(file="pages/" + name, sha256=hashlib.sha256(page.raw).hexdigest(),
                                               received_count=len(page.records) + len(quarantined)))
        if manifest["page_count"] == 0:
            raise CollectionError("NO_PAGES_RECEIVED")
        if mode == "collect" and manifest["received_count"] != manifest["declared_count"]:
            raise CollectionError("COLLECTION_COUNT_MISMATCH")
        nonempty = manifest["received_count"] > 0
        manifest.update(status="PROBE_ONLY" if mode == "probe" else (
            "COLLECTED_UNPUBLISHED" if nonempty else "EMPTY_UNPUBLISHED"),
            complete=mode == "collect" and nonempty, normalized_sha256=digest.hexdigest(),
            source_periods=sorted(periods), finished_at=now())
        if quality is not None:
            manifest["raw_complete"] = manifest["complete"]
            if manifest["quarantined_count"]:
                manifest.update(status="PROBE_ONLY" if mode == "probe" else "QUARANTINED_UNPUBLISHED", complete=False)
            report = encoded(quality.finish(complete=manifest["complete"], raw_complete=manifest["raw_complete"]))
            with create_file(output / "quality.json") as target:
                target.write(report)
            manifest["quality_report"] = dict(file="quality.json", sha256=hashlib.sha256(report).hexdigest())
    except BaseException as error:
        manifest.update(status="FAILED", complete=False,
                        error=str(error) if isinstance(error, CollectionError) else "COLLECTION_INTERRUPTED",
                        finished_at=now(), source_periods=sorted(periods))
        if context_source:
            manifest["raw_complete"] = False
        manifest_write(output, manifest)
        raise
    manifest_write(output, manifest)
    return manifest
