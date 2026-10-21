package com.example.backend.location;

import com.example.backend.BackendApplication;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.boot.SpringApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import tools.jackson.databind.json.JsonMapper;

/** Opt-in reader on the controller-owned disposable API database. Never migrates. */
public final class ApiIntegrationApplication {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static DataSource reader;

    @Configuration(proxyBeanMethods = false)
    @Profile("api-integration")
    public static class ReaderConfiguration { @Bean DataSource dataSource() { return reader; } }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Isolation configuration required");
        return value;
    }

    private static DataSource guardedReader() throws Exception {
        var target = JSON.readTree(required("API_ISOLATION_TARGET"));
        String owner = target.path("label").asText(), host = target.path("host").asText();
        String db = target.path("dbname").asText(), sid = target.path("sid").asText();
        String pgdata = "/var/lib/postgresql/data/pgdata";
        if (!owner.matches("[0-9a-f]{24}") || !host.equals("ry-8c1-db-" + owner)
            || !db.equals("recycleyoungs_integration_test_" + owner) || !sid.matches("[0-9]+")
            || sid.equals("7692329130053947430") || !target.path("network").asText().equals("ry-8c1-net-" + owner)
            || !target.path("container_id").asText().matches("[0-9a-f]{64}")
            || !target.path("network_id").asText().matches("[0-9a-f]{64}")
            || !pgdata.equals(target.path("data").asText()) || !"5432".equals(target.path("port").asText())) {
            throw new IllegalStateException("Isolation routing rejected");
        }
        var delegate = new DriverManagerDataSource("jdbc:postgresql://" + host + ":5432/" + db
            + "?connectTimeout=5&socketTimeout=600", "api_reader", required("API_READER_PASSWORD"));
        return new AbstractDataSource() {
            @Override public Connection getConnection() throws SQLException {
                var c = delegate.getConnection();
                try (var s = c.createStatement()) {
                    s.execute("SET lock_timeout='5s'; SET statement_timeout='10min'; SET default_transaction_read_only=on");
                    try (var r = s.executeQuery("SELECT current_database(),current_user,session_user,"
                        + "(SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),"
                        + "current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout'),"
                        + "current_setting('transaction_read_only')")) {
                        if (!r.next() || !db.equals(r.getString(1)) || !"api_reader".equals(r.getString(2))
                            || !"api_reader".equals(r.getString(3)) || !sid.equals(r.getString(4)) || !pgdata.equals(r.getString(5))
                            || !"5432".equals(r.getString(6)) || !"5s".equals(r.getString(7))
                            || !"10min".equals(r.getString(8)) || !"on".equals(r.getString(9))) {
                            throw new SQLException("Actual reader identity rejected");
                        }
                    }
                    return c;
                } catch (SQLException failure) { c.close(); throw failure; }
            }
            @Override public Connection getConnection(String user, String password) throws SQLException {
                throw new SQLException("Credential overrides forbidden");
            }
        };
    }

    public static void main(String[] args) {
        try {
            if (args.length == 2 && args[0].equals("probe") && args[1].startsWith("/api/")) {
                var response = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:8080" + args[1]))
                    .timeout(Duration.ofSeconds(60)).GET().build(), HttpResponse.BodyHandlers.ofString());
                System.out.println(JSON.writeValueAsString(Map.of("status", response.statusCode(), "body", response.body())));
                return;
            }
            if (args.length != 1 || !args[0].equals("serve")) throw new IllegalArgumentException("Explicit serve required");
            reader = guardedReader();
            try (var ignored = reader.getConnection()) { System.out.println("API_READER_IDENTITY_PASS"); }
            var app = new SpringApplication(BackendApplication.class, ReaderConfiguration.class);
            app.setAdditionalProfiles("api-integration");
            app.setDefaultProperties(Map.of("spring.main.banner-mode", "off", "logging.level.root", "WARN"));
            app.run("--spring.flyway.enabled=false", "--spring.sql.init.mode=never", "--server.port=8080",
                "--app.data.api-release-enabled=true", "--logging.level.org.springframework.jdbc=OFF");
            System.out.println("API_SERVICE_READY readOnly=true migrations=false");
        } catch (Throwable failure) {
            System.err.println("API_SERVICE_FAILURE type=" + failure.getClass().getName());
            System.exit(1);
        }
    }
}
