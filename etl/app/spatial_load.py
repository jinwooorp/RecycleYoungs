"""One transaction per boundary kind; immutable READY reuse and atomic current selection."""

from dataclasses import asdict, dataclass
from datetime import date, datetime
import json
from pathlib import Path

from psycopg import pq, sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .spatial_geometry import canonical_json, profile_sha256, sha256


LAYOUTS = {
    'ADMIN_DONG': ('admin_dong_boundaries', 'dong_code', 'dong_name', 1),
    'COMMERCIAL_AREA': ('commercial_area_boundaries', 'commercial_area_code', 'source_name', 2),
}
ATTRIBUTES = ('source_sigungu_code', 'source_dong_code', 'source_attribute_status', 'source_attribute_detail')


@dataclass(frozen=True)
class PublicationResult:
    version_id: int
    created: bool
    current_changed: bool
    processing_profile_sha256: str


def dataset_metadata(conn, prepared):
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute("SELECT current_setting('server_version') AS postgresql, postgis_lib_version() AS postgis, postgis_geos_version() AS geos, postgis_proj_version() AS proj")
        versions = cur.fetchone()
    if not all(versions.values()):
        raise ValueError('database tool versions are unavailable')
    # PROJ diagnostic output can contain physical paths/network settings; identity uses versions only.
    versions = {key: value.split()[0] for key, value in versions.items()}
    profile = json.loads(canonical_json(prepared.profile))
    profile['database'] = versions
    profile['implementation']['spatial_load.py'] = sha256(Path(__file__).read_bytes())
    spec = prepared.spec
    metadata = dict(spec.provenance)
    metadata['downloaded_at'] = datetime.fromisoformat(metadata['downloaded_at']) if metadata['downloaded_at'] else None
    for key in ('source_file_modified_date', 'source_data_updated_date'):
        metadata[key] = date.fromisoformat(metadata[key]) if metadata[key] else None
    primary = 'repair' if spec.boundary_kind == 'COMMERCIAL_AREA' else 'quality'
    metadata.update(
        boundary_kind=spec.boundary_kind, dataset_id=spec.dataset_id,
        source_file_sha256=spec.archive_sha256, source_crs=5181,
        reference_date=None, reference_date_verified=False,
        historical_compatibility_status='UNRESOLVED',
        historical_compatibility_notes='SEOUL 20251-20254 compatibility unresolved; overall B; stage4 known limitation; operational boundary only',
        validation_status='PASSED_WITH_LIMITATIONS', validation_report_path=spec.report_artifacts[primary],
        validation_report_sha256=spec.report_hashes[primary], processing_profile_sha256=profile_sha256(profile),
        processing_metadata=profile, feature_count=len(prepared.features),
        notes='Original archives and pinned reports retained; geometry/code validation does not establish historical identity; H5 unresolved; source overlap unchanged',
    )
    return metadata


def _insert_features(cur, version_id, prepared):
    table, code_column, name_column, _ = LAYOUTS[prepared.spec.boundary_kind]
    columns = ['dataset_version_id', code_column, name_column, 'source_feature_index',
               'source_geometry', 'operational_geometry', 'quality_status', 'quality_detail',
               'repair_method', 'repair_parameters', 'source_geometry_sha256', 'operational_geometry_sha256']
    expressions = [sql.Placeholder() for _ in columns]
    for index in (4, 5):
        expressions[index] = sql.SQL('ST_GeomFromWKB(%s,5181)')
    commercial = prepared.spec.boundary_kind == 'COMMERCIAL_AREA'
    if commercial:
        columns += list(ATTRIBUTES)
        expressions += [sql.Placeholder() for _ in ATTRIBUTES]
    statement = sql.SQL('INSERT INTO public.{} ({}) VALUES ({})').format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, columns)), sql.SQL(',').join(expressions))
    rows = []
    for f in prepared.features:
        row = [version_id, f.code, f.name, f.source_feature_index, f.source_wkb, f.operational_wkb,
               f.quality_status, f.quality_detail, f.repair_method,
               Jsonb(f.repair_parameters) if f.repair_parameters is not None else None,
               f.source_sha256, f.operational_sha256]
        if commercial:
            row += [getattr(f, key) for key in ATTRIBUTES]
        rows.append(row)
    cur.executemany(statement, rows)


