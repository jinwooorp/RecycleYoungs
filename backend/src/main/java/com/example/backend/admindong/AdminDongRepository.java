package com.example.backend.admindong;

import java.util.List;
import java.util.Map;
import java.util.HashMap;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AdminDongRepository {
    // Keep table identity: names may differ across tables, but not within one table/quarter/dong.
    private static final String MAPPED_ROWS = """
        WITH mapped_rows AS (
            SELECT 'store' AS kind, t.quarter_code, t.dong_code, t.dong_name,
                   t.source_industry_code, t.industry_id, im.industry_id AS mapped_industry_id
            FROM store_stats_dong t JOIN industry_mappings im
              ON im.source = 'SEOUL' AND im.source_code = t.source_industry_code
            UNION ALL
            SELECT 'sales', t.quarter_code, t.dong_code, t.dong_name,
                   t.source_industry_code, t.industry_id, im.industry_id
            FROM sales_dong t JOIN industry_mappings im
              ON im.source = 'SEOUL' AND im.source_code = t.source_industry_code
        )
        """;

    private final JdbcClient jdbc;

    public AdminDongRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    public record Industry(long id, String code, String name, String sourceCode, boolean available) {}
    public record Lookup(List<ApiResponses.NamedCode> dongs, List<Industry> industries,
                         List<ApiResponses.Quarter> quarters) {}

    public Lookup lookup() {
        var industries = jdbc.sql("""
            SELECT i.id, i.code, i.name, im.source_code,
                (EXISTS (SELECT 1 FROM store_stats_dong t WHERE t.source_industry_code = im.source_code)
                 OR EXISTS (SELECT 1 FROM sales_dong t WHERE t.source_industry_code = im.source_code)) AS available
            FROM industries i LEFT JOIN industry_mappings im ON im.industry_id = i.id AND im.source = 'SEOUL'
            ORDER BY i.code, im.source_code
            """).query((rs, n) -> new Industry(rs.getLong("id"), rs.getString("code"),
                rs.getString("name"), rs.getString("source_code"), rs.getBoolean("available"))).list();
        if (industries.stream().map(Industry::code).distinct().count() != industries.size()) {
            throw new DataIntegrityException();
        }
        boolean invalid = jdbc.sql(MAPPED_ROWS + """
            SELECT EXISTS (SELECT 1 FROM mapped_rows WHERE industry_id IS DISTINCT FROM mapped_industry_id)
                OR EXISTS (SELECT 1 FROM mapped_rows GROUP BY kind, quarter_code, dong_code, source_industry_code
                           HAVING count(*) > 1)
                OR EXISTS (SELECT 1 FROM mapped_rows GROUP BY kind, quarter_code, dong_code
                           HAVING count(DISTINCT dong_name) > 1)
            """).query(Boolean.class).single();
        if (invalid) throw new DataIntegrityException();

        var dongs = jdbc.sql(MAPPED_ROWS + """
            SELECT DISTINCT ON (dong_code) dong_code, dong_name
            FROM mapped_rows
            ORDER BY dong_code, quarter_code DESC, CASE kind WHEN 'store' THEN 0 ELSE 1 END
            """).query((rs, n) -> new ApiResponses.NamedCode(rs.getString("dong_code"), rs.getString("dong_name"))).list();
        var quarters = jdbc.sql(MAPPED_ROWS + "SELECT DISTINCT quarter_code FROM mapped_rows ORDER BY quarter_code")
            .query(Integer.class).list().stream().map(code -> {
                String value = code.toString();
                if (!value.matches("[1-9][0-9]{3}[1-4]")) throw new DataIntegrityException();
                return new ApiResponses.Quarter(value, value.substring(0, 4) + "년 " + value.charAt(4) + "분기");
            }).toList();
        return new Lookup(dongs, industries, quarters);
    }
    public record StoreRow(Integer storeCount, Integer similarStoreCount, Integer openingStoreCount,
                           Integer closingStoreCount, Integer franchiseStoreCount) {}
    public record SalesRow(Long salesAmount, Long transactionCount, Long weekdaySalesAmount, Long weekendSalesAmount) {}

    public StoreRow store(String dong, String sourceCode, String quarter) {
        var rows = jdbc.sql("""
            SELECT store_count, similar_store_count, opening_store_count, closing_store_count, franchise_store_count
            FROM store_stats_dong
            WHERE dong_code = :dong AND source_industry_code = :source AND quarter_code = :quarter
            """).param("dong", dong).param("source", sourceCode).param("quarter", Integer.parseInt(quarter))
            .query((rs, n) -> storeRow(rs)).list();
        return singleOrAbsent(rows);
    }

    public SalesRow sales(String dong, String sourceCode, String quarter) {
        var rows = jdbc.sql("""
            SELECT sales_amount, transaction_count, weekday_sales_amount, weekend_sales_amount
            FROM sales_dong
            WHERE dong_code = :dong AND source_industry_code = :source AND quarter_code = :quarter
            """).param("dong", dong).param("source", sourceCode).param("quarter", Integer.parseInt(quarter))
            .query((rs, n) -> salesRow(rs)).list();
        return singleOrAbsent(rows);
    }

    public Map<String, StoreRow> stores(String dong, String sourceCode, List<String> quarters) {
        var rows = jdbc.sql("""
            SELECT quarter_code, store_count, similar_store_count, opening_store_count, closing_store_count, franchise_store_count
            FROM store_stats_dong
            WHERE dong_code = :dong AND source_industry_code = :source AND quarter_code IN (:quarters)
            ORDER BY quarter_code
            """).param("dong", dong).param("source", sourceCode)
            .param("quarters", quarters.stream().map(Integer::valueOf).toList())
            .query((rs, n) -> Map.entry(rs.getString("quarter_code"), storeRow(rs))).list();
        return byQuarter(rows);
    }

    public Map<String, SalesRow> salesByQuarter(String dong, String sourceCode, List<String> quarters) {
        var rows = jdbc.sql("""
            SELECT quarter_code, sales_amount, transaction_count, weekday_sales_amount, weekend_sales_amount
            FROM sales_dong
            WHERE dong_code = :dong AND source_industry_code = :source AND quarter_code IN (:quarters)
            ORDER BY quarter_code
            """).param("dong", dong).param("source", sourceCode)
            .param("quarters", quarters.stream().map(Integer::valueOf).toList())
            .query((rs, n) -> Map.entry(rs.getString("quarter_code"), salesRow(rs))).list();
        return byQuarter(rows);
    }

    private static StoreRow storeRow(ResultSet rs) throws SQLException {
        return new StoreRow(rs.getObject("store_count", Integer.class), rs.getObject("similar_store_count", Integer.class),
            rs.getObject("opening_store_count", Integer.class), rs.getObject("closing_store_count", Integer.class),
            rs.getObject("franchise_store_count", Integer.class));
    }

    private static SalesRow salesRow(ResultSet rs) throws SQLException {
        return new SalesRow(rs.getObject("sales_amount", Long.class), rs.getObject("transaction_count", Long.class),
            rs.getObject("weekday_sales_amount", Long.class), rs.getObject("weekend_sales_amount", Long.class));
    }

    private static <T> Map<String, T> byQuarter(List<Map.Entry<String, T>> rows) {
        var result = new HashMap<String, T>();
        for (var row : rows) {
            if (result.putIfAbsent(row.getKey(), row.getValue()) != null) throw new DataIntegrityException();
        }
        return Map.copyOf(result);
    }

    private static <T> T singleOrAbsent(List<T> rows) {
        if (rows.size() > 1) throw new DataIntegrityException();
        return rows.isEmpty() ? null : rows.getFirst();
    }

}
