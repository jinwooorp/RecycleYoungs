package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 마이그레이션·쓰기·재게시는 이 일회용 PostGIS의 합성 입력에만 수행한다. */
@Testcontainers
class ScoreCurrentInputVerificationIntegrationTests {
  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  static DataSource source;
  static JdbcClient jdbc;
  byte[] reference;
  ScoreCurrentInputVerification verifier;

  @BeforeAll
  static void migrateDisposableDatabaseOnly() {
    source =
        new DriverManagerDataSource(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    Flyway.configure().dataSource(source).load().migrate();
    jdbc = JdbcClient.create(source);
  }

  @BeforeEach
  void seedSyntheticCohorts() {
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
    reference = captureReference();
    verifier = new ScoreCurrentInputVerification(source);
  }

  @Test
  void matchesBothCohortsInOneEnforcedReadOnlyTransactionAndRollsBack() {
    var observed = new ObservedSource(source);
    var result = new ScoreCurrentInputVerification(observed).verify(reference);
    assertResult(result, ScoreInputComparison.Status.MATCHED);
    assertThat(observed.connections).hasValue(1);
    assertThat(observed.rollbacks).hasValue(1);
    assertThat(observed.commits).hasValue(0);
    var input = ScoreSnapshotReference.decode(reference).bundle();
    assertThat(input.district().payload().input().regions()).hasSize(3);
    assertThat(input.dong().payload().input().regions()).hasSize(3);
    assertThat(input.district().payload().input().regions().getFirst().sales().raw())
        .isEqualTo("1000");
  }

  static Stream<Arguments> mutations() {
    return Stream.of("district", "dong")
        .flatMap(
            prefix ->
                Stream.of(
                        "sales",
                        "foot",
                        "stores",
                        "closure",
                        "scale",
                        "null",
                        "zero",
                        "missing",
                        "sourceId",
                        "checksum",
                        "etl",
                        "published",
                        "eligibility",
                        "name",
                        "added",
                        "deleted")
                    .map(change -> Arguments.of(prefix, change)));
  }

  @ParameterizedTest
  @MethodSource("mutations")
  void detectsRawValuesSourcesAndWholeCohortChanges(String prefix, String change) {
    String code = prefix.equals("district") ? "00001" : "00001001";
    String key = prefix + "_code";
    int salesBatch = prefix.equals("district") ? 3 : 6;
    switch (change) {
      case "sales" ->
          jdbc.sql(
                  "UPDATE "
                      + prefix
                      + "_sales_stat SET monthly_sales_amount=1001 WHERE "
                      + key
                      + "=:code")
              .param("code", code)
              .update();
      case "foot" ->
          jdbc.sql(
                  "UPDATE "
                      + prefix
                      + "_foot_traffic_stat SET total_foot_traffic=100.000000000000000000000000000001 WHERE "
                      + key
                      + "=:code")
              .param("code", code)
              .update();
      case "stores" ->
          jdbc.sql("UPDATE " + prefix + "_store_stat SET store_count=11 WHERE " + key + "=:code")
              .param("code", code)
              .update();
      case "closure" ->
          jdbc.sql(
                  "UPDATE "
                      + prefix
                      + "_store_stat SET closure_rate=1.000000000000000000000000000001 WHERE "
                      + key
                      + "=:code")
              .param("code", code)
              .update();
      case "scale" ->
          jdbc.sql("UPDATE " + prefix + "_store_stat SET closure_rate=1.00 WHERE " + key + "=:code")
              .param("code", code)
              .update();
      case "null" ->
          jdbc.sql(
                  "UPDATE "
                      + prefix
                      + "_sales_stat SET monthly_sales_amount=NULL WHERE "
                      + key
                      + "=:code")
              .param("code", code)
              .update();
      case "zero" ->
          jdbc.sql(
                  "UPDATE "
                      + prefix
                      + "_sales_stat SET monthly_sales_amount=0 WHERE "
                      + key
                      + "=:code")
              .param("code", code)
              .update();
      case "missing" ->
          jdbc.sql("DELETE FROM " + prefix + "_sales_stat WHERE " + key + "=:code")
              .param("code", code)
              .update();
      case "sourceId", "eligibility" -> {
        batch(99, "SEOUL_" + prefix.toUpperCase(java.util.Locale.ROOT) + "_SALES_STAT", "CSV");
        jdbc.sql(
                "UPDATE "
                    + prefix
                    + "_sales_stat SET source_batch_id=:batch WHERE "
                    + key
                    + "=:code")
            .param("batch", new UUID(0, 99))
            .param("code", code)
            .update();
        if (change.equals("eligibility"))
          jdbc.sql("UPDATE etl_batch SET status='FAILED' WHERE batch_id=:id")
              .param("id", new UUID(0, 99))
              .update();
      }
      case "checksum" ->
          jdbc.sql("UPDATE etl_batch SET source_checksum=:hash WHERE batch_id=:id")
              .param("hash", "b".repeat(64))
              .param("id", new UUID(0, salesBatch))
              .update();
      case "etl" ->
          jdbc.sql("UPDATE etl_batch SET etl_version='synthetic-other' WHERE batch_id=:id")
              .param("id", new UUID(0, salesBatch))
              .update();
      case "published" ->
          jdbc.sql("UPDATE etl_batch SET published_at='2026-10-03T00:00:00Z' WHERE batch_id=:id")
              .param("id", new UUID(0, salesBatch))
              .update();
      case "name" ->
          jdbc.sql(
                  "UPDATE "
                      + (prefix.equals("district") ? "district" : "administrative_dong")
                      + " SET "
                      + prefix
                      + "_name='변경된 합성지역' WHERE "
                      + key
                      + "=:code")
              .param("code", code)
              .update();
      case "added" -> {
        if (prefix.equals("district"))
          jdbc.sql(
                  "INSERT INTO district SELECT '00004','합성구4',geom,boundary_batch_id FROM district WHERE district_code='00001'")
              .update();
        else
          jdbc.sql(
                  "INSERT INTO administrative_dong SELECT '00001002',district_code,'합성동4',geom,label_point,area_m2,boundary_batch_id FROM administrative_dong WHERE dong_code='00001001'")
              .update();
      }
      default -> {
        if (prefix.equals("district")) {
          for (String table :
              new String[] {"dong_store_stat", "dong_sales_stat", "dong_foot_traffic_stat"})
            jdbc.sql("DELETE FROM " + table + " WHERE dong_code='00001001'").update();
          jdbc.sql("DELETE FROM administrative_dong WHERE dong_code='00001001'").update();
        }
        for (String suffix : new String[] {"store_stat", "sales_stat", "foot_traffic_stat"})
          jdbc.sql("DELETE FROM " + prefix + "_" + suffix + " WHERE " + key + "=:code")
              .param("code", code)
              .update();
        jdbc.sql(
                "DELETE FROM "
                    + (prefix.equals("district") ? "district" : "administrative_dong")
                    + " WHERE "
                    + key
                    + "=:code")
            .param("code", code)
            .update();
      }
    }
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @Test
  void detectsBoundaryEditionAndParentChanges() {
    jdbc.sql("UPDATE district SET district_name='변경된 소속구' WHERE district_code='00001'").update();
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.INPUT_MISMATCH);
    jdbc.sql("UPDATE district SET district_name='합성구1' WHERE district_code='00001'").update();
    batch(99, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
    for (String table : new String[] {"district", "administrative_dong"})
      jdbc.sql("UPDATE " + table + " SET boundary_batch_id=:id")
          .param("id", new UUID(0, 99))
          .update();
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @Test
  void latestEmptyBoundaryOrUnreadyDatasetNeverFallsBackToThePreviousSuccess() {
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.MATCHED);
    jdbc.sql("UPDATE etl_batch SET status='FAILED' WHERE dataset_code='SEOUL_DONG_SALES_STAT'")
        .update();
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.DATA_NOT_READY);
    jdbc.sql("UPDATE etl_batch SET status='PUBLISHED' WHERE dataset_code='SEOUL_DONG_SALES_STAT'")
        .update();
    batch(99, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.DATA_NOT_READY);
  }

  @Test
  void concurrentRepublishingBetweenCohortQueriesUsesOneSnapshotAndNextCallDetectsIt() {
    var repository =
        new ScoreInputRepository(jdbc) {
          @Override
          public ScoreInputSnapshot findDistrictInputs(String quarter, String industry) {
            var first = super.findDistrictInputs(quarter, industry);
            CompletableFuture.runAsync(
                    () -> {
                      var tx = new TransactionTemplate(new JdbcTransactionManager(source));
                      tx.execute(
                          status -> {
                            batch(90, "SEOUL_DISTRICT_SALES_STAT", "CSV");
                            batch(91, "SEOUL_DONG_SALES_STAT", "CSV");
                            jdbc.sql(
                                    "UPDATE district_sales_stat SET monthly_sales_amount=monthly_sales_amount+999,source_batch_id=:id")
                                .param("id", new UUID(0, 90))
                                .update();
                            jdbc.sql(
                                    "UPDATE dong_sales_stat SET monthly_sales_amount=monthly_sales_amount+999,source_batch_id=:id")
                                .param("id", new UUID(0, 91))
                                .update();
                            return null;
                          });
                    })
                .orTimeout(10, TimeUnit.SECONDS)
                .join();
            return first;
          }
        };
    assertResult(
        new ScoreCurrentInputVerification(source, repository).verify(reference),
        ScoreInputComparison.Status.MATCHED);
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.INPUT_MISMATCH);
    assertThat(
            jdbc.sql("SELECT monthly_sales_amount FROM dong_sales_stat WHERE dong_code='00001001'")
                .query(Integer.class)
                .single())
        .isEqualTo(1999);
  }

