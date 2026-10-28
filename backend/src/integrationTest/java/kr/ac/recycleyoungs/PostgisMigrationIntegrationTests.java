package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@ActiveProfiles("db")
@Testcontainers
class PostgisMigrationIntegrationTests {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  @Autowired private Flyway flyway;

  @Test
  void appliesMigrationAndEnablesPostgisSpatialQueries() throws Exception {
    assertThat(flyway.info().applied()).hasSize(1);
    assertThat(flyway.info().pending()).isEmpty();
    try (var connection = flyway.getConfiguration().getDataSource().getConnection();
        var statement = connection.createStatement();
        var results =
            statement.executeQuery(
                "SELECT ST_DWithin(ST_SetSRID(ST_MakePoint(127.0, 37.5), 4326)::geography, "
                    + "ST_SetSRID(ST_MakePoint(127.0, 37.5001), 4326)::geography, 100)")) {
      assertThat(results.next()).isTrue();
      assertThat(results.getBoolean(1)).isTrue();
    }
    assertThat(flyway.migrate().migrationsExecuted).isZero();
  }
}
