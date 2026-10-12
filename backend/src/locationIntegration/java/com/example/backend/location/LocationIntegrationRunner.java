package com.example.backend.location;

import com.example.backend.BackendApplication;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Opt-in real JDBC/HTTP harness. It cannot run with the ordinary test task. */
public final class LocationIntegrationRunner {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final List<Map<String, Object>> RESULTS = new ArrayList<>();
    private static final String ADMIN = "9007199254740993", COMMERCIAL = "9007199254740994", REPLACEMENT = "9007199254740995";
    private static DataSource isolated;
    private static JdbcClient jdbc;
    private static ConfigurableApplicationContext context;
    private static volatile boolean missingSchema;

    @Configuration(proxyBeanMethods = false)
    public static class IsolatedConfiguration {
        @Bean DataSource dataSource() { return isolated; }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing isolation proof field: " + name);
        return value;
    }

    static DataSource guardedDataSource() {
        var owner = required("LOCATION_OWNER");
        var host = required("LOCATION_DB_HOST");
        var database = required("LOCATION_DB_NAME");
        var user = required("LOCATION_DB_USER");
        var sid = required("LOCATION_DB_SID");
        var pgdata = required("LOCATION_PGDATA");
        if (!owner.matches("[0-9a-f]{24}") || !host.equals("ry-8c1-db-" + owner)
            || !database.equals("recycleyoungs_integration_test_" + owner) || !user.equals("integration_test")
            || !sid.matches("[0-9]+") || !pgdata.equals("/var/lib/postgresql/data/pgdata")
            || !required("LOCATION_DB_CONTAINER_ID").matches("[0-9a-f]{64}")
            || !required("LOCATION_NETWORK_ID").matches("[0-9a-f]{64}")) throw new IllegalStateException("Isolation routing proof rejected");
        var delegate = new DriverManagerDataSource("jdbc:postgresql://" + host + ":5432/" + database + "?connectTimeout=5&socketTimeout=30",
            user, required("LOCATION_JDBC_PASSWORD"));
        return new AbstractDataSource() {
            @Override public Connection getConnection() throws SQLException { return verify(delegate.getConnection()); }
            @Override public Connection getConnection(String username, String password) throws SQLException {
                throw new SQLException("Caller credential overrides are forbidden");
            }
            private Connection verify(Connection connection) throws SQLException {
                try {
                    try (var statement = connection.createStatement()) {
                        statement.execute("SET lock_timeout='5s'; SET statement_timeout='30s'");
                        try (var rs = statement.executeQuery("SELECT current_database(),current_user,session_user,"
                            + "(SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),"
                            + "current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout')")) {
                            if (!rs.next() || !database.equals(rs.getString(1)) || !user.equals(rs.getString(2))
                                || !user.equals(rs.getString(3)) || !sid.equals(rs.getString(4)) || !pgdata.equals(rs.getString(5))
                                || !"5432".equals(rs.getString(6)) || !"5s".equals(rs.getString(7)) || !"30s".equals(rs.getString(8))) {
                                throw new SQLException("Connected isolated identity rejected");
                            }
                        }
                        if (missingSchema) statement.execute("SET search_path=pg_catalog");
                    }
                    return connection;
                } catch (SQLException ex) { connection.close(); throw ex; }
            }
        };
    }

    public static void main(String[] args) {
        try {
            isolated = guardedDataSource();
            jdbc = JdbcClient.create(isolated);
            // The guarded DS validates every connection, including actual Flyway migration connections.
            Flyway.configure().dataSource(isolated).locations("classpath:db/migration").cleanDisabled(true).load().migrate();
            equal(List.of("1", "2", "3"), jdbc.sql("SELECT version FROM flyway_schema_history WHERE success ORDER BY installed_rank")
                .query(String.class).list(), "migration history");
            System.out.println("LOCATION_IDENTITY " + JSON.writeValueAsString(Map.of(
                "postgres", jdbc.sql("SHOW server_version").query(String.class).single(),
                "postgis", jdbc.sql("SELECT PostGIS_Full_Version()").query(String.class).single(),
                "java", System.getProperty("java.version"), "migrations", List.of("1", "2", "3"))));
            fixtures();
            var app = new SpringApplication(BackendApplication.class, IsolatedConfiguration.class);
            app.setDefaultProperties(Map.of("spring.flyway.enabled", "false", "spring.sql.init.mode", "never",
                "server.port", "8080", "spring.main.banner-mode", "off", "logging.level.root", "WARN"));
            context = app.run();
            spatialChecks();
            versionChecks();
            errorsAndStats();
            explain();
            var browser = coordinate(200100, 500100);
            System.out.println("LOCATION_RESULT " + JSON.writeValueAsString(Map.of("status", "PASS", "checks", RESULTS,
                "browserCoordinate", browser, "adminVersion", ADMIN, "commercialVersion", COMMERCIAL)));
            // Tomcat keeps this verified runner alive for the subsequent Chrome HTTP bridge.
        } catch (Throwable failure) {
            System.out.println("LOCATION_FAILURE " + JSON.writeValueAsString(Map.of("status", "FAIL", "type", failure.getClass().getName(),
                "message", String.valueOf(failure.getMessage()), "checks", RESULTS)));
            if (context != null) context.close();
            System.exit(1);
        }
    }

