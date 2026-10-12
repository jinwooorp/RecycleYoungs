package com.example.backend.location;

import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class LocationRepository {
    private final JdbcClient jdbc;
    public LocationRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    record Match(String code, String name, String qualityStatus, String qualityDetail, String pointRelation,
        String sourceAttributeStatus, String sourceAttributeDetail) {}
    record BoundaryRow(String kind, LocationResponses.DatasetVersion dataset, String loadStatus,
        int featureCount, long totalCount, long usableCount, Match match) {}

    // One statement gives both versions, inventory and memberships the same MVCC snapshot.
    // READY versions are immutable under V2; current flags can be switched by publication.
    static final String RESOLVE_SQL = """
        WITH query_point AS MATERIALIZED (
            SELECT CASE WHEN :projectionSupported
                THEN ST_Transform(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 5181)
                ELSE NULL::geometry END AS geom
        ), versions AS MATERIALIZED (
            SELECT * FROM spatial_dataset_versions WHERE is_current
        ), inventories AS (
            SELECT v.id, count(b.id) AS total_count,
                count(b.id) FILTER (WHERE b.operational_geometry IS NOT NULL
                    AND b.quality_status IN ('VALID_SOURCE', 'REPAIRED_OPERATIONAL')) AS usable_count
            FROM versions v LEFT JOIN admin_dong_boundaries b ON b.dataset_version_id = v.id
            WHERE v.boundary_kind = 'ADMIN_DONG' GROUP BY v.id
            UNION ALL
            SELECT v.id, count(b.id),
                count(b.id) FILTER (WHERE b.operational_geometry IS NOT NULL
                    AND b.quality_status IN ('VALID_SOURCE', 'REPAIRED_OPERATIONAL'))
            FROM versions v LEFT JOIN commercial_area_boundaries b ON b.dataset_version_id = v.id
            WHERE v.boundary_kind = 'COMMERCIAL_AREA' GROUP BY v.id
        ), matches AS (
            SELECT v.id AS version_id, b.dong_code AS code, b.dong_name AS name,
                b.quality_status, b.quality_detail,
                CASE WHEN ST_Touches(b.operational_geometry, p.geom) THEN 'BOUNDARY' ELSE 'INTERIOR' END AS point_relation,
                NULL::text AS source_attribute_status, NULL::text AS source_attribute_detail
            FROM versions v JOIN admin_dong_boundaries b ON b.dataset_version_id = v.id
                CROSS JOIN query_point p
            WHERE v.boundary_kind = 'ADMIN_DONG' AND v.load_status = 'READY'
                AND v.validation_status IN ('PASSED', 'PASSED_WITH_LIMITATIONS')
                AND b.operational_geometry IS NOT NULL
                AND b.quality_status IN ('VALID_SOURCE', 'REPAIRED_OPERATIONAL')
                AND ST_Covers(b.operational_geometry, p.geom)
            UNION ALL
            SELECT v.id, b.commercial_area_code, b.source_name, b.quality_status, b.quality_detail,
                CASE WHEN ST_Touches(b.operational_geometry, p.geom) THEN 'BOUNDARY' ELSE 'INTERIOR' END,
                b.source_attribute_status, b.source_attribute_detail
            FROM versions v JOIN commercial_area_boundaries b ON b.dataset_version_id = v.id
                CROSS JOIN query_point p
            WHERE v.boundary_kind = 'COMMERCIAL_AREA' AND v.load_status = 'READY'
                AND v.validation_status IN ('PASSED', 'PASSED_WITH_LIMITATIONS')
                AND b.operational_geometry IS NOT NULL
                AND b.quality_status IN ('VALID_SOURCE', 'REPAIRED_OPERATIONAL')
                AND ST_Covers(b.operational_geometry, p.geom)
        )
        SELECT v.id::text AS version, v.boundary_kind, v.dataset_id, v.dataset_name, v.source_url,
            v.source_crs, v.reference_date, v.reference_date_verified, v.historical_compatibility_status,
            v.validation_status, v.loaded_at, v.load_status, v.feature_count,
            i.total_count, i.usable_count, m.code, m.name, m.quality_status, m.quality_detail,
            m.point_relation, m.source_attribute_status, m.source_attribute_detail
        FROM versions v JOIN inventories i ON i.id = v.id
            LEFT JOIN matches m ON m.version_id = v.id
        ORDER BY v.boundary_kind, v.id, m.code
        """;

    List<BoundaryRow> resolve(LocationResponses.Coordinate coordinate) {
        return jdbc.sql(RESOLVE_SQL).param("lng", coordinate.lng()).param("lat", coordinate.lat())
            .param("projectionSupported", supportsProjection(coordinate))
            .query((rs, index) -> {
                var loadedAt = rs.getObject("loaded_at", OffsetDateTime.class);
                var dataset = new LocationResponses.DatasetVersion(rs.getString("version"), rs.getString("dataset_id"),
                    rs.getString("dataset_name"), rs.getString("source_url"), rs.getInt("source_crs"),
                    rs.getString("reference_date"), rs.getBoolean("reference_date_verified"),
                    rs.getString("historical_compatibility_status"), rs.getString("validation_status"),
                    loadedAt == null ? null : loadedAt.toString());
                var match = rs.getString("code") == null ? null : new Match(rs.getString("code"), rs.getString("name"),
                    rs.getString("quality_status"), rs.getString("quality_detail"), rs.getString("point_relation"),
                    rs.getString("source_attribute_status"), rs.getString("source_attribute_detail"));
                return new BoundaryRow(rs.getString("boundary_kind"), dataset, rs.getString("load_status"),
                    rs.getInt("feature_count"), rs.getLong("total_count"), rs.getLong("usable_count"), match);
            }).list();
    }

    // EPSG:5181 authority area of use: Central Belt, including the supported Seoul datasets.
    // Other valid geographic coordinates remain domain results, without invoking PROJ outside
    // this service's projection support area (e.g. the equatorial transverse-Mercator singularity).
    static boolean supportsProjection(LocationResponses.Coordinate coordinate) {
        return coordinate.lat() >= 33.96 && coordinate.lat() <= 38.33
            && coordinate.lng() >= 126 && coordinate.lng() <= 128;
    }
}
