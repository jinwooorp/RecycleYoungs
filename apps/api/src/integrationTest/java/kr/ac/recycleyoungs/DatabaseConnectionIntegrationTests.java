package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 서비스 조회와 Flyway가 개발 DB 대신 같은 일회용 PostGIS DB에 연결되는지 검증한다. */
@SpringBootTest
@ActiveProfiles("db")
@Testcontainers
class DatabaseConnectionIntegrationTests {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
    // 환경변수나 외부 Spring 설정과 관계없이 두 연결을 컨테이너로 고정한다.
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  @Autowired private DataSource dataSource;
  @Autowired private JdbcClient jdbcClient;
  @Autowired private Flyway flyway;

  @Test
  void connectsServiceAndDedicatedFlywayDataSourcesToContainer() throws Exception {
    var migrationDataSource = flyway.getConfiguration().getDataSource();
    assertThat(dataSource).isNotSameAs(migrationDataSource);
    try (var serviceConnection = dataSource.getConnection();
        var migrationConnection = migrationDataSource.getConnection()) {
      assertThat(serviceConnection.getMetaData().getURL()).isEqualTo(POSTGRES.getJdbcUrl());
      assertThat(migrationConnection.getMetaData().getURL()).isEqualTo(POSTGRES.getJdbcUrl());
      assertThat(serviceConnection.getCatalog()).isEqualTo(POSTGRES.getDatabaseName());
      assertThat(migrationConnection.getCatalog()).isEqualTo(POSTGRES.getDatabaseName());
    }
  }

  @Test
  void queriesMigratedSchemaAndPostgisThroughJdbcClient() {
    assertThat(
            jdbcClient
                .sql(
                    "SELECT count(*) FROM flyway_schema_history WHERE success AND version IN (:versions)")
                .param("versions", java.util.List.of("1", "2", "3", "4"))
                .query(Long.class)
                .single())
        .isEqualTo(4L);
    assertThat(jdbcClient.sql("SELECT PostGIS_Version()").query(String.class).single())
        .startsWith("3.5");
  }
}