  @Test
  void PostgreSqlRejectsWritesEvenWhenJdbcReadOnlyHintIsIgnored() {
    var ignored =
        new DriverManagerDataSource(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    var properties = new java.util.Properties();
    properties.setProperty("readOnlyMode", "ignore");
    ignored.setConnectionProperties(properties);
    var guardedJdbc = JdbcClient.create(ignored);
    var repository =
        new ScoreInputRepository(guardedJdbc) {
          @Override
          public ScoreInputSnapshot findDistrictInputs(String quarter, String industry) {
            assertThat(guardedJdbc.sql("SHOW transaction_read_only").query(String.class).single())
                .isEqualTo("on");
            assertThat(guardedJdbc.sql("SHOW transaction_isolation").query(String.class).single())
                .isEqualTo("repeatable read");
            guardedJdbc.sql("UPDATE district_sales_stat SET monthly_sales_amount=42").update();
            throw new AssertionError("읽기 전용 DB가 쓰기를 허용함");
          }
        };
    assertThat(new ScoreCurrentInputVerification(ignored, repository).verify(reference).status())
        .isNotEqualTo(ScoreInputComparison.Status.MATCHED);
    assertThat(
            jdbc.sql(
                    "SELECT monthly_sales_amount FROM district_sales_stat WHERE district_code='00001'")
                .query(Integer.class)
                .single())
        .isEqualTo(1000);
  }

  @Test
  void neverJoinsAnExistingWritableReadCommittedTransaction() {
    var outer = new TransactionTemplate(new JdbcTransactionManager(source));
    outer.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
    outer.execute(
        status -> {
          try {
            jdbc.sql(
                    "UPDATE district_sales_stat SET monthly_sales_amount=999 WHERE district_code='00001'")
                .update();
            // 바깥 미커밋 쓰기를 보지 않고 별도 읽기 전용 RR에서 기존 커밋 입력을 대조한다.
            assertResult(verifier.verify(reference), ScoreInputComparison.Status.MATCHED);
          } finally {
            status.setRollbackOnly();
          }
          return null;
        });
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.MATCHED);
  }

