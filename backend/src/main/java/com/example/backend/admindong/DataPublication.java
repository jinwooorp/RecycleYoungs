package com.example.backend.admindong;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Explicit reader mode. API mode never falls back to legacy tables on failure. */
@Repository
public class DataPublication {
    private final JdbcClient jdbc;
    private final boolean enabled;
    public DataPublication(JdbcClient jdbc, @Value("${app.data.api-release-enabled:false}") boolean enabled) {
        this.jdbc=jdbc; this.enabled=enabled;
    }
    public record Metadata(String dataVersion, String collectedAt, String storeReferenceMonth,
                           String storeScope, String sourceSnapshotStatus) {}
    public Metadata metadata() {
        if (!enabled) return null; // Legacy data has no verified publication catalog.
        var rows=jdbc.sql("""
            SELECT r.release_id, r.metadata->>'collected_at' AS collected_at,
                r.metadata->>'store_reference_month' AS reference_month, r.metadata->>'store_scope' AS store_scope
            FROM api_current_release c JOIN api_releases r ON c.release_id=r.release_id
            WHERE c.singleton=true AND r.status='READY'
            """).query((rs,n)->new Metadata(rs.getString("release_id"),rs.getString("collected_at"),
                rs.getString("reference_month"),rs.getString("store_scope"),"UNVERIFIED")).list();
        if (rows.size()!=1) throw new DataIntegrityException();
        var m=rows.getFirst();
        if (m.dataVersion()==null || !m.dataVersion().matches("[0-9a-f]{64}") || m.collectedAt()==null
            || m.storeReferenceMonth()==null || !m.storeReferenceMonth().matches("[12][0-9]{3}(0[1-9]|1[0-2])")
            || !("I21201".equals(m.storeScope()) || "ALL_SOURCE_INDUSTRIES".equals(m.storeScope()))) throw new DataIntegrityException();
        java.time.OffsetDateTime.parse(m.collectedAt());
        return m;
    }
    public Metadata requireVersion(String expected) {
        var value=metadata();
        String actual=value==null?"legacy-unversioned":value.dataVersion();
        if (expected!=null && !expected.equals(actual)) throw new DataVersionChangedException();
        return value;
    }
    public String sql(String query) {
        if (!enabled) return query;
        return query.replaceAll("\\bstore_stats_dong\\b","published_store_stats_dong")
            .replaceAll("\\bsales_dong\\b","published_sales_dong").replaceAll("\\bstores\\b","published_stores");
    }
}
