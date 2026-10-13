package com.example.backend.location;

import com.example.backend.BackendApplication;
import com.example.backend.nearby.NearbyRepository;
import com.example.backend.nearby.NearbyResponses;
import com.example.backend.nearby.NearbyService;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.AbstractDataSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Synthetic stores only, in a fresh DB owned and routed by the existing isolation controller. */
public final class NearbyIntegrationRunner {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final List<Map<String, Object>> CHECKS = new ArrayList<>();
    private static DataSource isolated;
    private static JdbcClient jdbc;
    private static NearbyResponses.Query query;
    private static ConfigurableApplicationContext context;
    private static volatile boolean missingSchema;
    @Configuration(proxyBeanMethods = false)
    @org.springframework.context.annotation.Profile("nearby-integration")
    public static class IsolatedConfiguration { @Bean DataSource dataSource() { return isolated; } }

    public static void main(String[] args) {
        try {
            var guarded = LocationIntegrationRunner.guardedDataSource();
            isolated = new AbstractDataSource() {
                @Override public Connection getConnection() throws SQLException {
                    var c = guarded.getConnection();
                    try {
                        if (missingSchema) try (var s = c.createStatement()) { s.execute("SET search_path=pg_catalog"); }
                        return c;
                    } catch (SQLException ex) { c.close(); throw ex; }
                }
                @Override public Connection getConnection(String user, String password) throws SQLException {
                    throw new SQLException("Credential overrides forbidden");
                }
            };
            jdbc = JdbcClient.create(isolated);
            Flyway.configure().dataSource(isolated).locations("classpath:db/migration").cleanDisabled(true).load().migrate();
            check("Original V1/V2/V3", List.of("1", "2", "3"), jdbc.sql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank").query(String.class).list());
            check("Empty isolated stores", 0L, jdbc.sql("SELECT count(*) FROM stores").query(Long.class).single());
            query = new NearbyResponses.Query(jdbc.sql("""
                SELECT ST_Y(g) lat, ST_X(g) lng FROM
                (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(200100,500100),5181),4326) g) p
                """).query((rs, n) -> new NearbyResponses.Coordinate(rs.getDouble("lat"), rs.getDouble("lng"))).single(), 500, "CAFE");
            var app = new SpringApplication(BackendApplication.class, IsolatedConfiguration.class);
            app.setAdditionalProfiles("nearby-integration");
            app.setDefaultProperties(Map.of("spring.flyway.enabled", "false", "spring.sql.init.mode", "never",
                "server.port", "8080", "spring.main.banner-mode", "off", "logging.level.root", "WARN"));
            context = app.run();
            check("Empty stores HTTP503", "STORES_DATA_UNAVAILABLE", api(query, 503).get("code").asText());
            fixtures();
            spatialChecks();
            dataChecks();
            inputAndRegressionChecks();
            listChecks();
            bboxChecks();
            explain();
            System.out.println("NEARBY_IDENTITY " + JSON.writeValueAsString(Map.of("postgres", jdbc.sql("SHOW server_version").query(String.class).single(),
                "postgis", jdbc.sql("SELECT PostGIS_Full_Version()").query(String.class).single(), "java", System.getProperty("java.version"), "migrations", List.of("1", "2", "3"))));
            System.out.println("NEARBY_RESULT " + JSON.writeValueAsString(Map.of("status", "PASS", "checks", CHECKS, "browserCoordinate", query.coordinate(),
                "response", api(query, 200))));
            // Verified internal Tomcat stays alive for browser probes; only the owner controller removes it.
        } catch (Throwable failure) {
            System.out.println("NEARBY_FAILURE " + JSON.writeValueAsString(Map.of("status", "FAIL", "type", failure.getClass().getName(),
                "message", String.valueOf(failure.getMessage()), "checks", CHECKS)));
            if (context != null) context.close();
            System.exit(1);
        }
    }

    private static void check(String name, Object expected, Object actual) {
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(name + " expected=" + expected + " actual=" + actual);
        CHECKS.add(Map.of("name", name, "expected", expected, "actual", actual, "status", "PASS"));
    }
    private static JsonNode http(String path, int status) throws Exception {
        var r = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080" + path))
            .timeout(Duration.ofSeconds(30)).GET().build(), HttpResponse.BodyHandlers.ofString());
        if (r.statusCode() != status) throw new AssertionError("HTTP " + path + " expected=" + status + " actual=" + r.statusCode() + " public body=" + r.body());
        return JSON.readTree(r.body());
    }
    private static JsonNode api(NearbyResponses.Query q, int status) throws Exception {
        return http("/api/nearby-stores?lat=" + q.coordinate().lat() + "&lng=" + q.coordinate().lng() + "&radius=500&industryCode=CAFE", status);
    }
    private static void insert(String id, String category, String industry, Double distance, double azimuth) {
        jdbc.sql("""
            INSERT INTO stores(source_store_id,name,source_small_category_code,industry_id,longitude,latitude,location)
            SELECT :id, '합성 카페 ' || :id, :category, (SELECT id FROM industries WHERE code=:industry),
                ST_X(g),ST_Y(g),g FROM (SELECT CASE WHEN :distance::double precision IS NULL THEN NULL::geometry ELSE
                    ST_Project(ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography,:distance,:azimuth)::geometry END g) p
            """).param("id", id).param("category", category).param("industry", industry)
            .param("distance", distance, java.sql.Types.DOUBLE).param("azimuth", azimuth)
            .param("lng", query.coordinate().lng()).param("lat", query.coordinate().lat()).update();
    }
    private static void fixtures() {
        insert("synthetic-center", "I21201", "CAFE", 0.0, 0);
        insert("synthetic-tie-a", "I21201", "CAFE", 100.0, 0);
        insert("synthetic-tie-b", "I21201", "CAFE", 100.0, 0);
        insert("synthetic-inside", "I21201", "CAFE", 499.999, Math.PI / 2);
        insert("synthetic-boundary", "I21201", "CAFE", 500.0, 0);
        insert("synthetic-outside", "I21201", "CAFE", 500.001, 0);
        insert("synthetic-far", "I21201", "CAFE", 5000.0, 0);
        insert("synthetic-other-industry", "I20101", "KFOOD", 0.0, 0);
        insert("synthetic-other-category", "I21202", "CAFE", 0.0, 0);
        insert("synthetic-unclassified", "I21201", null, 0.0, 0);
        insert("synthetic-null-location", "I21201", "CAFE", null, 0);
        insert("synthetic-incomplete-source", "I21201", "CAFE", 50.0, 0);
        jdbc.sql("UPDATE stores SET longitude=NULL,latitude=NULL WHERE source_store_id='synthetic-incomplete-source'").update();
        jdbc.sql("""
            INSERT INTO stores(source_store_id,name,source_small_category_code,industry_id,longitude,latitude,location)
            SELECT 'synthetic-invalid-location','합성 범위 밖 POINT','I21201',id,200,95,ST_SetSRID(ST_MakePoint(200,95),4326)
            FROM industries WHERE code='CAFE'
            """).update();
        jdbc.sql("""
            INSERT INTO stores(source_store_id,source_small_category_code,industry_id,location)
            SELECT 'synthetic-empty-location','I21201',id,ST_GeomFromText('POINT EMPTY',4326) FROM industries WHERE code='CAFE'
            """).update();
        check("Fixture total", 14L, jdbc.sql("SELECT count(*) FROM stores").query(Long.class).single());
    }
    private static List<String> ids(NearbyResponses.Result r) { return r.stores().stream().map(NearbyResponses.Store::sourceStoreId).toList(); }
    private static void spatialChecks() throws Exception {
        var service = new NearbyService(new NearbyRepository(jdbc));
        var r = service.find(query);
        check("Real JDBC total within 500", "6", r.totalCount());
        check("Distance and stable tie order", List.of("synthetic-center", "synthetic-incomplete-source", "synthetic-tie-a", "synthetic-tie-b", "synthetic-inside", "synthetic-boundary"), ids(r));
        check("Center distance", 0.0, r.stores().getFirst().distanceMeters());
        var boundary = jdbc.sql("""
            SELECT ST_Distance(location::geography,ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography,true) distance,
                ST_DWithin(location::geography,ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography,500,true) raw_covered,
                ST_DWithin(location::geography,ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography,501,true) covered
            FROM stores WHERE source_store_id='synthetic-boundary'
            """).param("lng", query.coordinate().lng()).param("lat", query.coordinate().lat())
            .query((rs,n)->Map.of("distance",rs.getDouble("distance"),"covered",rs.getBoolean("covered"),"rawCovered",rs.getBoolean("raw_covered"))).single();
        check("Projected 500m measured distance", 500.0, boundary.get("distance"));
        check("Projected 500m wider ST_DWithin candidate inclusion", true, boundary.get("covered"));
        System.out.println("NEARBY_BOUNDARY_PRECISION " + JSON.writeValueAsString(boundary));
        check("500.001m excluded", false, ids(r).contains("synthetic-outside"));
        check("Null, invalid, empty, unclassified, foreign categories excluded", true,
            ids(r).stream().noneMatch(id -> List.of("synthetic-null-location", "synthetic-invalid-location", "synthetic-empty-location", "synthetic-unclassified", "synthetic-other-category", "synthetic-other-industry").contains(id)));
        var response = api(query,200);
        check("HTTP total BIGINT string", true, response.get("totalCount").isString());
        check("HTTP list numeric", 6, response.get("listedCount").asInt());
        check("HTTP distance numeric", true, response.get("stores").get(1).get("distanceMeters").isNumber());
        check("HTTP source coordinate preserved", query.coordinate().lat(), response.get("stores").get(0).get("coordinate").get("lat").asDouble());
        check("Quality null location", "1", response.get("data").get("quality").get("missingLocationCafeCount").asText());
        check("Quality invalid and empty", "2", response.get("data").get("quality").get("invalidLocationCafeCount").asText());
        check("Quality unclassified", "1", response.get("data").get("quality").get("unclassifiedCafeCount").asText());
        check("Quality incomplete source coordinates", "4", response.get("data").get("quality").get("incompleteSourceCoordinateCafeCount").asText());
        check("Snapshot UNVERIFIED", "UNVERIFIED", response.get("data").get("snapshotStatus").asText());
        check("Snapshot date null", true, response.get("data").get("referenceDate").isNull());
        check("Snapshot loadedAt null", true, response.get("data").get("loadedAt").isNull());
        var outside = new NearbyResponses.Query(new NearbyResponses.Coordinate(37.8,127.2),500,"CAFE");
        check("Available inventory but empty radius", "0", api(outside,200).get("totalCount").asText());
        check("Empty radius complete list", true, api(outside,200).get("listComplete").asBoolean());
    }
    private static void dataChecks() throws Exception {
        jdbc.sql("DELETE FROM industry_mappings WHERE source='SEMAS' AND source_code='I21201'").update();
        check("Missing mapping HTTP503", "CAFE_MAPPING_UNAVAILABLE", api(query,503).get("code").asText());
        jdbc.sql("INSERT INTO industry_mappings(source,source_code,industry_id) SELECT 'SEMAS','I21201',id FROM industries WHERE code='KFOOD'").update();
        check("Conflicting mapping HTTP503", "CAFE_MAPPING_UNAVAILABLE", api(query,503).get("code").asText());
        jdbc.sql("UPDATE industry_mappings SET industry_id=(SELECT id FROM industries WHERE code='CAFE') WHERE source='SEMAS' AND source_code='I21201'").update();
        jdbc.sql("UPDATE stores SET source_small_category_code='TEST-NOT-CAFE' WHERE source_small_category_code='I21201'").update();
        check("Only other categories present HTTP503", "CAFE_DATA_UNAVAILABLE", api(query,503).get("code").asText());
        jdbc.sql("UPDATE stores SET source_small_category_code='I21201' WHERE source_small_category_code='TEST-NOT-CAFE'").update();
        insert("synthetic-conflict", "I21201", "PUB", 0.0,0);
        check("Non-CAFE classification integrity HTTP500", "DATA_INTEGRITY_ERROR", api(query,500).get("code").asText());
        jdbc.sql("DELETE FROM stores WHERE source_store_id='synthetic-conflict'").update();
        jdbc.sql("UPDATE stores SET industry_id=NULL WHERE source_small_category_code='I21201'").update();
        check("No usable classified cafes HTTP503", "CAFE_DATA_UNAVAILABLE", api(query,503).get("code").asText());
        jdbc.sql("UPDATE stores SET industry_id=(SELECT id FROM industries WHERE code='CAFE') WHERE source_small_category_code='I21201' AND source_store_id<>'synthetic-unclassified'").update();
        try {
            insert("synthetic-center", "I21201", "CAFE", 0.0, 0);
            throw new AssertionError("Duplicate source_store_id accepted");
        } catch (org.springframework.dao.DuplicateKeyException expected) { check("Schema enforces unique source_store_id", true, true); }
        missingSchema=true;
        try {
            var error=api(query,500);
            check("Actual SQL error safe code", "INTERNAL_ERROR", error.get("code").asText());
            check("Actual SQL error three public fields", 3, error.size());
            check("No SQL/stack in response", false, error.toString().matches("(?s).*(SELECT|jdbc:|SQLException|password|stackTrace).*"));
        } finally { missingSchema=false; }
        check("Restored query after failure", "6", api(query,200).get("totalCount").asText());
    }
    private static void inputAndRegressionChecks() throws Exception {
        for (var suffix:List.of("lat=NaN&lng=127&radius=500&industryCode=CAFE", "lat=91&lng=127&radius=500&industryCode=CAFE",
            "lat=37&lng=127&radius=501&industryCode=CAFE", "lat=37&lng=127&radius=500&industryCode=PUB",
            "lat=37&lat=38&lng=127&radius=500&industryCode=CAFE", "lat=37&lng=127&radius=500&industryCode=CAFE&unknown=x",
            "lng=127&radius=500&industryCode=CAFE")) {
            check("Invalid HTTP400 " + suffix, 3, http("/api/nearby-stores?"+suffix,400).size());
        }
        check("Location regression HTTP200", "RESOLVED", http("/api/locations/resolve?lat=" + query.coordinate().lat() + "&lng=" + query.coordinate().lng(),200).get("adminDong").get("status").asText());
        var stats=http("/api/admin-dong-stats?dongCode=99000001&industryCode=CAFE&quarterCode=20251",200);
        check("Existing stats BIGINT", "9007199254740993", stats.get("salesStats").get("estimatedSalesAmount").asText());
        check("Existing trend quarter count", 4, http("/api/admin-dong-trends?dongCode=99000001&industryCode=CAFE",200).get("quarters").size());
        for(var c:List.of(new NearbyResponses.Coordinate(0,0),new NearbyResponses.Coordinate(90,180),new NearbyResponses.Coordinate(-90,-180),
            new NearbyResponses.Coordinate(0,179.999),new NearbyResponses.Coordinate(79.99,20)))
            check("Global valid input HTTP200 " + c,"0",api(new NearbyResponses.Query(c,500,"CAFE"),200).get("totalCount").asText());
    }
    private static void listChecks() throws Exception {
        for(int n=0;n<120;n++) insert("synthetic-limit-%03d".formatted(n),"I21201","CAFE", 200.0,0);
        var r=new NearbyService(new NearbyRepository(jdbc)).find(query);
        check("Full count before list cap", "126", r.totalCount());
        check("List capped at 100", 100, r.listedCount());
        check("Incomplete list flag", false, r.listComplete());
        check("Count/list cap HTTP", "126", api(query,200).get("totalCount").asText());
        check("Deterministic repeated list", ids(r), ids(new NearbyService(new NearbyRepository(jdbc)).find(query)));
        jdbc.sql("DELETE FROM stores WHERE source_store_id LIKE 'synthetic-limit-%'").update();
        insert("synthetic-\uE000","I21201","CAFE",0.0,0);
        insert("synthetic-\uD800\uDC00","I21201","CAFE",0.0,0);
        var unicode=new NearbyService(new NearbyRepository(jdbc)).find(query);
        check("Real UTF8 tie ordering",true,ids(unicode).indexOf("synthetic-\uE000") < ids(unicode).indexOf("synthetic-\uD800\uDC00"));
        check("Unicode source IDs HTTP200","8",api(query,200).get("totalCount").asText());
        jdbc.sql("DELETE FROM stores WHERE source_store_id IN (:a,:b)").param("a","synthetic-\uE000").param("b","synthetic-\uD800\uDC00").update();
    }
    private static void bboxChecks() {
        for(var c:List.of(query.coordinate(),new NearbyResponses.Coordinate(0,0),new NearbyResponses.Coordinate(79.99,20),
            new NearbyResponses.Coordinate(-79.99,20),new NearbyResponses.Coordinate(0,179.999),
            new NearbyResponses.Coordinate(89.999,0),new NearbyResponses.Coordinate(-90,-180))) {
            var q=new NearbyResponses.Query(c,500,"CAFE"); var b=NearbyRepository.bounds(q);
            var missed=jdbc.sql("""
                SELECT count(*) FROM (
                    SELECT ST_Project(ST_SetSRID(ST_MakePoint(:lng,:lat),4326)::geography,499.999,radians(a))::geometry g
                    FROM generate_series(0,359) a
                ) p WHERE NOT (g && ST_MakeEnvelope(:minLng,:minLat,:maxLng,:maxLat,4326))
                """).param("lng",c.lng()).param("lat",c.lat()).param("minLng",b.minLng()).param("minLat",b.minLat())
                .param("maxLng",b.maxLng()).param("maxLat",b.maxLat()).query(Long.class).single();
            check("Conservative bbox 360 geodesic bearings " + c,0L,missed);
        }
    }
    private static List<String> plan() {
        var b=NearbyRepository.bounds(query);
        return jdbc.sql("EXPLAIN (ANALYZE,BUFFERS,FORMAT TEXT) " + NearbyRepository.SQL)
            .param("lat",query.coordinate().lat()).param("lng",query.coordinate().lng()).param("radius",500).param("listLimit",100)
            .param("candidateRadius",501)
            .param("minLng",b.minLng()).param("minLat",b.minLat()).param("maxLng",b.maxLng()).param("maxLat",b.maxLat()).query(String.class).list();
    }
    private static void explain() {
        System.out.println("NEARBY_EXPLAIN_SMALL " + JSON.writeValueAsString(Map.of("syntheticRows",14,"plan",plan())));
        jdbc.sql("""
            INSERT INTO stores(source_store_id,name,source_small_category_code,industry_id,location)
            SELECT 'synthetic-scale-' || n,'합성 원거리 카페','I21201',i.id,
                ST_SetSRID(ST_MakePoint(125.5 + (n%1000)*0.003,35 + (n/1000)*0.05),4326)
            FROM generate_series(1,20000) n CROSS JOIN industries i WHERE i.code='CAFE'
            """).update();
        jdbc.sql("ANALYZE stores").update();
        var plan=plan();
        check("Existing geometry GiST index available", true, jdbc.sql("SELECT indexdef FROM pg_indexes WHERE indexname='idx_stores_location'").query(String.class).single().contains("USING gist (location)"));
        check("Scaled plan uses existing geometry index", true, plan.stream().anyMatch(line->line.contains("idx_stores_location")));
        System.out.println("NEARBY_EXPLAIN " + JSON.writeValueAsString(Map.of("syntheticScale",20000,"plan",plan)));
        jdbc.sql("DELETE FROM stores WHERE source_store_id LIKE 'synthetic-scale-%'").update();
    }
}
