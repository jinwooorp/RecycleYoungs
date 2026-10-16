package com.example.backend.admindong;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class RegionRepository {
    private final JdbcClient jdbc;
    public RegionRepository(JdbcClient jdbc) { this.jdbc = jdbc; }
    record BoundaryRow(String version, String code, String name, String quality, String detail,
        String historicalCompatibility, String validationStatus, String referenceDate, boolean referenceDateVerified,
        String geometry) {}
    List<BoundaryRow> boundaries(String code) {
        return jdbc.sql("""
            SELECT v.id::text AS version, b.dong_code, b.dong_name, b.quality_status, b.quality_detail,
                v.historical_compatibility_status, v.validation_status, v.reference_date, v.reference_date_verified,
                CASE WHEN :code <> '' AND b.dong_code = :code
                    AND b.quality_status IN ('VALID_SOURCE','REPAIRED_OPERATIONAL')
                    THEN ST_AsGeoJSON(ST_Transform(b.operational_geometry,4326), 8) ELSE NULL END AS geometry
            FROM spatial_dataset_versions v JOIN admin_dong_boundaries b ON b.dataset_version_id = v.id
            WHERE v.boundary_kind = 'ADMIN_DONG' AND v.is_current AND v.load_status = 'READY'
                AND v.validation_status IN ('PASSED','PASSED_WITH_LIMITATIONS')
                AND b.operational_geometry IS NOT NULL
                AND b.quality_status IN ('VALID_SOURCE','REPAIRED_OPERATIONAL')
            ORDER BY b.dong_code
            """).param("code", code).query((rs, n) -> new BoundaryRow(rs.getString("version"), rs.getString("dong_code"),
                rs.getString("dong_name"), rs.getString("quality_status"), rs.getString("quality_detail"),
                rs.getString("historical_compatibility_status"), rs.getString("validation_status"), rs.getString("reference_date"),
                rs.getBoolean("reference_date_verified"), rs.getString("geometry"))).list();
    }
}
