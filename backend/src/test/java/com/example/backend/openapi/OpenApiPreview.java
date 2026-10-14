package com.example.backend.openapi;

import static org.mockito.Mockito.mock;

import com.example.backend.BackendApplication;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.simple.JdbcClient;

/** Documentation-only loopback server. No DataSource/Flyway and no real API data. */
public final class OpenApiPreview {
    private OpenApiPreview() {}

    public static void main(String[] args) {
        var context = new SpringApplicationBuilder(BackendApplication.class, PreviewConfiguration.class).run(
            "--spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
                + "org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration",
            "--springdoc.api-docs.enabled=true", "--springdoc.swagger-ui.enabled=true",
            "--server.address=127.0.0.1", "--server.port=18080");
        if (!context.getBeansOfType(DataSource.class).isEmpty() || !context.getBeansOfType(Flyway.class).isEmpty()) {
            context.close();
            throw new IllegalStateException("Documentation preview must have no DataSource or Flyway");
        }
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class PreviewConfiguration {
        @Bean JdbcClient jdbcClient() { return mock(JdbcClient.class); }
    }
}
