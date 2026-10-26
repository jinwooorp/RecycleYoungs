package com.example.backend.admindong;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class ReferenceRepository {
    private final JdbcClient jdbc;
    public ReferenceRepository(JdbcClient jdbc) { this.jdbc=jdbc; }
    public boolean available() {
        return jdbc.sql("SELECT to_regclass('public.api_reference_current') IS NOT NULL").query(Boolean.class).single();
    }
    public record SourceRow(String sourceId,String snapshotId,String descriptor,int recordCount,int rawRowCount,String status) {}
    public record RecordRow(String recordId,String attributes,String attributeStates,String metrics,int sourceRowCount) {}
    public List<SourceRow> sources() {
        return jdbc.sql("""
            SELECT c.source_id,c.snapshot_id,s.descriptor::text,s.record_count,s.raw_row_count,s.status
            FROM api_reference_current c JOIN api_reference_snapshots s ON s.snapshot_id=c.snapshot_id AND s.source_id=c.source_id
            ORDER BY c.source_id
            """).query((rs,n)->new SourceRow(rs.getString(1),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getInt(5),rs.getString(6))).list();
    }
    private static final String FILTER="snapshot_id=:snapshot AND (:query='' OR position(lower(:query) in lower(record_id || ' ' || attributes::text))>0)";
    public int count(String snapshot,String search) {
        return jdbc.sql("SELECT count(*) FROM api_reference_records WHERE "+FILTER).param("snapshot",snapshot).param("query",search).query(Integer.class).single();
    }
    public List<RecordRow> records(String snapshot,String search,int offset) {
        return jdbc.sql("SELECT record_id,attributes::text,attribute_states::text,metrics::text,source_row_count FROM api_reference_records WHERE "+FILTER+" ORDER BY record_id COLLATE \"C\" LIMIT 20 OFFSET :offset")
            .param("snapshot",snapshot).param("query",search).param("offset",offset)
            .query((rs,n)->new RecordRow(rs.getString(1),rs.getString(2),rs.getString(3),rs.getString(4),rs.getInt(5))).list();
    }
}
