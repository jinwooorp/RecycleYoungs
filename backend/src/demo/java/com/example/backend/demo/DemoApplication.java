package com.example.backend.demo;

import com.example.backend.BackendApplication;
import java.sql.Connection;
import java.sql.SQLException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.ArrayList;
import java.util.List;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.boot.SpringApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.core.simple.JdbcClient;
import com.example.backend.nearby.NearbyRepository;
import com.example.backend.nearby.NearbyResponses;

/** Explicit demo entry point. Every Flyway and service connection is checked before use. */
public final class DemoApplication {
    private static DataSource guarded;

    @Configuration(proxyBeanMethods = false)
    @Profile("real-data-demo")
    public static class DemoConfiguration {
        @Bean DataSource dataSource() { return guarded; }
    }

    private static String required(String key) {
        String value = System.getenv("DEMO_" + key);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing demo field: " + key);
        return value;
    }

    private static DataSource dataSource(boolean readOnly) {
        String owner = required("OWNER"), host = required("HOST"), database = required("DATABASE");
        String user = required("USER"), sid = required("SID"), pgdata = required("PGDATA");
        if (!owner.matches("[0-9a-f]{24}") || !host.equals("ry-demo-db-" + owner)
            || !database.equals("recycleyoungs_demo_" + owner)
            || !user.equals(readOnly ? "ry_demo_reader" : "ry_demo_owner")
            || !sid.matches("[0-9]+") || sid.equals("7692329130053947430")
            || !pgdata.equals("/var/lib/postgresql/data/pgdata")
            || !required("CONTAINER_ID").matches("[0-9a-f]{64}")
            || required("CONTAINER_ID").equals("983e738d45ac64e2c5c116117d739fde554b17041f417c2110938847c9edf951")
            || !required("NETWORK_ID").matches("[0-9a-f]{64}")) {
            throw new IllegalStateException("Demo routing proof rejected");
        }
        var delegate = new DriverManagerDataSource("jdbc:postgresql://" + host + ":5432/" + database
            + "?connectTimeout=5&socketTimeout=600&ApplicationName=recycleyoungs_demo", user, required("PASSWORD"));
        return new AbstractDataSource() {
            @Override public Connection getConnection() throws SQLException { return verify(delegate.getConnection()); }
            @Override public Connection getConnection(String username, String password) throws SQLException {
                throw new SQLException("Credential overrides forbidden");
            }
            private Connection verify(Connection connection) throws SQLException {
                try (var statement = connection.createStatement()) {
                    statement.execute("SET lock_timeout='5s'");
                    statement.execute("SET statement_timeout='" + (readOnly ? "30s" : "10min") + "'");
                    statement.execute("SET default_transaction_read_only=" + (readOnly ? "on" : "off"));
                    try (var rs = statement.executeQuery("SELECT current_database(),current_user,session_user,"
                        + "(SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),"
                        + "current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout'),"
                        + "current_setting('transaction_read_only')")) {
                        if (!rs.next() || !database.equals(rs.getString(1)) || !user.equals(rs.getString(2))
                            || !user.equals(rs.getString(3)) || !sid.equals(rs.getString(4)) || !pgdata.equals(rs.getString(5))
                            || !"5432".equals(rs.getString(6)) || !"5s".equals(rs.getString(7))
                            || !(readOnly ? "30s" : "10min").equals(rs.getString(8))
                            || !(readOnly ? "on" : "off").equals(rs.getString(9))) {
                            throw new SQLException("Actual demo connection identity rejected");
                        }
                    }
                    return connection;
                } catch (SQLException failure) {
                    connection.close();
                    throw failure;
                }
            }
        };
    }

    public static void main(String[] args) {
        try {
            if (args.length == 1 && args[0].equals("plans")) {
                var jdbc = JdbcClient.create(dataSource(true));
                var mapper = tools.jackson.databind.json.JsonMapper.builder().build();
                var field = com.example.backend.location.LocationRepository.class.getDeclaredField("RESOLVE_SQL");
                field.setAccessible(true);
                String locationSql = (String) field.get(null);
                var plans = new ArrayList<Map<String, Object>>();
                for (var coordinate : List.of(new double[]{37.5665, 126.9780}, new double[]{37.5563, 126.9238},
                        new double[]{37.5445, 127.0557})) {
                    var query = new NearbyResponses.Query(new NearbyResponses.Coordinate(coordinate[0], coordinate[1]), 500, "CAFE");
                    var bounds = NearbyRepository.bounds(query);
                    String nearby = jdbc.sql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + NearbyRepository.SQL)
                        .param("lat", coordinate[0]).param("lng", coordinate[1]).param("radius", 500)
                        .param("candidateRadius", 501).param("listLimit", 100)
                        .param("minLng", bounds.minLng()).param("minLat", bounds.minLat())
                        .param("maxLng", bounds.maxLng()).param("maxLat", bounds.maxLat())
                        .query((rs, index) -> rs.getString(1)).single();
                    String location = jdbc.sql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + locationSql)
                        .param("lat", coordinate[0]).param("lng", coordinate[1]).param("projectionSupported", true)
                        .query((rs, index) -> rs.getString(1)).single();
                    plans.add(Map.of("lat", coordinate[0], "lng", coordinate[1], "nearby", mapper.readTree(nearby),
                        "location", mapper.readTree(location)));
                }
                System.out.println(mapper.writeValueAsString(Map.of("status", "PASS", "actualRepositorySql", true,
                    "readonly", true, "plans", plans)));
                return;
            }
            if (args.length == 2 && args[0].equals("probe") && args[1].startsWith("/api/")) {
                var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080" + args[1]))
                    .timeout(Duration.ofSeconds(35)).GET().build();
                var response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
                    .send(request, HttpResponse.BodyHandlers.ofString());
                System.out.println(tools.jackson.databind.json.JsonMapper.builder().build()
                    .writeValueAsString(Map.of("status", response.statusCode(), "body", response.body())));
                return;
            }
            if (args.length != 1 || !(args[0].equals("migrate") || args[0].equals("serve"))) {
                throw new IllegalArgumentException("Explicit migrate or serve required");
            }
            if (System.in.read() != '\n') throw new IllegalStateException("Started endpoint gate missing");
            boolean readOnly = args[0].equals("serve");
            guarded = dataSource(readOnly);
            try (var connection = guarded.getConnection()) {
                System.out.println("DEMO_JDBC_IDENTITY_PASS mode=" + args[0]);
            }
            if (!readOnly) {
                var result = Flyway.configure().dataSource(guarded).locations("classpath:db/migration")
                    .baselineOnMigrate(false).cleanDisabled(true).load().migrate();
                if (result.migrationsExecuted != 3) throw new IllegalStateException("Expected fresh V1/V2/V3");
                System.out.println("DEMO_MIGRATIONS_PASS count=3");
                return;
            }
            var application = new SpringApplication(BackendApplication.class, DemoConfiguration.class);
            application.setAdditionalProfiles("real-data-demo");
            application.setDefaultProperties(Map.of("spring.main.banner-mode", "off", "logging.level.root", "WARN"));
            application.run("--spring.flyway.enabled=false", "--spring.sql.init.mode=never", "--server.port=8080");
            System.out.println("DEMO_SERVICE_READY readOnly=true");
        } catch (Throwable failure) {
            // Exception messages may contain JDBC parameters; keep operational output secret-free.
            System.err.println("DEMO_FAILED type=" + failure.getClass().getName());
            System.exit(1);
        }
    }
}
