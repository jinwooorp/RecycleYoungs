package com.example.backend;

import static org.assertj.core.api.Assertions.assertThat;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
class PostgresConnectionTests {

    @Autowired
    JdbcClient jdbc;

    @Autowired
    Flyway flyway;

    @Test
    void springConnectsToPostgresAndReadsExistingStatistics() {
        assertThat(jdbc.sql("SELECT count(*) FROM store_stats_dong").query(Long.class).single())
            .isEqualTo(expectedRows("EXPECTED_STORE_STATS_ROWS", 141218));
        assertThat(jdbc.sql("SELECT count(*) FROM sales_dong").query(Long.class).single())
            .isEqualTo(expectedRows("EXPECTED_SALES_ROWS", 67113));
    }

    @Test
    void schemaIsVersionedAndValidatedWithoutPendingMigrations() {
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("1");
        assertThat(flyway.info().pending()).isEmpty();
    }

    @Test
    void sourceCodeMappingAndPostgisAreAvailable() {
        assertThat(jdbc.sql("""
            SELECT i.code FROM industry_mappings im
            JOIN industries i ON i.id = im.industry_id
            WHERE im.source = :source AND im.source_code = :code
            """).param("source", "SEOUL").param("code", "CS100010")
            .query(String.class).single()).isEqualTo("CAFE");
        assertThat(jdbc.sql("SELECT extname FROM pg_extension WHERE extname = 'postgis'")
            .query(String.class).single()).isEqualTo("postgis");
    }

    private static long expectedRows(String variable, long fallback) {
        return Long.parseLong(System.getenv().getOrDefault(variable, Long.toString(fallback)));
    }
}
