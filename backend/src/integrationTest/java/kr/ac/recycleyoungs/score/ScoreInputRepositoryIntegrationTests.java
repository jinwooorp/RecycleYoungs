package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;
import java.util.stream.Stream;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DelegatingDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 서비스·Flyway 연결을 모두 일회용 PostGIS로 고정하고 합성 경계·통계만 읽는다. */
@SpringBootTest
@ActiveProfiles("db")
@Testcontainers
class ScoreInputRepositoryIntegrationTests {
  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  private static final UUID BOUNDARY = new UUID(0, 1);
  @Autowired private JdbcClient jdbc;
  @Autowired private ScoreInputRepository repository;
  @Autowired private PlatformTransactionManager transactions;
  @Autowired private DataSource dataSource;

  @BeforeEach
  void seedIsolatedDatabase() {
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
        }) {
      jdbc.sql("DELETE FROM " + table).update();
    }
    batch(1, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-01");
    for (int i = 0; i < 6; i++) {
      String unit = i < 3 ? "DISTRICT" : "DONG";
      String kind = new String[] {"STORE", "SALES", "FOOT_TRAFFIC"}[i % 3];
      batch(
          i + 2,
          "SEOUL_" + unit + "_" + kind + "_STAT",
          "CSV",
          "SEOUL",
          null,
          "PUBLISHED",
          "2026-10-02");
    }
    for (String code : new String[] {"00110", "00120"}) {
      jdbc.sql(
              """
          INSERT INTO district VALUES (:code,:name,
            ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),:batch)
          """)
          .param("code", code)
          .param("name", code + "구")
          .param("batch", BOUNDARY)
          .update();
      jdbc.sql(
              """
          INSERT INTO administrative_dong VALUES (:dong,:code,:name,
            ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),
            ST_SetSRID(ST_MakePoint(127.005,37.005),4326),1000,:batch)
          """)
          .param("dong", code + "001")
          .param("code", code)
          .param("name", code + "동")
          .param("batch", BOUNDARY)
          .update();
    }
    jdbc.sql(
            "INSERT INTO service_industry VALUES ('CS100010','카페',:batch),('CS100001','한식',:batch)")
        .param("batch", new UUID(0, 2))
        .update();
    for (String prefix : new String[] {"district", "dong"}) {
      String column = prefix.equals("district") ? "district_code" : "dong_code";
      String code = prefix.equals("district") ? "00110" : "00110001";
      int batchStart = prefix.equals("district") ? 2 : 5;
      jdbc.sql(
              "INSERT INTO "
                  + prefix
                  + "_store_stat("
                  + column
                  + ",industry_code,quarter_code,store_count,general_store_count,closure_rate,source_batch_id) "
                  + "VALUES (:code,'CS100010','20262',:stores,1,0.000000000000000000001,:batch)")
          .param("code", code)
          .param("stores", prefix.equals("district") ? 9007199254740993L : 999L)
          .param("batch", new UUID(0, batchStart))
          .update();
      jdbc.sql(
              "INSERT INTO "
                  + prefix
                  + "_sales_stat("
                  + column
                  + ",industry_code,quarter_code,monthly_sales_amount,source_batch_id) "
                  + "VALUES (:code,'CS100010','20262',:sales,:batch)")
          .param("code", code)
          .param("sales", prefix.equals("district") ? Long.MAX_VALUE : 888L)
          .param("batch", new UUID(0, batchStart + 1))
          .update();
      jdbc.sql(
              "INSERT INTO "
                  + prefix
                  + "_foot_traffic_stat("
                  + column
                  + ",quarter_code,total_foot_traffic,source_batch_id) "
                  + "VALUES (:code,'20262',123456789.123456789012345678901,:batch)")
          .param("code", code)
          .param("batch", new UUID(0, batchStart + 2))
          .update();
    }
  }

  @Test
  void readsOfficialDistrictAndDongCohortsSeparatelyWithExactProvenance() {
    var district = read(() -> repository.findDistrictInputs("20262", "CS100010"));
    var dong = read(() -> repository.findDongInputs("20262", "CS100010"));
    assertThat(district.unit()).isEqualTo(ScoreCalculation.RegionUnit.DISTRICT);
    assertThat(dong.unit()).isEqualTo(ScoreCalculation.RegionUnit.DONG);
    assertThat(district.regions())
        .extracting(ScoreInputSnapshot.RegionInput::regionCode)
        .containsExactly("00110", "00120");
    assertThat(dong.regions())
        .extracting(ScoreInputSnapshot.RegionInput::regionCode)
        .containsExactly("00110001", "00120001");
    var row = district.regions().getFirst();
    assertThat(row.storeCount().raw()).isEqualTo("9007199254740993");
    assertThat(row.sales().raw()).isEqualTo("9223372036854775807");
    assertThat(row.footTraffic().raw()).isEqualTo("123456789.123456789012345678901");
    assertThat(row.closureRate().raw()).isEqualTo("0.000000000000000000001");
    assertThat(dong.regions().getFirst().storeCount().raw()).isEqualTo("999");
    assertThat(dong.regions().getFirst().districtName()).isEqualTo("00110구");
    assertThat(row.storeCount().source().sourceBatchId()).isEqualTo(new UUID(0, 2));
    assertThat(row.sales().source().sourceBatchId()).isEqualTo(new UUID(0, 3));
    assertThat(row.footTraffic().source().sourceBatchId()).isEqualTo(new UUID(0, 4));
    var batch = row.sales().source().batch();
    assertThat(batch.datasetCode()).isEqualTo("SEOUL_DISTRICT_SALES_STAT");
    assertThat(batch.periodFrom()).isEqualTo("20251");
    assertThat(batch.periodTo()).isEqualTo("20262");
    assertThat(batch.etlVersion()).isEqualTo("test-v1");
    assertThat(batch.sourceChecksum()).isEqualTo("a".repeat(64));
    assertThat(batch.publishedAt()).isEqualTo(OffsetDateTime.parse("2026-10-02T00:00:00Z"));
    assertThat(batch.startedAt()).isEqualTo(OffsetDateTime.parse("2026-09-01T00:00:00Z"));
    assertThat(district.boundary().batchId()).isEqualTo(BOUNDARY);
    assertThat(district.boundaryRowsPresent()).isTrue();
    assertThat(district.readiness())
        .isEqualTo(new ScoreInputSnapshot.DatasetReadiness(true, true, true));
    assertThat(district.regions().get(1).sales().state())
        .isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
    assertThat(row.toScoreInput().orElseThrow().sales().number().toString())
        .isEqualTo("9223372036854775807");
  }

  @Test
  void keepsMissingNullAndActualZeroDistinctWithoutLosingSource() {
    jdbc.sql("UPDATE district_sales_stat SET monthly_sales_amount=NULL").update();
    var nullValue =
        read(() -> repository.findDistrictInputs("20262", "CS100010")).regions().getFirst().sales();
    assertThat(nullValue.state()).isEqualTo(ScoreInputSnapshot.MeasurementState.NULL);
    assertThat(nullValue.source().sourceBatchId()).isEqualTo(new UUID(0, 3));
    jdbc.sql("UPDATE district_sales_stat SET monthly_sales_amount=0").update();
    var zero =
        read(() -> repository.findDistrictInputs("20262", "CS100010")).regions().getFirst().sales();
    assertThat(zero.state()).isEqualTo(ScoreInputSnapshot.MeasurementState.PRESENT);
    assertThat(zero.raw()).isEqualTo("0");
    jdbc.sql("DELETE FROM district_sales_stat").update();
    var missing = read(() -> repository.findDistrictInputs("20262", "CS100010"));
    assertThat(missing.regions()).hasSize(2);
    assertThat(missing.regions().getFirst().sales().state())
        .isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
    assertThat(missing.regions().getFirst().sales().source().sourceBatchId()).isNull();
    assertThat(missing.readiness().sales()).isFalse();
  }

  static Stream<Arguments> invalidSources() {
    return Stream.of("district", "dong")
        .flatMap(
            prefix ->
                Stream.of("store", "sales", "foot_traffic")
                    .flatMap(
                        kind ->
                            invalidSourceVariants()
                                .map(
                                    args -> {
                                      Object[] source = args.get();
                                      String dataset =
                                          source[0].equals("wrongDataset")
                                              ? "SEOUL_OTHER_STAT"
                                              : "SEOUL_"
                                                  + prefix.toUpperCase(java.util.Locale.ROOT)
                                                  + "_"
                                                  + kind.toUpperCase(java.util.Locale.ROOT)
                                                  + "_STAT";
                                      return Arguments.of(
                                          prefix, kind, source[0], dataset, source[2], source[3],
                                          source[4], source[5], source[6]);
                                    })));
  }

  private static Stream<Arguments> invalidSourceVariants() {
    return Stream.of(
        Arguments.of(
            "wrongDataset",
            "SEOUL_DONG_SALES_STAT",
            "CSV",
            "SEOUL",
            null,
            "PUBLISHED",
            "2026-10-03"),
        Arguments.of(
            "source", "SEOUL_DISTRICT_SALES_STAT", "API", "SEOUL", null, "PUBLISHED", "2026-10-03"),
        Arguments.of(
            "shapeSource",
            "SEOUL_DISTRICT_SALES_STAT",
            "SHAPEFILE",
            "SEOUL",
            null,
            "PUBLISHED",
            "2026-10-03"),
        Arguments.of(
            "scope",
            "SEOUL_DISTRICT_SALES_STAT",
            "CSV",
            "DISTRICT",
            "00110",
            "PUBLISHED",
            "2026-10-03"),
        Arguments.of("skipped", "SEOUL_DISTRICT_SALES_STAT", "CSV", "SEOUL", null, "SKIPPED", null),
        Arguments.of("failed", "SEOUL_DISTRICT_SALES_STAT", "CSV", "SEOUL", null, "FAILED", null),
        Arguments.of("running", "SEOUL_DISTRICT_SALES_STAT", "CSV", "SEOUL", null, "RUNNING", null),
        Arguments.of(
            "unpublished", "SEOUL_DISTRICT_SALES_STAT", "CSV", "SEOUL", null, "PUBLISHED", null));
  }

  @ParameterizedTest
  @MethodSource("invalidSources")
  void reportsUnqualifiedActualSourceWithoutDroppingRegion(
      String prefix,
      String kind,
      String label,
      String dataset,
      String source,
      String scope,
      String scopeCode,
      String state,
      String published) {
    batch(20, dataset, source, scope, scopeCode, state, published);
    jdbc.sql("UPDATE " + prefix + "_" + kind + "_stat SET source_batch_id=:batch")
        .param("batch", new UUID(0, 20))
        .update();
    var snapshot =
        read(
            () ->
                prefix.equals("district")
                    ? repository.findDistrictInputs("20262", "CS100010")
                    : repository.findDongInputs("20262", "CS100010"));
    var row = snapshot.regions().getFirst();
    var raw =
        switch (kind) {
          case "store" -> row.storeCount();
          case "sales" -> row.sales();
          default -> row.footTraffic();
        };
    assertThat(snapshot.regions()).hasSize(2);
    assertThat(raw.state()).isEqualTo(ScoreInputSnapshot.MeasurementState.SOURCE_NOT_ELIGIBLE);
    assertThat(raw.source().batch().status()).isEqualTo(state);
    assertThat(raw.source().sourceBatchId()).isEqualTo(new UUID(0, 20));
    assertThat(row.toScoreInput()).isEmpty();
    assertThat(
            switch (kind) {
              case "store" -> snapshot.readiness().stores();
              case "sales" -> snapshot.readiness().sales();
              default -> snapshot.readiness().footTraffic();
            })
        .isFalse();
  }

  static Stream<Arguments> invalidBoundaries() {
    return Stream.of(
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "SKIPPED", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "FAILED", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "RUNNING", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", null),
        Arguments.of(
            "SEOUL_DISTRICT_STORE_STAT", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-20"),
        Arguments.of(
            "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "DISTRICT", "00110", "PUBLISHED", "2026-10-20"));
  }

  @ParameterizedTest
  @MethodSource("invalidBoundaries")
  void ignoresUnqualifiedBoundaryPublications(
      String dataset,
      String source,
      String scope,
      String scopeCode,
      String state,
      String published) {
    batch(20, dataset, source, scope, scopeCode, state, published);
    var snapshot = read(() -> repository.findDongInputs("20262", "CS100010"));
    assertThat(snapshot.boundary().batchId()).isEqualTo(BOUNDARY);
    assertThat(snapshot.regions()).hasSize(2);
  }

  @Test
  void ordersBoundaryByPublicationThenStartThenUuidBeforeCheckingRows() {
    batch(20, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-01");
    assertThat(read(() -> repository.findDistrictInputs("20262", "CS100010")).boundary().batchId())
        .isEqualTo(new UUID(0, 20));
    jdbc.sql("UPDATE etl_batch SET started_at='2026-08-01T00:00:00Z' WHERE batch_id=:id")
        .param("id", new UUID(0, 20))
        .update();
    assertThat(read(() -> repository.findDistrictInputs("20262", "CS100010")).boundary().batchId())
        .isEqualTo(BOUNDARY);
    jdbc.sql("UPDATE etl_batch SET published_at='2026-10-02T00:00:00Z' WHERE batch_id=:id")
        .param("id", new UUID(0, 20))
        .update();
    assertThat(read(() -> repository.findDistrictInputs("20262", "CS100010")).boundary().batchId())
        .isEqualTo(new UUID(0, 20));
  }

  @Test
  void keepsNumericTextStableAcrossRepeatedJdbcExecutions() {
    read(
        () -> {
          for (int i = 0; i < 8; i++) {
            for (var snapshot :
                new ScoreInputSnapshot[] {
                  repository.findDistrictInputs("20262", "CS100010"),
                  repository.findDongInputs("20262", "CS100010")
                }) {
              assertThat(snapshot.regions().getFirst().footTraffic().raw())
                  .isEqualTo("123456789.123456789012345678901");
              assertThat(snapshot.regions().getFirst().closureRate().raw())
                  .isEqualTo("0.000000000000000000001");
            }
          }
          return null;
        });
  }

  @Test
  void reportsDatasetReadinessSeparatelyForDistrictAndDong() {
    for (String kind : new String[] {"store", "sales", "foot_traffic"})
      jdbc.sql("DELETE FROM district_" + kind + "_stat").update();
    var district = read(() -> repository.findDistrictInputs("20262", "CS100010"));
    assertThat(district.regions()).hasSize(2);
    assertThat(district.readiness())
        .isEqualTo(new ScoreInputSnapshot.DatasetReadiness(false, false, false));
    assertThat(read(() -> repository.findDongInputs("20262", "CS100010")).readiness())
        .isEqualTo(new ScoreInputSnapshot.DatasetReadiness(true, true, true));
  }

  @Test
  void ignoresLatestEmptyAndSkippedStatisticsAndKeepsRowSpecificSources() {
    for (int i = 0; i < 6; i++) {
      String unit = i < 3 ? "DISTRICT" : "DONG";
      String kind = new String[] {"STORE", "SALES", "FOOT_TRAFFIC"}[i % 3];
      batch(
          30 + i,
          "SEOUL_" + unit + "_" + kind + "_STAT",
          "CSV",
          "SEOUL",
          null,
          "PUBLISHED",
          "2026-10-20");
      batch(40 + i, "SEOUL_" + unit + "_" + kind + "_STAT", "CSV", "SEOUL", null, "SKIPPED", null);
    }
    batch(50, "SEOUL_DISTRICT_SALES_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-09-02");
    jdbc.sql(
            "INSERT INTO district_sales_stat(district_code,industry_code,quarter_code,monthly_sales_amount,source_batch_id) VALUES ('00120','CS100010','20262',42,:batch)")
        .param("batch", new UUID(0, 50))
        .update();
    var snapshot = read(() -> repository.findDistrictInputs("20262", "CS100010"));
    assertThat(snapshot.regions().getFirst().sales().source().sourceBatchId())
        .isEqualTo(new UUID(0, 3));
    assertThat(snapshot.regions().get(1).sales().raw()).isEqualTo("42");
    assertThat(snapshot.regions().get(1).sales().source().sourceBatchId())
        .isEqualTo(new UUID(0, 50));
    assertThat(
            read(() -> repository.findDongInputs("20262", "CS100010"))
                .regions()
                .getFirst()
                .sales()
                .source()
                .sourceBatchId())
        .isEqualTo(new UUID(0, 6));
  }

  @Test
  void selectsLatestBoundaryBeforeCheckingItsRowsAndNeverFallsBack() {
    batch(20, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-20");
    for (var snapshot :
        new ScoreInputSnapshot[] {
          read(() -> repository.findDistrictInputs("20262", "CS100010")),
          read(() -> repository.findDongInputs("20262", "CS100010"))
        }) {
      assertThat(snapshot.boundary().batchId()).isEqualTo(new UUID(0, 20));
      assertThat(snapshot.boundaryRowsPresent()).isFalse();
      assertThat(snapshot.regions()).isEmpty();
    }
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED' WHERE dataset_code='SEOUL_DONG_BOUNDARY'")
        .update();
    var noBoundary = read(() -> repository.findDongInputs("20262", "CS100010"));
    assertThat(noBoundary.boundary()).isNull();
    assertThat(noBoundary.boundaryRowsPresent()).isFalse();
    assertThat(noBoundary.regions()).isEmpty();
  }

  @Test
  void excludesDongWhenParentOrDongRefersToDifferentBoundary() {
    batch(20, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-09-02");
    jdbc.sql("UPDATE district SET boundary_batch_id=:batch WHERE district_code='00110'")
        .param("batch", new UUID(0, 20))
        .update();
    jdbc.sql("UPDATE administrative_dong SET boundary_batch_id=:batch WHERE dong_code='00120001'")
        .param("batch", new UUID(0, 20))
        .update();
    assertThat(read(() -> repository.findDongInputs("20262", "CS100010")).regions()).isEmpty();
    assertThat(read(() -> repository.findDistrictInputs("20262", "CS100010")).regions())
        .extracting(ScoreInputSnapshot.RegionInput::regionCode)
        .containsExactly("00120");
  }

  @Test
  void filtersSalesAndStoresByIndustryAndQuarterButNotFootTrafficByIndustry() {
    var otherIndustry = read(() -> repository.findDistrictInputs("20262", "CS100001"));
    var row = otherIndustry.regions().getFirst();
    assertThat(row.sales().state()).isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
    assertThat(row.storeCount().state()).isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
    assertThat(row.footTraffic().raw()).isEqualTo("123456789.123456789012345678901");
    assertThat(otherIndustry.readiness())
        .isEqualTo(new ScoreInputSnapshot.DatasetReadiness(true, true, true));
    var past = read(() -> repository.findDistrictInputs("20251", "CS100010"));
    assertThat(past.regions())
        .hasSize(2)
        .allSatisfy(
            r -> {
              assertThat(r.sales().state())
                  .isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
              assertThat(r.footTraffic().state())
                  .isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
            });
  }

  @Test
  void requiresExistingReadOnlyRepeatableReadTransaction() {
    assertThatExceptionOfType(IllegalTransactionStateException.class)
        .isThrownBy(() -> repository.findDistrictInputs("20262", "CS100010"));
    var write = transaction(transactions, false, TransactionDefinition.ISOLATION_REPEATABLE_READ);
    assertThatIllegalStateException()
        .isThrownBy(() -> write.execute(s -> repository.findDistrictInputs("20262", "CS100010")));
    var weak = transaction(transactions, true, TransactionDefinition.ISOLATION_READ_COMMITTED);
    assertThatIllegalStateException()
        .isThrownBy(() -> weak.execute(s -> repository.findDongInputs("20262", "CS100010")));
  }

  @Test
  void preservesOneSnapshotAcrossRepublishingInAnotherTransaction() throws Exception {
    read(
        () -> {
          var first = repository.findDistrictInputs("20262", "CS100010");
          CompletableFuture.runAsync(
                  () -> {
                    batch(
                        20,
                        "SEOUL_DISTRICT_SALES_STAT",
                        "CSV",
                        "SEOUL",
                        null,
                        "PUBLISHED",
                        "2026-10-20");
                    jdbc.sql(
                            "UPDATE district_sales_stat SET monthly_sales_amount=42,source_batch_id=:batch")
                        .param("batch", new UUID(0, 20))
                        .update();
                  })
              .orTimeout(10, TimeUnit.SECONDS)
              .join();
          assertThat(repository.findDistrictInputs("20262", "CS100010")).isEqualTo(first);
          return first;
        });
    var next = read(() -> repository.findDistrictInputs("20262", "CS100010"));
    assertThat(next.regions().getFirst().sales().raw()).isEqualTo("42");
    assertThat(next.regions().getFirst().sales().source().sourceBatchId())
        .isEqualTo(new UUID(0, 20));
  }

  @Test
  void executesOnePreparedQueryForTheWholeCohortRegardlessOfRegionCount() {
    var counting = new CountingDataSource(dataSource);
    var direct = new ScoreInputRepository(JdbcClient.create(counting));
    var tx =
        transaction(
            new JdbcTransactionManager(counting),
            true,
            TransactionDefinition.ISOLATION_REPEATABLE_READ);
    assertThat(tx.execute(s -> direct.findDistrictInputs("20262", "CS100010")).regions())
        .hasSize(2);
    assertThat(counting.queries.getAndSet(0)).isEqualTo(1);
    jdbc.sql(
            """
        INSERT INTO district SELECT lpad(i::text,5,'0'),'합성구',
          ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),:batch FROM generate_series(200,399) i
        """)
        .param("batch", BOUNDARY)
        .update();
    assertThat(tx.execute(s -> direct.findDistrictInputs("20262", "CS100010")).regions())
        .hasSize(202);
    assertThat(counting.queries.get()).isEqualTo(1);
  }

  private <T> T read(Supplier<T> action) {
    return transaction(transactions, true, TransactionDefinition.ISOLATION_REPEATABLE_READ)
        .execute(s -> action.get());
  }

  private static TransactionTemplate transaction(
      PlatformTransactionManager manager, boolean readOnly, int isolation) {
    var tx = new TransactionTemplate(manager);
    tx.setReadOnly(readOnly);
    tx.setIsolationLevel(isolation);
    return tx;
  }

  private void batch(
      long id,
      String dataset,
      String source,
      String scope,
      String scopeCode,
      String state,
      String published) {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,scope_code,source_reference,
          source_checksum,etl_version,status,period_from,period_to,started_at,published_at)
        VALUES (:id,:dataset,:source,:scope,:scopeCode,'synthetic',:checksum,'test-v1',:state,
          '20251','20262','2026-09-01T00:00:00Z',CAST(:published AS timestamptz))
        """)
        .param("id", new UUID(0, id))
        .param("dataset", dataset)
        .param("source", source)
        .param("scope", scope)
        .param("scopeCode", scopeCode)
        .param("checksum", "a".repeat(64))
        .param("state", state)
        .param("published", published == null ? null : published + "T00:00:00Z")
        .update();
  }

  /** 실제 JDBC prepareStatement 횟수를 관찰하며 제품 코드나 데이터베이스 설정은 바꾸지 않는다. */
  private static final class CountingDataSource extends DelegatingDataSource {
    final AtomicInteger queries = new AtomicInteger();

    CountingDataSource(DataSource target) {
      super(target);
    }

    @Override
    public Connection getConnection() throws SQLException {
      return count(super.getConnection());
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
      return count(super.getConnection(username, password));
    }

    private Connection count(Connection connection) {
      return (Connection)
          Proxy.newProxyInstance(
              Connection.class.getClassLoader(),
              new Class<?>[] {Connection.class},
              (proxy, method, args) -> {
                if (method.getName().equals("prepareStatement")) queries.incrementAndGet();
                try {
                  return method.invoke(connection, args);
                } catch (InvocationTargetException e) {
                  throw e.getCause();
                }
              });
    }
  }
}
