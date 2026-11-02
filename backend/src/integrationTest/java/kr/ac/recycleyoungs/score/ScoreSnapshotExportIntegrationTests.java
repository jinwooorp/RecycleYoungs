package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.DriverManager;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 실제 개발 설정은 읽지 않는다. 마이그레이션·쓰기 fixture는 이 일회용 컨테이너에서만 수행한다. */
@Testcontainers
class ScoreSnapshotExportIntegrationTests {
  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
              DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"))
          .withUsername("snapshot_synthetic_user")
          .withPassword("snapshot_synthetic_password");

  static JdbcClient jdbc;
  @TempDir Path temporary;

  @BeforeAll
  static void migrateOnlyDisposableDatabase() {
    Flyway.configure()
        .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
        .load()
        .migrate();
    jdbc =
        JdbcClient.create(
            new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
  }

  @BeforeEach
  void seed() {
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
    for (int i = 1; i <= 3; i++) {
      String district = "0000" + i;
      jdbc.sql(
              "INSERT INTO district VALUES (:code,:name,ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),:batch)")
          .param("code", district)
          .param("name", "합성구" + i)
          .param("batch", new UUID(0, 1))
          .update();
      jdbc.sql(
              "INSERT INTO administrative_dong VALUES (:code,:district,:name,ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),ST_SetSRID(ST_MakePoint(127.005,37.005),4326),1000,:batch)")
          .param("code", district + "001")
          .param("district", district)
          .param("name", "합성동" + i)
          .param("batch", new UUID(0, 1))
          .update();
      for (String prefix : new String[] {"district", "dong"}) {
        String code = prefix.equals("district") ? district : district + "001";
        int start = prefix.equals("district") ? 2 : 5;
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_store_stat("
                    + prefix
                    + "_code,industry_code,quarter_code,store_count,closure_rate,source_batch_id) VALUES (:code,'CS100010','20262',:stores,:closure,:batch)")
            .param("code", code)
            .param("stores", i * 10)
            .param("closure", i)
            .param("batch", new UUID(0, start))
            .update();
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_sales_stat("
                    + prefix
                    + "_code,industry_code,quarter_code,monthly_sales_amount,source_batch_id) VALUES (:code,'CS100010','20262',:value,:batch)")
            .param("code", code)
            .param("value", i * 1000)
            .param("batch", new UUID(0, start + 1))
            .update();
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_foot_traffic_stat("
                    + prefix
                    + "_code,quarter_code,total_foot_traffic,source_batch_id) VALUES (:code,'20262',:value,:batch)")
            .param("code", code)
            .param("value", i * 100)
            .param("batch", new UUID(0, start + 2))
            .update();
      }
    }
  }

  @Test
  void exportsOnlyAfterReadOnlyRollbackAndReplaysWithoutDatabase() throws Exception {
    Path target = target("complete.score-snapshot.json");
    var output = new ByteArrayOutputStream();
    int history =
        jdbc.sql("SELECT count(*) FROM flyway_schema_history").query(Integer.class).single();
    assertThat(
            ScoreSnapshotExportMain.execute(
                environment(target), repository(), new PrintStream(output)))
        .isZero();
    assertThat(output.toString())
        .contains(
            "EXPORTED",
            "default_transaction_read_only=on",
            "transaction_read_only=on",
            "repeatable read",
            "transactionEnd=ROLLBACK",
            "flyway=NOT_CONFIGURED",
            "NOT_APPROVED");
    assertThat(output.toString())
        .doesNotContain(
            target.toString(),
            POSTGRES.getJdbcUrl(),
            POSTGRES.getUsername(),
            POSTGRES.getPassword(),
            "합성");
    var bundle = ScoreSnapshotBundle.decode(Files.readAllBytes(target));
    assertThat(bundle.district().payload().coverage().boundaryRegionCount()).isEqualTo(3);
    assertThat(bundle.dong().payload().coverage().boundaryRegionCount()).isEqualTo(3);
    assertThat(bundle.district().requestedAt()).isEqualTo(bundle.dong().requestedAt());
    assertThat(bundle.district().replay().scores()).hasSize(3);
    assertThat(jdbc.sql("SELECT count(*) FROM flyway_schema_history").query(Integer.class).single())
        .isEqualTo(history);
    assertThat(
            jdbc.sql("SELECT sum(monthly_sales_amount) FROM district_sales_stat")
                .query(Integer.class)
                .single())
        .isEqualTo(6000);
    assertThat(
            jdbc.sql(
                    "SELECT count(*) FROM pg_stat_activity WHERE application_name='score-snapshot-export'")
                .query(Integer.class)
                .single())
        .isZero();
    assertThat(
            ScoreSnapshotVerifyMain.execute(
                Map.of(
                    "SCORE_SNAPSHOT_INPUT_PATH",
                    target.toString(),
                    "DB_JDBC_URL",
                    "invalid-never-used"),
                repository(),
                new PrintStream(output)))
        .isZero();
  }

  @Test
  void keepsBothUnitsInOneRepeatableReadSnapshotDuringConcurrentChanges() throws Exception {
    Path target = target("concurrent.score-snapshot.json");
    var output = new ByteArrayOutputStream();
    try (var writer =
        DriverManager.getConnection(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())) {
      writer.setAutoCommit(false);
      try (var statement = writer.createStatement()) {
        statement.execute("LOCK TABLE dong_sales_stat IN ACCESS EXCLUSIVE MODE");
        var export =
            CompletableFuture.supplyAsync(
                () -> {
                  try {
                    return ScoreSnapshotExportMain.execute(
                        environment(target), repository(), new PrintStream(output));
                  } catch (Exception error) {
                    throw new IllegalStateException(error);
                  }
                });
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        boolean blocked = false;
        while (System.nanoTime() < deadline) {
          blocked =
              jdbc.sql(
                      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='score-snapshot-export' AND wait_event_type='Lock')")
                  .query(Boolean.class)
                  .single();
          if (blocked) break;
          Thread.sleep(20);
        }
        assertThat(blocked).isTrue();
        statement.executeUpdate(
            "UPDATE district_sales_stat SET monthly_sales_amount=monthly_sales_amount+999");
        statement.executeUpdate(
            "UPDATE dong_sales_stat SET monthly_sales_amount=monthly_sales_amount+999");
        writer.commit();
        assertThat(export.get(10, TimeUnit.SECONDS)).isZero();
      } finally {
        writer.rollback();
      }
    }
    var bundle = ScoreSnapshotBundle.decode(Files.readAllBytes(target));
    assertThat(bundle.district().payload().input().regions().getFirst().sales().raw())
        .isEqualTo("1000");
    assertThat(bundle.dong().payload().input().regions().getFirst().sales().raw())
        .isEqualTo("1000");
    assertThat(
            jdbc.sql(
                    "SELECT monthly_sales_amount FROM district_sales_stat WHERE district_code='00001'")
                .query(Integer.class)
                .single())
        .isEqualTo(1999);
  }

  @Test
  void authenticationFailureCreatesNoFilesAndDoesNotPrintSecrets() throws Exception {
    Path target = target("auth.json");
    var env = new HashMap<>(environment(target));
    env.put("DB_PASSWORD", "wrong-synthetic-secret");
    var out = new ByteArrayOutputStream();
    assertThat(ScoreSnapshotExportMain.execute(env, repository(), new PrintStream(out)))
        .isEqualTo(2);
    assertThat(out.toString())
        .contains("NOT_COMPLETED")
        .doesNotContain("wrong-synthetic-secret", target.toString(), POSTGRES.getJdbcUrl());
    try (var files = Files.list(target.getParent())) {
      assertThat(files.count()).isZero();
    }
  }

  @Test
  void emptyLatestBoundaryIsNotExportedAndDoesNotFallBack() throws Exception {
    batch(99, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
    Path target = target("empty.json");
    var out = new ByteArrayOutputStream();
    assertThat(
            ScoreSnapshotExportMain.execute(
                environment(target), repository(), new PrintStream(out)))
        .isEqualTo(2);
    assertThat(out.toString()).contains("rollbackConfirmed=true").doesNotContain("EXPORTED");
    assertThat(Files.exists(target)).isFalse();
  }

  @Test
  void publicationFailureOccursAfterRollbackAndCleansOwnTemporaryFile() throws Exception {
    Path target = target("x".repeat(300) + ".json");
    var out = new ByteArrayOutputStream();
    assertThat(
            ScoreSnapshotExportMain.execute(
                environment(target), repository(), new PrintStream(out)))
        .isEqualTo(2);
    assertThat(out.toString())
        .contains("phase=FILE_PUBLICATION", "rollbackConfirmed=true")
        .doesNotContain("EXPORTED", target.toString());
    try (var files = Files.list(target.getParent())) {
      assertThat(files.count()).isZero();
    }
  }

  private static Map<String, String> environment(Path target) {
    return Map.of(
        "SCORE_SNAPSHOT_EXPORT_ENABLED",
        "1",
        "SCORE_SNAPSHOT_OUTPUT_PATH",
        target.toString(),
        "DB_JDBC_URL",
        POSTGRES.getJdbcUrl().split("\\?", 2)[0],
        "DB_USER",
        POSTGRES.getUsername(),
        "DB_PASSWORD",
        POSTGRES.getPassword());
  }

  private Path target(String filename) throws Exception {
    Path real = temporary.toRealPath();
    Files.setPosixFilePermissions(real, PosixFilePermissions.fromString("rwx------"));
    return real.resolve(filename);
  }

  private static Path repository() throws Exception {
    return Path.of("..").toRealPath();
  }

  private static void batch(int id, String dataset, String type) {
    jdbc.sql(
            "INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,source_checksum,etl_version,status,started_at,published_at,period_from,period_to) VALUES (:id,:dataset,:type,'SEOUL','synthetic',:hash,'synthetic-v1','PUBLISHED','2026-10-01T00:00:00Z',:published,'20262','20262')")
        .param("id", new UUID(0, id))
        .param("dataset", dataset)
        .param("type", type)
        .param("hash", "a".repeat(64))
        .param(
            "published",
            java.time.OffsetDateTime.parse(
                id == 99 ? "2026-10-03T00:00:00Z" : "2026-10-02T00:00:00Z"))
        .update();
  }
}
