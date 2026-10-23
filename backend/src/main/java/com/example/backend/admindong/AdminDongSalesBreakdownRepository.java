package com.example.backend.admindong;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;

@Repository
public class AdminDongSalesBreakdownRepository {
    private final JdbcClient jdbc;
    private final DataPublication publication;
    public AdminDongSalesBreakdownRepository(JdbcClient jdbc,DataPublication publication) {
        this.jdbc=jdbc; this.publication=publication;
    }
    public List<JsonNode> rows(String dong,String source,String period) {
        return jdbc.sql(publication.sql("""
            SELECT to_jsonb(t)::text FROM sales_dong t
            WHERE t.dong_code=:dong AND t.source_industry_code=:source AND t.quarter_code=:period
            """)).param("dong",dong).param("source",source).param("period",Integer.parseInt(period))
            .query(String.class).list().stream().map(AdminDongContextRepository::parse).toList();
    }
}