    private static void equal(Object expected, Object actual, String label) {
        if (!java.util.Objects.equals(expected, actual)) throw new AssertionError(label + " expected=" + expected + " actual=" + actual);
    }
    private static void pass(String name, Object expected, Object actual) {
        equal(expected, actual, name);
        RESULTS.add(Map.of("name", name, "expected", expected, "actual", actual, "status", "PASS"));
    }
    private static String hash(String text) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception ex) { throw new IllegalStateException(ex); }
    }
    private static String rectangle(int x1, int y1, int x2, int y2) {
        return "POLYGON((" + x1 + " " + y1 + "," + x2 + " " + y1 + "," + x2 + " " + y2 + "," + x1 + " " + y2 + "," + x1 + " " + y1 + "))";
    }

    private static void publish(String id, String kind, List<String> codes, List<String> geometries, String tag, boolean ready) {
        new TransactionTemplate(new DataSourceTransactionManager(isolated)).executeWithoutResult(transaction -> {
            jdbc.sql("""
                INSERT INTO spatial_dataset_versions (id,boundary_kind,dataset_id,dataset_name,source_url,source_file_name,
                    source_file_sha256,source_crs,reference_date,reference_date_verified,historical_compatibility_status,
                    historical_compatibility_notes,validation_status,validation_report_path,validation_report_sha256,
                    processing_profile_sha256,processing_metadata,feature_count,notes)
                VALUES (:id,:kind,:dataset,'합성 fixture 경계','https://example.invalid/synthetic','synthetic.wkt',:source,5181,
                    DATE '2026-10-12',true,'UNRESOLVED','합성 fixture: 실자료/역사 호환 검증 아님',:validation,
                    'synthetic://location-integration-v2',:report,:profile,CAST(:metadata AS jsonb),:count,'테스트 합성 자료')
                """).param("id", Long.parseLong(id)).param("kind", kind)
                .param("dataset", kind.equals("ADMIN_DONG") ? "OA-22160" : "OA-15560")
                .param("source", hash(tag + geometries)).param("report", hash("synthetic-report-" + tag))
                .param("profile", hash("synthetic-profile-v2")).param("metadata", "{\"synthetic\":true}")
                .param("count", geometries.size()).param("validation", ready ? "PASSED_WITH_LIMITATIONS" : "REVIEW_REQUIRED").update();
            for (int i = 0; i < codes.size(); i++) {
                boolean admin = kind.equals("ADMIN_DONG");
                String table = admin ? "admin_dong_boundaries" : "commercial_area_boundaries";
                String fields = admin ? "dong_code,dong_name" : "commercial_area_code,source_name";
                // Table/column names are fixed harness constants, never input coordinates.
                jdbc.sql("INSERT INTO " + table + " (dataset_version_id," + fields + ",source_feature_index,source_geometry,"
                    + "operational_geometry,quality_status,source_geometry_sha256,operational_geometry_sha256) "
                    + "SELECT :id,:code,:name,:index,g,g,'VALID_SOURCE',encode(sha256(ST_AsBinary(g,'NDR')),'hex'),"
                    + "encode(sha256(ST_AsBinary(g,'NDR')),'hex') FROM (SELECT ST_Multi(ST_GeomFromText(:wkt,5181)) g) source")
                    .param("id", Long.parseLong(id)).param("code", codes.get(i)).param("name", "합성 " + (admin ? "동 " : "상권 ") + codes.get(i))
                    .param("index", i).param("wkt", geometries.get(i)).update();
            }
            if (ready) {
                jdbc.sql("UPDATE spatial_dataset_versions SET load_status='READY' WHERE id=:id").param("id", Long.parseLong(id)).update();
                // Separate lifecycle transition is required by the actual V2 trigger.
                jdbc.sql("UPDATE spatial_dataset_versions SET is_current=true WHERE id=:id").param("id", Long.parseLong(id)).update();
            }
        });
    }

    private static void fixtures() {
        publish(ADMIN, "ADMIN_DONG", List.of("99000001", "99000002", "99000003", "99000004", "99000005"), List.of(
            rectangle(200000,500000,201000,501000), rectangle(199000,500000,200000,501000),
            rectangle(200250,500250,200750,500750),
            "POLYGON((199000 503000,201000 503000,201000 505000,199000 505000,199000 503000),(200000 503500,200000 504500,200500 504500,200500 503500,200000 503500))",
            rectangle(200000,498000,201000,499500)), "admin-v1", true);
        publish(COMMERCIAL, "COMMERCIAL_AREA", List.of("9901", "9902"), List.of(
            rectangle(199500,499500,201500,501500), rectangle(200050,500050,200900,500900)), "commercial-v1", true);
        for (int q = 20251; q <= 20254; q++) {
            jdbc.sql("""
                INSERT INTO store_stats_dong (quarter_code,dong_code,dong_name,source_industry_code,industry_id,
                    store_count,similar_store_count,opening_store_count,closing_store_count,franchise_store_count)
                SELECT :q,'99000001','합성 동 99000001','CS100010',id,7,8,1,0,NULL FROM industries WHERE code='CAFE'
                """).param("q", q).update();
            jdbc.sql("""
                INSERT INTO sales_dong (quarter_code,dong_code,dong_name,source_industry_code,industry_id,
                    sales_amount,transaction_count,weekday_sales_amount,weekend_sales_amount)
                SELECT :q,'99000001','합성 동 99000001','CS100010',id,9007199254740993,0,NULL,0 FROM industries WHERE code='CAFE'
                """).param("q", q).update();
        }
    }

    private static LocationResponses.Coordinate coordinate(double x, double y) {
        return jdbc.sql("SELECT ST_Y(g) lat,ST_X(g) lng FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(:x,:y),5181),4326) g) p")
            .param("x", x).param("y", y).query((rs,n) -> new LocationResponses.Coordinate(rs.getDouble("lat"),rs.getDouble("lng"))).single();
    }
    private record Response(int status, JsonNode body) {}
    private static Response get(String path) {
        try {
            var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080" + path))
                .timeout(Duration.ofSeconds(15)).GET().build(), HttpResponse.BodyHandlers.ofString());
            return new Response(response.statusCode(), JSON.readTree(response.body()));
        } catch (Exception ex) { throw new IllegalStateException("Local isolated HTTP probe failed", ex); }
    }
    private static Response resolve(LocationResponses.Coordinate coordinate) {
        return get("/api/locations/resolve?lat=" + coordinate.lat() + "&lng=" + coordinate.lng());
    }
    private static List<String> codes(JsonNode array) {
        var result = new ArrayList<String>();
        array.forEach(node -> result.add(node.get("code").asString()));
        return result;
    }

    private static void spatialCase(String name, double x, double y, List<String> dongs, String relation, List<String> areas) {
        var exact = jdbc.sql("SELECT dong_code FROM admin_dong_boundaries WHERE dataset_version_id=:id "
            + "AND ST_Covers(operational_geometry,ST_SetSRID(ST_MakePoint(:x,:y),5181)) ORDER BY dong_code")
            .param("id", Long.parseLong(ADMIN)).param("x", x).param("y", y).query(String.class).list();
        pass(name + " exact5181 candidates", dongs, exact);
        var c = coordinate(x,y);
        var repository = new LocationRepository(jdbc);
        var service = new LocationService(repository);
        var result = service.resolve(c);
        var serviceCodes = result.adminDong().resolvedDong() != null ? List.of(result.adminDong().resolvedDong().code())
            : result.adminDong().candidates().stream().map(LocationResponses.Dong::code).toList();
        pass(name + " actual JdbcClient4326 candidates", dongs, serviceCodes);
        var response = resolve(c);
        equal(200,response.status,name + " HTTP");
        var admin = response.body.get("adminDong");
        var actual = admin.get("resolvedDong").isNull() ? codes(admin.get("candidates")) : List.of(admin.get("resolvedDong").get("code").asString());
        pass(name + " HTTP candidates", dongs, actual);
        pass(name + " memberships", areas, codes(response.body.get("commercialArea").get("memberships")));
        equal(dongs.isEmpty() ? "OUTSIDE_OR_UNSUPPORTED" : dongs.size()==1 ? "RESOLVED" : "AMBIGUOUS_BOUNDARY", admin.get("status").asString(), name + " status");
        if (dongs.isEmpty()) equal("NO_COVERING_OPERATIONAL_BOUNDARY", admin.get("reason").asString(), name + " reason");
        if (relation != null) {
            var matches = admin.get("resolvedDong").isNull() ? admin.get("candidates") : JSON.valueToTree(List.of(result.adminDong().resolvedDong()));
            matches.forEach(node -> equal(relation,node.get("pointRelation").asString(),name + " point relation"));
        }
        equal(areas.isEmpty()?"NO_MEMBERSHIP":"MEMBERSHIP", response.body.get("commercialArea").get("status").asString(),name+" commercial status");
    }

    private static void spatialChecks() {
        spatialCase("interior",200100,500100,List.of("99000001"),"INTERIOR",List.of("9901","9902"));
        spatialCase("outside",205000,506000,List.of(),null,List.of());
        spatialCase("outer boundary",200000,498500,List.of("99000005"),"BOUNDARY",List.of());
        spatialCase("shared boundary",200000,500500,List.of("99000001","99000002"),"BOUNDARY",List.of("9901"));
        spatialCase("positive area overlap",200500,500500,List.of("99000001","99000003"),"INTERIOR",List.of("9901","9902"));
        spatialCase("hole interior",200250,504000,List.of(),null,List.of());
        spatialCase("hole ring",200000,504000,List.of("99000004"),"BOUNDARY",List.of());
        spatialCase("one commercial only",201250,501250,List.of(),null,List.of("9901"));
        for (var c : List.of(new LocationResponses.Coordinate(0,37), new LocationResponses.Coordinate(90,180),
            new LocationResponses.Coordinate(-90,-180), new LocationResponses.Coordinate(33.96,126),
            new LocationResponses.Coordinate(38.33,128),new LocationResponses.Coordinate(33.959999,126),new LocationResponses.Coordinate(38.330001,128))) {
            var r = resolve(c);
            equal(200,r.status,"valid global coordinate HTTP");
            equal("OUTSIDE_OR_UNSUPPORTED",r.body.get("adminDong").get("status").asString(),"global domain");
            pass("supported projection/global input " + c, "200 OUTSIDE_OR_UNSUPPORTED", r.status + " " + r.body.get("adminDong").get("status").asString());
        }
        var body = resolve(coordinate(200100,500100)).body;
        pass("BIGINT version string",ADMIN,body.get("adminDong").get("dataset").get("version").asString());
        equal(true,body.get("adminDong").get("dataset").get("version").isString(),"version JSON type");
        pass("reference date", "2026-10-12",body.get("adminDong").get("dataset").get("referenceDate").asString());
        OffsetDateTime.parse(body.get("adminDong").get("dataset").get("loadedAt").asString());
    }

    private static void current(String version, boolean value) {
        jdbc.sql("UPDATE spatial_dataset_versions SET is_current=:value WHERE id=:id").param("value",value).param("id",Long.parseLong(version)).update();
    }
    private static void versionChecks() {
        var c = coordinate(200100,500100);
        for (String id : List.of(ADMIN,COMMERCIAL)) {
            current(id,false);
            try { var r=resolve(c); pass("missing current " + id,503,r.status); equal("BOUNDARY_DATA_UNAVAILABLE",r.body.get("code").asString(),"missing error code"); }
            finally { current(id,true); }
        }
        publish("9007199254740996","ADMIN_DONG",List.of("99000009"),List.of(rectangle(200000,500000,201000,501000)),"pending",false);
        pass("PENDING is not selected",ADMIN,resolve(c).body.get("adminDong").get("dataset").get("version").asString());
        current(ADMIN,false);
        try {
            // Remove competing current first, so a unique-current conflict cannot mask this guard.
            rejectedByTrigger("actual V2 rejects unverified PENDING current",()->current("9007199254740996",true));
            pass("PENDING alone is unavailable",503,resolve(c).status);
            rejectedByTrigger("actual V2 rejects unverified READY publication",()->jdbc.sql(
                "UPDATE spatial_dataset_versions SET load_status='READY' WHERE id=9007199254740996").update());
        } finally { current(ADMIN,true); }
        rejectedByTrigger("actual V2 rejects boundary UPDATE",()->jdbc.sql(
            "UPDATE admin_dong_boundaries SET dong_name=dong_name WHERE dataset_version_id=9007199254740993").update());
        current(ADMIN,false);
        try {
            publish(REPLACEMENT,"ADMIN_DONG",List.of("99000006"),List.of(rectangle(200000,500000,201000,501000)),"replacement",true);
            var r=resolve(c);
            pass("current replacement version",REPLACEMENT,r.body.get("adminDong").get("dataset").get("version").asString());
            pass("current replacement geometry", "99000006",r.body.get("adminDong").get("resolvedDong").get("code").asString());
        } finally { current(REPLACEMENT,false); current(ADMIN,true); }
        // A second connection switches current while the first retains a repeatable-read snapshot.
        try (var connection=isolated.getConnection()) {
            connection.setAutoCommit(false); connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            try (var statement=connection.createStatement()) { statement.execute("SET TRANSACTION READ ONLY"); }
            var snapshot=JdbcClient.create(new org.springframework.jdbc.datasource.SingleConnectionDataSource(connection,true));
            equal(ADMIN,new LocationService(new LocationRepository(snapshot)).resolve(c).adminDong().dataset().version(),"snapshot before");
            new TransactionTemplate(new DataSourceTransactionManager(isolated)).executeWithoutResult(tx->{current(ADMIN,false);current(REPLACEMENT,true);});
            try {
                var retained=new LocationService(new LocationRepository(snapshot)).resolve(c);
                pass("same snapshot retains matching version",ADMIN,retained.adminDong().dataset().version());
                pass("same snapshot retains matching geometry","99000001",retained.adminDong().resolvedDong().code());
                pass("new snapshot sees replacement",REPLACEMENT,resolve(c).body.get("adminDong").get("dataset").get("version").asString());
            } finally { current(REPLACEMENT,false);current(ADMIN,true);connection.rollback(); }
        } catch(SQLException ex) {throw new IllegalStateException(ex);}
    }

    private static void rejectedByTrigger(String name, Runnable operation) {
        String state=null;
        try { operation.run(); } catch(org.springframework.dao.DataAccessException expected) {
            for(Throwable cause=expected;cause!=null;cause=cause.getCause()) {
                if(cause instanceof SQLException sql) { state=sql.getSQLState();break; }
            }
        }
        pass(name,"P0001",state == null ? "NO_TRIGGER_REJECTION" : state);
    }

    private static void errorsAndStats() {
        for(String path:List.of("/api/locations/resolve?lat=NaN&lng=127","/api/locations/resolve?lat=91&lng=127",
            "/api/locations/resolve?lat=38&lat=38&lng=127","/api/locations/resolve?lat=38&lng=127&foo=1")) {
            pass("invalid query HTTP " + path,400,get(path).status);
        }
        // Schema/triggers remain intact. Fault injection affects only new test connections.
        var errorCoordinate=coordinate(200100,500100);
        missingSchema=true;
        try { var r=resolve(errorCoordinate);pass("real SQL error HTTP",500,r.status);
            equal("INTERNAL_ERROR",r.body.get("code").asString(),"SQL safe error");
            equal(3,r.body.size(),"safe error fields");
            equal("서버 오류가 발생했습니다.",r.body.get("message").asString(),"safe public message");
        } finally {missingSchema=false;}
        var stats=get("/api/admin-dong-stats?dongCode=99000001&industryCode=CAFE&quarterCode=20251");
        pass("existing stats HTTP",200,stats.status);
        pass("existing BIGINT exact string","9007199254740993",stats.body.get("salesStats").get("estimatedSalesAmount").asString());
        equal(true,stats.body.get("salesStats").get("weekdayEstimatedSalesAmount").isNull(),"stat NULL");
        equal("0",stats.body.get("salesStats").get("transactionCount").asString(),"stat actual zero");
        pass("existing trends quarters",4,get("/api/admin-dong-trends?dongCode=99000001&industryCode=CAFE").body.get("quarters").size());
        pass("lookup excludes polygon-only dong",List.of("99000001"),codes(get("/api/admin-dongs").body));
        pass("existing stats invalid query",400,get("/api/admin-dong-stats?dongCode=bad&industryCode=CAFE&quarterCode=20251").status);
    }

    private static void explain() {
        var c=coordinate(200100,500100);
        var plan=jdbc.sql("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) " + LocationRepository.RESOLVE_SQL)
            .param("lat",c.lat()).param("lng",c.lng()).param("projectionSupported",true).query(String.class).single();
        var value=JSON.readTree(plan).get(0);
        var indexNames=jdbc.sql("SELECT indexname FROM pg_indexes WHERE tablename IN ('admin_dong_boundaries','commercial_area_boundaries') AND indexdef LIKE '%gist%' ORDER BY indexname")
            .query(String.class).list();
        pass("actual operational GiST indexes",List.of("idx_admin_dong_boundaries_operational","idx_commercial_area_boundaries_operational"),indexNames);
        System.out.println("LOCATION_EXPLAIN " + JSON.writeValueAsString(Map.of("planningMs",value.get("Planning Time").asDouble(),
            "executionMs",value.get("Execution Time").asDouble(),"plan",value.get("Plan"))));
    }
}
