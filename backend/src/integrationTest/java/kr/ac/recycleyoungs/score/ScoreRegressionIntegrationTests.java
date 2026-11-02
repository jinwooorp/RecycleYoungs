package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
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

/** 일회용 PostGIS에서만 명시 실행 도구의 안전 설정과 차이 보고를 검증한다. */
@SpringBootTest
@ActiveProfiles("db")
@Testcontainers
class ScoreRegressionIntegrationTests {
  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
              DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"))
          .withUsername("synthetic_runner_user")
          .withPassword("synthetic_runner_secret");

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  @Autowired private JdbcClient jdbc;

  @BeforeEach
  void seedOnlyDisposableDatabase() {
    for (String table :
        new String[] {
          "district_store_stat",
          "district_sales_stat",
          "district_foot_traffic_stat",
          "dong_store_stat",
          "dong_sales_stat",
          "dong_foot_traffic_stat",
          "service_industry",
          "administrative_dong",
          "district",
          "etl_batch"
        }) jdbc.sql("DELETE FROM " + table).update();
    batch(1, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
    for (int i = 0; i < 6; i++)
      batch(
          i + 2,
          "SEOUL_"
              + (i < 3 ? "DISTRICT" : "DONG")
              + "_"
              + new String[] {"STORE", "SALES", "FOOT_TRAFFIC"}[i % 3]
              + "_STAT",
          "CSV");
    jdbc.sql("INSERT INTO service_industry VALUES ('CS100010','합성카페',:batch)")
        .param("batch", new UUID(0, 2))
        .update();
    for (int i = 1; i <= 5; i++) {
      String code = "001" + i + "0";
      jdbc.sql(
              "INSERT INTO district VALUES (:code,'합성구',ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),:batch)")
          .param("code", code)
          .param("batch", new UUID(0, 1))
          .update();
      jdbc.sql(
              """
          INSERT INTO administrative_dong VALUES (:dong,:code,'합성동',ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),
            ST_SetSRID(ST_MakePoint(127.005,37.005),4326),1000,:batch)
          """)
          .param("dong", code + "001")
          .param("code", code)
          .param("batch", new UUID(0, 1))
          .update();
      for (String prefix : new String[] {"district", "dong"}) {
        int start = prefix.equals("district") ? 2 : 5;
        String region = prefix.equals("district") ? code : code + "001";
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_store_stat("
                    + prefix
                    + "_code,industry_code,quarter_code,store_count,closure_rate,source_batch_id) VALUES (:code,'CS100010','20262',:value,:value,:batch)")
            .param("code", region)
            .param("value", i)
            .param("batch", new UUID(0, start))
            .update();
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_sales_stat("
                    + prefix
                    + "_code,industry_code,quarter_code,monthly_sales_amount,source_batch_id) VALUES (:code,'CS100010','20262',:value,:batch)")
            .param("code", region)
            .param("value", i * 100)
            .param("batch", new UUID(0, start + 1))
            .update();
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_foot_traffic_stat("
                    + prefix
                    + "_code,quarter_code,total_foot_traffic,source_batch_id) VALUES (:code,'20262',:value,:batch)")
            .param("code", region)
            .param("value", i * 10)
            .param("batch", new UUID(0, start + 2))
            .update();
      }
    }
  }

  @Test
  void usesDatabaseWriteProtectionRollbackAndNoFlywayWhileReportingSyntheticDifferences() {
    var before =
        jdbc.sql("SELECT count(*) FROM flyway_schema_history").query(Integer.class).single();
    var buffer = new ByteArrayOutputStream();
    int exit =
        ScoreRegressionMain.execute(environment(POSTGRES.getPassword()), new PrintStream(buffer));
    assertThat(exit).as(buffer.toString(StandardCharsets.UTF_8)).isEqualTo(1);
    String report = buffer.toString(StandardCharsets.UTF_8);
    assertThat(report)
        .contains(
            "default_transaction_read_only=on",
            "transaction_read_only=on",
            "isolation=repeatable read",
            "transactionEnd=ROLLBACK",
            "flyway=NOT_CONFIGURED",
            "checkedRegions=10 arithmetic=true permutation=true",
            "DIFFERENCE COVERAGE:",
            "DIFFERENCE PROVENANCE:",
            "R03_COMPLETE=false");
    assertThat(report)
        .doesNotContain(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    assertThat(jdbc.sql("SELECT count(*) FROM flyway_schema_history").query(Integer.class).single())
        .isEqualTo(before);
    assertThat(
            jdbc.sql("SELECT sum(monthly_sales_amount) FROM district_sales_stat")
                .query(Integer.class)
                .single())
        .isEqualTo(1500);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM pg_stat_activity WHERE application_name='score-r03-regression'")
                .query(Integer.class)
                .single())
        .isZero();
  }

  @Test
  void reportsAuthenticationFailureWithoutPrintingSecretsOrInventingResults() {
    var buffer = new ByteArrayOutputStream();
    assertThat(
            ScoreRegressionMain.execute(
                environment("wrong-synthetic-password"), new PrintStream(buffer)))
        .isEqualTo(2);
    assertThat(buffer.toString(StandardCharsets.UTF_8))
        .contains("NOT_COMPLETED:")
        .doesNotContain(
            "checkedRegions",
            "wrong-synthetic-password",
            POSTGRES.getJdbcUrl(),
            POSTGRES.getUsername());
  }

  @Test
  void reportsEmptyLatestBoundaryAsDifferenceWithoutFallingBackOrClaimingCalculationSuccess() {
    batch(20, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
    var buffer = new ByteArrayOutputStream();
    int exit =
        ScoreRegressionMain.execute(environment(POSTGRES.getPassword()), new PrintStream(buffer));
    assertThat(exit).as(buffer.toString(StandardCharsets.UTF_8)).isEqualTo(1);
    assertThat(buffer.toString(StandardCharsets.UTF_8))
        .contains(
            "boundary=0",
            "status=BOUNDARY_NOT_READY",
            "checkedRegions=0 arithmetic=false",
            "R03_COMPLETE=false");
  }

  private static Map<String, String> environment(String password) {
    return Map.of(
        "SCORE_REGRESSION_ENABLED",
        "1",
        "DB_JDBC_URL",
        POSTGRES.getJdbcUrl().split("\\?", 2)[0],
        "DB_USER",
        POSTGRES.getUsername(),
        "DB_PASSWORD",
        password);
  }

  private void batch(long id, String dataset, String source) {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,source_checksum,
          etl_version,status,started_at,published_at,period_from,period_to) VALUES (:id,:dataset,:source,'SEOUL','synthetic',
          :checksum,'synthetic-v1','PUBLISHED','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','20262','20262')
        """)
        .param("id", new UUID(0, id))
        .param("dataset", dataset)
        .param("source", source)
        .param("checksum", "a".repeat(64))
        .update();
  }
}