  @Test
  void authenticationAndUnexpectedFailuresAreSanitizedAndNeverCached() {
    var bad =
        new DriverManagerDataSource(
            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), "wrong-private-password-sentinel");
    assertResult(
        new ScoreCurrentInputVerification(bad).verify(reference),
        ScoreInputComparison.Status.DATABASE_UNAVAILABLE);
    var broken =
        new ScoreInputRepository(jdbc) {
          @Override
          public ScoreInputSnapshot findDistrictInputs(String quarter, String industry) {
            throw new IllegalStateException(
                "private-SQL-sentinel", new SQLException("password-sentinel"));
          }
        };
    assertResult(
        new ScoreCurrentInputVerification(source, broken).verify(reference),
        ScoreInputComparison.Status.INTERNAL_ERROR);
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.MATCHED);
    jdbc.sql("UPDATE district_sales_stat SET monthly_sales_amount=monthly_sales_amount+1").update();
    assertResult(verifier.verify(reference), ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  private byte[] captureReference() {
    var manager = new JdbcTransactionManager(source);
    manager.setEnforceReadOnly(true);
    var tx = new TransactionTemplate(manager);
    tx.setReadOnly(true);
    tx.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    return tx.execute(
        status -> {
          try {
            var repo = new ScoreInputRepository(jdbc);
            var a = repo.findDistrictInputs("20262", "CS100010");
            var b = repo.findDongInputs("20262", "CS100010");
            return new ScoreSnapshotBundle(capture(a), capture(b)).encode();
          } finally {
            status.setRollbackOnly();
          }
        });
  }

  private static ScoreSnapshotArtifact capture(ScoreInputSnapshot input) {
    return ScoreSnapshotArtifact.capture(
        input,
        input.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList(),
        OffsetDateTime.parse("2026-11-05T00:00:00Z"));
  }

  private void assertResult(
      ScoreCurrentInputVerification.Result result, ScoreInputComparison.Status expected) {
    assertThat(result.status()).isEqualTo(expected);
    assertThat(result.referenceFileSha256()).isEqualTo(ScoreSnapshotCodec.sha256(reference));
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.sourceTrust())
        .isEqualTo(ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED);
    assertThat(result.r03Complete()).isFalse();
    assertThat(result.toString())
        .doesNotContain(
            "합성", "sentinel", POSTGRES.getJdbcUrl(), POSTGRES.getPassword(), "SELECT", "UPDATE");
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
            OffsetDateTime.parse(id >= 90 ? "2026-10-03T00:00:00Z" : "2026-10-02T00:00:00Z"))
        .update();
  }

  private static final class ObservedSource extends DelegatingDataSource {
    final AtomicInteger connections = new AtomicInteger(),
        rollbacks = new AtomicInteger(),
        commits = new AtomicInteger();

    ObservedSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      connections.incrementAndGet();
      var connection = super.getConnection();
      return (Connection)
          Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class[] {Connection.class},
              (proxy, method, args) -> {
                if (method.getName().equals("rollback")) rollbacks.incrementAndGet();
                if (method.getName().equals("commit")) commits.incrementAndGet();
                try {
                  return method.invoke(connection, args);
                } catch (InvocationTargetException failure) {
                  throw failure.getCause();
                }
              });
    }
  }
}