def _verify_features(cur, version_id, prepared):
    table, code_column, name_column, _ = LAYOUTS[prepared.spec.boundary_kind]
    attributes = (sql.SQL(',').join(map(sql.Identifier, ATTRIBUTES)) if prepared.spec.boundary_kind == 'COMMERCIAL_AREA'
                  else sql.SQL(',').join(sql.SQL('NULL AS {}').format(sql.Identifier(key)) for key in ATTRIBUTES))
    cur.execute(sql.SQL("""SELECT {} AS code,{} AS name,source_feature_index,
        ST_AsBinary(source_geometry,'NDR') AS source_wkb,
        ST_AsBinary(operational_geometry,'NDR') AS operational_wkb,
        source_geometry_sha256 AS source_sha256,operational_geometry_sha256 AS operational_sha256,
        quality_status,quality_detail,repair_method,repair_parameters,{},
        ST_SRID(source_geometry) AS source_srid,ST_SRID(operational_geometry) AS operational_srid,
        ST_IsValid(operational_geometry) AND NOT ST_IsEmpty(operational_geometry) AS usable,
        encode(sha256(ST_AsBinary(source_geometry,'NDR')),'hex') AS actual_source_hash,
        encode(sha256(ST_AsBinary(operational_geometry,'NDR')),'hex') AS actual_operational_hash
        FROM public.{} WHERE dataset_version_id=%s ORDER BY source_feature_index""").format(
            sql.Identifier(code_column), sql.Identifier(name_column), attributes, sql.Identifier(table)), (version_id,))
    rows = cur.fetchall()
    if len(rows) != len(prepared.features):
        raise ValueError('existing/inserted boundary feature count mismatch')
    for row, feature in zip(rows, prepared.features):
        if not (row.pop('source_srid') == row.pop('operational_srid') == 5181 and row.pop('usable')
                and row.pop('actual_source_hash') == feature.source_sha256
                and row.pop('actual_operational_hash') == feature.operational_sha256):
            raise ValueError('database geometry SRID/quality/hash mismatch')
        row['source_wkb'], row['operational_wkb'] = bytes(row['source_wkb']), bytes(row['operational_wkb'])
        if row != asdict(feature):
            raise ValueError(f'boundary geometry/attribute/metadata mismatch at feature {feature.source_feature_index}')


def publish(conn, prepared):
    if not conn.autocommit or conn.info.transaction_status != pq.TransactionStatus.IDLE:
        raise ValueError('publication requires an idle autocommit connection; owns one kind transaction')
    spec = prepared.spec
    if len(prepared.features) != spec.feature_count or not prepared.features:
        raise ValueError('prepared feature count mismatch')
    with conn.transaction():
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute('SELECT pg_advisory_xact_lock(726007,%s)', (LAYOUTS[spec.boundary_kind][3],))
            metadata = dataset_metadata(conn, prepared)
            cur.execute('SELECT * FROM public.spatial_dataset_versions WHERE dataset_id=%s AND source_file_sha256=%s AND processing_profile_sha256=%s FOR UPDATE',
                        (spec.dataset_id, spec.archive_sha256, metadata['processing_profile_sha256']))
            existing = cur.fetchone()
            created = existing is None
            if existing:
                if existing['load_status'] != 'READY':
                    raise ValueError('PENDING version is not reusable; preserve it and require new verified profile')
                if any(existing[key] != value for key, value in metadata.items()):
                    raise ValueError('existing READY provenance/processing metadata mismatch')
                version_id = existing['id']
            else:
                values = [Jsonb(value) if isinstance(value, dict) else value for value in metadata.values()]
                cur.execute(sql.SQL('INSERT INTO public.spatial_dataset_versions ({}) VALUES ({}) RETURNING id').format(
                    sql.SQL(',').join(map(sql.Identifier, metadata)),
                    sql.SQL(',').join(sql.Placeholder() for _ in metadata)), values)
                version_id = cur.fetchone()['id']
                _insert_features(cur, version_id, prepared)
            _verify_features(cur, version_id, prepared)
            if created:
                # DB validates completeness and sets loaded_at; publication is a separate statement.
                cur.execute("UPDATE public.spatial_dataset_versions SET load_status='READY' WHERE id=%s", (version_id,))
            cur.execute('SELECT id FROM public.spatial_dataset_versions WHERE boundary_kind=%s AND is_current FOR UPDATE', (spec.boundary_kind,))
            current = [row['id'] for row in cur.fetchall()]
            if len(current) > 1:
                raise ValueError('multiple current versions violate the operational contract')
            changed = current != [version_id]
            if changed:
                cur.execute('UPDATE public.spatial_dataset_versions SET is_current=false WHERE boundary_kind=%s AND is_current', (spec.boundary_kind,))
                cur.execute('UPDATE public.spatial_dataset_versions SET is_current=true WHERE id=%s', (version_id,))
    return PublicationResult(version_id, created, changed, metadata['processing_profile_sha256'])
