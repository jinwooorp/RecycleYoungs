package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.math.BigInteger;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 기존 마이그레이션을 일회용 PostGIS에 적용하고 Service→Repository→실제 계산기를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("db")
@Testcontainers
class ScoreServiceIntegrationTests {
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

  @Autowired private ScoreService service;
  @Autowired private JdbcClient jdbc;
  @Autowired private MockMvc mvc;
  @MockitoSpyBean private ScoreInputRepository repository;

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
    jdbc.sql("INSERT INTO service_industry VALUES ('CS100010','카페',:batch)")
        .param("batch", new UUID(0, 2))
        .update();
    int[] stores = {10, 30, 40, 20, 50};
    for (int i = 0; i < 5; i++) {
      String district = String.format(Locale.ROOT, "%05d", 110 + i * 10);
      jdbc.sql(
              """
          INSERT INTO district VALUES (:code,:name,ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),:batch)
          """)
          .param("code", district)
          .param("name", new String[] {"가", "나", "다", "라", "마"}[i])
          .param("batch", new UUID(0, 1))
          .update();
      jdbc.sql(
              """
          INSERT INTO administrative_dong VALUES (:dong,:code,:name,
            ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),
            ST_SetSRID(ST_MakePoint(127.005,37.005),4326),1000,:batch)
          """)
          .param("dong", district + "001")
          .param("code", district)
          .param("name", district + "동")
          .param("batch", new UUID(0, 1))
          .update();
      for (String prefix : new String[] {"district", "dong"}) {
        int index = prefix.equals("district") ? i : 4 - i;
        int start = prefix.equals("district") ? 2 : 5;
        String key = prefix + "_code";
        String code = prefix.equals("district") ? district : district + "001";
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_store_stat("
                    + key
                    + ",industry_code,quarter_code,store_count,closure_rate,source_batch_id) VALUES (:code,'CS100010','20262',:stores,:closure,:batch)")
            .param("code", code)
            .param("stores", stores[index])
            .param("closure", index + 1)
            .param("batch", new UUID(0, start))
            .update();
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_sales_stat("
                    + key
                    + ",industry_code,quarter_code,monthly_sales_amount,source_batch_id) VALUES (:code,'CS100010','20262',:sales,:batch)")
            .param("code", code)
            .param("sales", (index + 1) * 1000)
            .param("batch", new UUID(0, start + 1))
            .update();
        jdbc.sql(
                "INSERT INTO "
                    + prefix
                    + "_foot_traffic_stat("
                    + key
                    + ",quarter_code,total_foot_traffic,source_batch_id) VALUES (:code,'20262',:foot,:batch)")
            .param("code", code)
            .param("foot", (index + 1) * 100)
            .param("batch", new UUID(0, start + 2))
            .update();
      }
    }
  }

  @Test
  void calculatesWholeDistrictAndDongCohortsAndReproducesSixtyFive() {
    var district = service.diagnoseDistrict("00140", "20262", "CS100010");
    var dong = service.diagnoseDong("00120001", "20262", "CS100010");
    for (var result : new InternalScoreResult[] {district, dong}) {
      assertThat(result.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_CALCULATED);
      assertThat(result.publicationState())
          .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
      assertThat(result.eligibleCount()).isEqualTo(5);
      assertThat(result.selectedScore().score()).isEqualTo(fraction(65, 1));
      assertThat(result.selectedScore().rank().average()).isEqualTo(fraction(1, 1));
      assertThat(result.snapshot().regions()).hasSize(5);
    }
    assertThat(district.cohortScores())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(
            fraction(40, 1), fraction(40, 1), fraction(45, 1), fraction(65, 1), fraction(60, 1));
    assertThat(dong.cohortScores())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(
            fraction(60, 1), fraction(65, 1), fraction(45, 1), fraction(40, 1), fraction(40, 1));
    verify(repositoryTarget(), times(1)).findDistrictInputs("20262", "CS100010");
    verify(repositoryTarget(), times(1)).findDongInputs("20262", "CS100010");
  }

  @Test
  void missingSelectedRegionPrecedesDatasetReadinessAndEmptyBoundaryPrecedesBoth() {
    jdbc.sql("DELETE FROM district_sales_stat").update();
    assertThat(service.diagnoseDistrict("99999", "20262", "CS100010").status())
        .isEqualTo(InternalScoreResult.Status.REGION_NOT_FOUND);
    assertThat(service.diagnoseDistrict("00140", "20262", "CS100010").status())
        .isEqualTo(InternalScoreResult.Status.DATASET_NOT_READY);
    batch(20, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
    assertThat(service.diagnoseDistrict("99999", "20262", "CS100010").status())
        .isEqualTo(InternalScoreResult.Status.BOUNDARY_NOT_READY);
  }

  @Test
  void preservesUnqualifiedMissingNullAndActualZeroWhileCalculatingOnlyCompleteRows() {
    jdbc.sql("DELETE FROM district_sales_stat WHERE district_code='00110'").update();
    jdbc.sql("UPDATE district_sales_stat SET monthly_sales_amount=NULL WHERE district_code='00120'")
        .update();
    batch(20, "SEOUL_DISTRICT_SALES_STAT", "CSV");
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED' WHERE batch_id=:id")
        .param("id", new UUID(0, 20))
        .update();
    jdbc.sql("UPDATE district_sales_stat SET source_batch_id=:id WHERE district_code='00130'")
        .param("id", new UUID(0, 20))
        .update();
    jdbc.sql("UPDATE district_sales_stat SET monthly_sales_amount=0 WHERE district_code='00140'")
        .update();
    var result = service.diagnoseDistrict("00140", "20262", "CS100010");
    assertThat(result.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_CALCULATED);
    assertThat(result.eligibleCount()).isEqualTo(2);
    assertThat(result.selectedScore().input().sales().number()).isZero();
    assertThat(result.excluded())
        .extracting(e -> e.reasons().getFirst().code())
        .containsExactly(
            InternalScoreResult.ReasonCode.INPUT_ROW_MISSING,
            InternalScoreResult.ReasonCode.INPUT_NULL,
            InternalScoreResult.ReasonCode.SOURCE_NOT_ELIGIBLE);
    var excluded = service.diagnoseDistrict("00130", "20262", "CS100010");
    assertThat(excluded.status()).isEqualTo(InternalScoreResult.Status.NOT_CALCULABLE);
    assertThat(excluded.selectedScore()).isNull();
    assertThat(excluded.cohortScores()).isEqualTo(result.cohortScores());
  }

  @Test
  void withholdsCohortWhenClosureRateIsConstantOrOnlyOneRegionRemains() {
    jdbc.sql("UPDATE dong_store_stat SET closure_rate=0").update();
    var constant = service.diagnoseDong("00120001", "20262", "CS100010");
    assertThat(constant.status()).isEqualTo(InternalScoreResult.Status.NOT_CALCULABLE);
    assertThat(constant.reasons())
        .containsExactly(
            new InternalScoreResult.Reason(
                InternalScoreResult.ReasonCode.CONSTANT_INDICATOR, ScoreMetric.CLOSURE_RATE));
    assertThat(constant.cohortScores()).isEmpty();
    jdbc.sql("DELETE FROM dong_sales_stat WHERE dong_code<>'00120001'").update();
    var small = service.diagnoseDong("00120001", "20262", "CS100010");
    assertThat(small.eligibleCount()).isEqualTo(1);
    assertThat(small.reasons().getFirst().code())
        .isEqualTo(InternalScoreResult.ReasonCode.INSUFFICIENT_COHORT);
    assertThat(small.selectedScore()).isNull();
  }

  @Test
  void opensOneReadOnlyRepeatableReadAndNeverRereadsSnapshotAfterRepublishing() {
    AtomicBoolean changed = new AtomicBoolean();
    doAnswer(
            invocation -> {
              assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
              assertThat(TransactionSynchronizationManager.isCurrentTransactionReadOnly()).isTrue();
              assertThat(jdbc.sql("SHOW transaction_isolation").query(String.class).single())
                  .isEqualTo("repeatable read");
              assertThat(jdbc.sql("SHOW transaction_read_only").query(String.class).single())
                  .isEqualTo("on");
              var snapshot = (ScoreInputSnapshot) invocation.callRealMethod();
              if (changed.compareAndSet(false, true))
                CompletableFuture.runAsync(
                        () -> {
                          batch(20, "SEOUL_DISTRICT_SALES_STAT", "CSV");
                          jdbc.sql(
                                  "UPDATE district_sales_stat SET monthly_sales_amount=999999,source_batch_id=:id WHERE district_code='00110'")
                              .param("id", new UUID(0, 20))
                              .update();
                          batch(21, "SEOUL_DONG_BOUNDARY", "SHAPEFILE");
                        })
                    .orTimeout(10, TimeUnit.SECONDS)
                    .join();
              assertThat(
                      jdbc.sql(
                              "SELECT monthly_sales_amount FROM district_sales_stat WHERE district_code='00110'")
                          .query(String.class)
                          .single())
                  .isEqualTo("1000");
              return snapshot;
            })
        .when(repositoryTarget())
        .findDistrictInputs("20262", "CS100010");
    var first = service.diagnoseDistrict("00140", "20262", "CS100010");
    assertThat(first.selectedScore().score()).isEqualTo(fraction(65, 1));
    assertThat(first.snapshot().boundary().batchId()).isEqualTo(new UUID(0, 1));
    assertThat(first.snapshot().regions().getFirst().sales().raw()).isEqualTo("1000");
    verify(repositoryTarget(), times(1)).findDistrictInputs("20262", "CS100010");
    reset(repositoryTarget());
    assertThat(service.diagnoseDistrict("00140", "20262", "CS100010").status())
        .isEqualTo(InternalScoreResult.Status.BOUNDARY_NOT_READY);
  }

  @Test
  void returnsInternalSqlFailureWithoutUnexpectedRollbackOrLeakingQueryText() {
    doAnswer(
            invocation ->
                jdbc.sql("SELECT * FROM synthetic_missing_score_table")
                    .query(Integer.class)
                    .single())
        .when(repositoryTarget())
        .findDistrictInputs("20262", "CS100010");
    var failure = service.diagnoseDistrict("00140", "20262", "CS100010");
    assertThat(failure.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_ERROR);
    assertThat(failure.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(failure.toString()).doesNotContain("synthetic_missing_score_table");
  }

  @Test
  void nextRequestUsesRepublishedInputsWithoutCachingOrInferringApproval() {
    var first = service.diagnoseDistrict("00140", "20262", "CS100010");
    batch(20, "SEOUL_DISTRICT_SALES_STAT", "CSV");
    jdbc.sql(
            "UPDATE district_sales_stat SET monthly_sales_amount=10000,source_batch_id=:id WHERE district_code='00110'")
        .param("id", new UUID(0, 20))
        .update();
    var next = service.diagnoseDistrict("00140", "20262", "CS100010");
    assertThat(first.selectedScore().score()).isEqualTo(fraction(65, 1));
    assertThat(next.selectedScore().score()).isEqualTo(fraction(115, 2));
    assertThat(next.selectedScore().rank().average()).isEqualTo(fraction(2, 1));
    assertThat(next.snapshot().regions().getFirst().sales().source().sourceBatchId())
        .isEqualTo(new UUID(0, 20));
    assertThat(first.snapshot().regions().getFirst().sales().raw()).isEqualTo("1000");
    assertThat(next.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
  }

  @Test
  void blocksPublicScoreEvenWithCalculableInputsAndPreservesStatisticsApi() throws Exception {
    var internal = service.diagnoseDistrict("00140", "20262", "CS100010");
    assertThat(internal.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    // 내부 계산 성공 후에도 공개 요청은 Repository를 다시 호출하지 않고 차단돼야 한다.
    clearInvocations(repositoryTarget());
    mvc.perform(
            get("/api/v1/districts/00140/score")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"))
        .andExpect(jsonPath("$.length()").value(5));
    mvc.perform(
            get("/api/v1/dongs/00120001/score")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"))
        .andExpect(jsonPath("$.length()").value(5));
    verifyNoInteractions(repositoryTarget());
    mvc.perform(
            get("/api/v1/districts/00140/stats/stores")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().isOk());
  }

  private void batch(long id, String dataset, String source) {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
          etl_version,status,started_at,published_at) VALUES (:id,:dataset,:source,'SEOUL','synthetic',
          'test-v1','PUBLISHED','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z')
        """)
        .param("id", new UUID(0, id))
        .param("dataset", dataset)
        .param("source", source)
        .update();
  }

  /** MANDATORY 프록시를 테스트의 stubbing·검증 단계에서 호출하지 않고 실제 spy 대상을 사용한다. */
  private ScoreInputRepository repositoryTarget() {
    return AopTestUtils.getUltimateTargetObject(repository);
  }

  private static ExactFraction fraction(long numerator, long denominator) {
    return new ExactFraction(BigInteger.valueOf(numerator), BigInteger.valueOf(denominator));
  }
}
