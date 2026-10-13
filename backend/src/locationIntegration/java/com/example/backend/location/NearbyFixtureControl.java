package com.example.backend.location;

import org.springframework.jdbc.core.simple.JdbcClient;

/** Narrow mapping switch for synthetic Chrome QA; every connection retains the isolation identity guard. */
public final class NearbyFixtureControl {
    public static void main(String[] args) {
        if (args.length != 1 || !(args[0].equals("mapping-off") || args[0].equals("mapping-on") || args[0].equals("pub-statistics")))
            throw new IllegalArgumentException("Unknown synthetic fixture command");
        var jdbc = JdbcClient.create(LocationIntegrationRunner.guardedDataSource());
        if (jdbc.sql("SELECT count(*) FROM stores WHERE source_store_id NOT LIKE 'synthetic-%'").query(Long.class).single() != 0)
            throw new IllegalStateException("Only the synthetic stores fixture is permitted");
        if (args[0].equals("pub-statistics")) {
            jdbc.sql("""
                INSERT INTO store_stats_dong(quarter_code,dong_code,dong_name,source_industry_code,industry_id,store_count)
                SELECT 20251,'99000001','합성 동 99000001','CS100009',i.id,3 FROM industries i
                    JOIN industry_mappings m ON m.industry_id=i.id AND m.source='SEOUL' AND m.source_code='CS100009'
                WHERE i.code='PUB' ON CONFLICT(quarter_code,dong_code,source_industry_code) DO NOTHING
                """).update();
            if (jdbc.sql("""
                SELECT count(*) FROM store_stats_dong WHERE quarter_code=20251 AND dong_code='99000001'
                    AND dong_name='합성 동 99000001' AND source_industry_code='CS100009' AND store_count=3
                    AND industry_id=(SELECT id FROM industries WHERE code='PUB')
                """).query(Long.class).single() != 1) throw new IllegalStateException("Synthetic PUB statistic differs");
            System.out.println("{\"syntheticPubStatistics\":true}");
            return;
        }
        var ids = jdbc.sql("SELECT industry_id FROM industry_mappings WHERE source='SEMAS' AND source_code='I21201'").query(Long.class).list();
        long cafeId = jdbc.sql("SELECT id FROM industries WHERE code='CAFE'").query(Long.class).single();
        if (ids.size() > 1 || (!ids.isEmpty() && ids.getFirst() != cafeId)) throw new IllegalStateException("Fixture mapping differs");
        if (args[0].equals("mapping-off")) {
            if (ids.size() != 1) throw new IllegalStateException("Fixture mapping already off");
            jdbc.sql("DELETE FROM industry_mappings WHERE source='SEMAS' AND source_code='I21201' AND industry_id=:id").param("id",cafeId).update();
        } else {
            if (!ids.isEmpty()) throw new IllegalStateException("Fixture mapping already on");
            jdbc.sql("INSERT INTO industry_mappings(source,source_code,industry_id) VALUES ('SEMAS','I21201',:id)").param("id",cafeId).update();
        }
        System.out.println("{\"syntheticMapping\":\"" + args[0] + "\"}");
    }
}
