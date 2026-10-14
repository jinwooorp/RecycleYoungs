package com.example.backend.teamdev;

import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Local-only reader: no configurable URL, credential override, or migration path. */
@Configuration(proxyBeanMethods = false)
@Profile("team-dev")
public class TeamDevDataSourceConfiguration {
    static final String URL = "jdbc:postgresql://127.0.0.1:55432/recycleyoungs_team_dev"
        + "?connectTimeout=5&socketTimeout=35&ApplicationName=recycleyoungs_team_backend";

    static String required(String key, String pattern) {
        String value = System.getenv("TEAM_DEV_" + key);
        if (value == null || !value.matches(pattern)) {
            throw new IllegalStateException("Missing team development proof; run docker compose up -d and etl/team_dev.py status");
        }
        return value;
    }

    @Bean
    DataSource teamDevDataSource() throws SQLException {
        String sid = required("SID", "[0-9]+"), owner = required("OWNER", "[0-9a-f]{32}");
        String contract = required("CONTRACT", "[0-9a-f]{64}");
        if (sid.equals("7692329130053947430")) throw new IllegalStateException("Protected DB identity rejected");
        var delegate = new DriverManagerDataSource(URL, "ry_team_reader", required("PASSWORD", "[0-9a-f]{64}"));
        DataSource guarded = new AbstractDataSource() {
            @Override public Connection getConnection() throws SQLException {
                return verify(delegate.getConnection(), sid, owner, contract);
            }
            @Override public Connection getConnection(String user, String password) throws SQLException {
                throw new SQLException("Team development credential overrides forbidden");
            }
        };
        try (var ignored = guarded.getConnection()) {
            // Establish an actual checked JDBC connection before the HTTP server is ready.
        }
        return guarded;
    }

    static Connection verify(Connection connection, String sid, String owner, String contract) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute("SET default_transaction_read_only=on");
            statement.execute("SET statement_timeout='30s'");
            statement.execute("SET lock_timeout='5s'");
            try (var rs = statement.executeQuery("SELECT current_database(),current_user,session_user,"
                + "(SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),"
                + "current_setting('recycleyoungs.owner',true),current_setting('transaction_read_only'),"
                + "version,contract,status,owner,"
                + "(verification->'fingerprint'->'stores'->>'rows')::bigint=(SELECT count(*) FROM stores) AND "
                + "(verification->'fingerprint'->'store_stats_dong'->>'rows')::bigint=(SELECT count(*) FROM store_stats_dong) AND "
                + "(verification->'fingerprint'->'sales_dong'->>'rows')::bigint=(SELECT count(*) FROM sales_dong) AND "
                + "(verification->'fingerprint'->'admin_dong_boundaries'->>'rows')::bigint=(SELECT count(*) FROM admin_dong_boundaries) AND "
                + "(verification->'fingerprint'->'commercial_area_boundaries'->>'rows')::bigint=(SELECT count(*) FROM commercial_area_boundaries) AND "
                + "verification->'migrations'=(SELECT jsonb_agg(jsonb_build_object('version',version,'checksum',checksum,'success',success) "
                + "ORDER BY installed_rank) FROM flyway_schema_history) "
                + "FROM team_dev.state WHERE singleton")) {
                if (!rs.next() || !"recycleyoungs_team_dev".equals(rs.getString(1))
                    || !"ry_team_reader".equals(rs.getString(2)) || !"ry_team_reader".equals(rs.getString(3))
                    || !sid.equals(rs.getString(4)) || !"/var/lib/postgresql/data/team".equals(rs.getString(5))
                    || !owner.equals(rs.getString(6)) || !"on".equals(rs.getString(7))
                    || !"real-data-v1".equals(rs.getString(8)) || !contract.equals(rs.getString(9))
                    || !"READY".equals(rs.getString(10)) || !owner.equals(rs.getString(11)) || !rs.getBoolean(12)) {
                    throw new SQLException("TEAM_DB_NOT_READY: verify Compose initialization and retry bootRun");
                }
            }
            return connection;
        } catch (SQLException failure) {
            connection.close();
            throw failure;
        }
    }
}
