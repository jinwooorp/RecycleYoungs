package com.example.backend.admindong;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Repository
public class AdminDongContextRepository {
    private final JdbcClient jdbc;
    public AdminDongContextRepository(JdbcClient jdbc) { this.jdbc=jdbc; }
    public JsonNode release(String version) {
        var rows=jdbc.sql("SELECT metadata::text FROM api_releases WHERE release_id=:version AND status='READY'")
            .param("version",version).query(String.class).list();
        if (rows.size()!=1) throw new DataIntegrityException();
        return parse(rows.getFirst());
    }
    public record Row(String sourceId,String state,String runId,String policyVersion,String descriptor,
        boolean hasPeriod,String metrics,String attributes) {}
    public List<Row> rows(String version,String dong,String period) {
        return jdbc.sql("""
            SELECT s.source_id,s.state,s.run_id,s.policy_version,r.descriptor::text,
                COALESCE(jsonb_exists(r.descriptor->'quarters',:period),false) AS has_period,t.metrics::text,t.attributes::text
            FROM api_release_context_sources s LEFT JOIN api_context_runs r ON r.run_id=s.run_id
            LEFT JOIN api_context_rows t ON t.run_id=s.run_id AND t.dong_code=:dong AND t.quarter_code=:period
            WHERE s.release_id=:version ORDER BY s.source_id
            """).param("version",version).param("dong",dong).param("period",period)
            .query((rs,n)->new Row(rs.getString("source_id"),rs.getString("state"),rs.getString("run_id"),
                rs.getString("policy_version"),rs.getString("descriptor"),rs.getBoolean("has_period"),
                rs.getString("metrics"),rs.getString("attributes"))).list();
    }
    static JsonNode parse(String json) {
        try { return JsonMapper.builder().build().readTree(json); }
        catch (RuntimeException ex) { throw new DataIntegrityException(); }
    }
}
