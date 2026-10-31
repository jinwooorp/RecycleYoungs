package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.sales.SalesStatRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 일회용 PostGIS의 합성 추정매출로 HTTP·게시 출처·수치 정밀도를 함께 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("db")
@Testcontainers
class SalesStatApiIntegrationTests {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
    // 서비스와 Flyway 연결을 모두 이 클래스의 컨테이너로 고정한다.
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  private static final UUID BOUNDARY = new UUID(0, 1);
  private static final UUID SALES = new UUID(0, 2);
  private static final UUID OLD_SALES = new UUID(0, 3);
  @Autowired private JdbcClient jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private Flyway flyway;
  @MockitoSpyBean private RegionRepository regions;
  @MockitoSpyBean private SalesStatRepository repository;

  @BeforeEach
  void seedIsolatedDatabase() {
    jdbc.sql("DELETE FROM dong_sales_stat").update();
    jdbc.sql("DELETE FROM service_industry").update();
    jdbc.sql("DELETE FROM administrative_dong").update();
    jdbc.sql("DELETE FROM district").update();
    jdbc.sql("DELETE FROM etl_batch").update();
    batch(BOUNDARY, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-01");
    batch(SALES, "SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-02");
    batch(OLD_SALES, "SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-09-01");
    jdbc.sql(
            """
        INSERT INTO district VALUES ('00110','예시구',
          ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),:batch)
        """)
        .param("batch", BOUNDARY)
        .update();
    jdbc.sql(
            """
        INSERT INTO administrative_dong VALUES ('00110001','00110','예시동',
          ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),
          ST_SetSRID(ST_MakePoint(127.005,37.005),4326),1000,:batch)
        """)
        .param("batch", BOUNDARY)
        .update();
    jdbc.sql(
            """
        INSERT INTO service_industry VALUES ('CS100010','커피-음료',:batch)
        """)
        .param("batch", SALES)
        .update();
    jdbc.sql(
            """
        INSERT INTO dong_sales_stat(dong_code,industry_code,quarter_code,monthly_sales_amount,source_batch_id)
        VALUES ('00110001','CS100010','20261',42,:batch)
        """)
        .param("batch", OLD_SALES)
        .update();
    jdbc.sql(
            """
        INSERT INTO dong_sales_stat VALUES ('00110001','CS100010','20262',
          9007199254740993,NULL,0,9223372036854775807,:batch)
        """)
        .param("batch", SALES)
        .update();
  }

  @Test
  void returnsExactSalesStringsAndPublicationWithoutAggregation() throws Exception {
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/sales")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dongCode").value("00110001"))
        .andExpect(jsonPath("$.quarterCode").value("20262"))
        .andExpect(jsonPath("$.industryCode").value("CS100010"))
        .andExpect(jsonPath("$.data.monthlySalesAmount").value("9007199254740993"))
        .andExpect(jsonPath("$.data.monthlySalesCount").value(nullValue()))
        .andExpect(jsonPath("$.data.weekdaySalesAmount").value("0"))
        .andExpect(jsonPath("$.data.weekendSalesAmount").value("9223372036854775807"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(SALES.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
  }

  @Test
  void preservesMonthlyMeaningAndAllowsMismatchWithWeekdayWeekendSum() throws Exception {
    // 6,000+4,000과 당월 10,001의 차이를 허용하며 분기 합계·월평균을 생성하지 않는다.
    jdbc.sql(
            """
        UPDATE dong_sales_stat SET monthly_sales_amount=10001,monthly_sales_count=7,
          weekday_sales_amount=6000,weekend_sales_amount=4000 WHERE quarter_code='20262'
        """)
        .update();
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.monthlySalesAmount").value("10001"))
        .andExpect(jsonPath("$.data.monthlySalesCount").value("7"))
        .andExpect(jsonPath("$.data.weekdaySalesAmount").value("6000"))
        .andExpect(jsonPath("$.data.weekendSalesAmount").value("4000"));
  }

  @Test
  void keepsHistoricalQuarterAndItsOwnSourceDespiteNewerPublications() throws Exception {
    // 더 최신의 빈 정상 배치나 SKIPPED 이력이 기존 분기의 정상 출처를 가리지 않아야 한다.
    batch(new UUID(0, 4), "SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-20");
    batch(new UUID(0, 5), "SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "SKIPPED", null);
    mvc.perform(request("00110001", "20261", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.monthlySalesAmount").value("42"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(OLD_SALES.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-09-01T00:00:00Z"));
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(SALES.toString()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"20254", "20263"})
  void returnsNullWithoutSubstitutingAnotherQuarter(String quarter) throws Exception {
    mvc.perform(request("00110001", quarter, "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dongCode").value("00110001"))
        .andExpect(jsonPath("$.quarterCode").value(quarter))
        .andExpect(jsonPath("$.industryCode").value("CS100010"))
        .andExpect(jsonPath("$.data").value(nullValue()));
  }

  @Test
  void returnsNullForWellFormedIndustryWithoutStatistics() throws Exception {
    mvc.perform(request("00110001", "20262", "CS999999"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.industryCode").value("CS999999"))
        .andExpect(jsonPath("$.data").value(nullValue()));
  }

  @Test
  void distinguishesRowWithAllNullMeasurementsFromMissingRow() throws Exception {
    jdbc.sql(
            """
        UPDATE dong_sales_stat SET monthly_sales_amount=NULL,monthly_sales_count=NULL,
          weekday_sales_amount=NULL,weekend_sales_amount=NULL WHERE quarter_code='20262'
        """)
        .update();
    var result =
        mvc.perform(request("00110001", "20262", "CS100010"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isMap())
            .andExpect(jsonPath("$.data.sourceBatch.batchId").value(SALES.toString()));
    for (var field :
        new String[] {
          "monthlySalesAmount", "monthlySalesCount", "weekdaySalesAmount", "weekendSalesAmount"
        }) {
      result.andExpect(jsonPath("$.data." + field).value(nullValue()));
    }
  }

  @Test
  void serializesActualZeroAsStringInEveryMeasurement() throws Exception {
    jdbc.sql(
            """
        UPDATE dong_sales_stat SET monthly_sales_amount=0,monthly_sales_count=0,
          weekday_sales_amount=0,weekend_sales_amount=0 WHERE quarter_code='20262'
        """)
        .update();
    var result = mvc.perform(request("00110001", "20262", "CS100010")).andExpect(status().isOk());
    for (var field :
        new String[] {
          "monthlySalesAmount", "monthlySalesCount", "weekdaySalesAmount", "weekendSalesAmount"
        }) {
      result.andExpect(jsonPath("$.data." + field).value("0"));
    }
  }

  static Stream<Arguments> invalidBatches() {
    return Stream.of(
        Arguments.of("SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "SKIPPED", "2026-10-02"),
        Arguments.of("SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "FAILED", "2026-10-02"),
        Arguments.of("SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "RUNNING", "2026-10-02"),
        Arguments.of("SEOUL_DONG_SALES_STAT", "CSV", "SEOUL", null, "PUBLISHED", null),
        Arguments.of("SEOUL_DONG_STORE_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-02"),
        Arguments.of("SEOUL_DONG_SALES_STAT", "API", "SEOUL", null, "PUBLISHED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DONG_SALES_STAT", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DONG_SALES_STAT", "CSV", "DISTRICT", "00110", "PUBLISHED", "2026-10-02"));
  }

  @ParameterizedTest
  @MethodSource("invalidBatches")
  void excludesUnqualifiedRowSourceWhileOtherPublishedDataRemains(
      String dataset, String source, String scope, String scopeCode, String state, String published)
      throws Exception {
    var invalid = new UUID(0, 8);
    batch(invalid, dataset, source, scope, scopeCode, state, published);
    jdbc.sql("UPDATE dong_sales_stat SET source_batch_id=:batch WHERE quarter_code='20262'")
        .param("batch", invalid)
        .update();
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(nullValue()));
  }

  @ParameterizedTest
  @MethodSource("invalidBatches")
  void reportsNotReadyWhenNoActualRowHasQualifiedSource(
      String dataset, String source, String scope, String scopeCode, String state, String published)
      throws Exception {
    var invalid = new UUID(0, 8);
    batch(invalid, dataset, source, scope, scopeCode, state, published);
    // 정상 게시 이력만 남아 있어도 실제 유효 행이 없으면 준비 완료로 보지 않는다.
    jdbc.sql("UPDATE dong_sales_stat SET source_batch_id=:batch").param("batch", invalid).update();
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void reportsEmptySalesDatasetAsNotReadyDespitePublishedHistory() throws Exception {
    jdbc.sql("DELETE FROM dong_sales_stat").update();
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void rejectsMissingDongBeforeCheckingSalesReadiness() throws Exception {
    jdbc.sql("DELETE FROM dong_sales_stat").update();
    mvc.perform(request("99999999", "20262", "CS100010"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"dong", "district"})
  void excludesDongWhenItOrItsParentIsOutsideLatestBoundary(String target) throws Exception {
    var oldBoundary = new UUID(0, 9);
    batch(
        oldBoundary, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-09-01");
    if (target.equals("dong")) {
      jdbc.sql("UPDATE administrative_dong SET boundary_batch_id=:batch")
          .param("batch", oldBoundary)
          .update();
    } else {
      jdbc.sql("UPDATE district SET boundary_batch_id=:batch").param("batch", oldBoundary).update();
    }
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"unpublished", "emptyLatest"})
  void requiresPreparedLatestBoundary(String condition) throws Exception {
    if (condition.equals("unpublished")) {
      jdbc.sql("UPDATE etl_batch SET status='SKIPPED' WHERE batch_id=:batch")
          .param("batch", BOUNDARY)
          .update();
    } else {
      batch(
          new UUID(0, 9),
          "SEOUL_DONG_BOUNDARY",
          "SHAPEFILE",
          "SEOUL",
          null,
          "PUBLISHED",
          "2026-10-20");
    }
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void validatesParametersBeforeDataReadiness() throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(request("00110001", "20265", "CS100010"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(request("00110001", "20262", "CS100010").param("quarterCode", "20262"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"boundary", "sales"})
  void keepsBoundaryStatisticsAndSourceInOneSnapshotDuringPublication(String point)
      throws Exception {
    var published = new AtomicBoolean();
    org.mockito.stubbing.Answer<Object> publishAfterRead =
        invocation -> {
          var selected = invocation.callRealMethod();
          assertThat(jdbc.sql("SHOW transaction_read_only").query(String.class).single())
              .isEqualTo("on");
          assertThat(jdbc.sql("SHOW transaction_isolation").query(String.class).single())
              .isEqualTo("repeatable read");
          if (published.compareAndSet(false, true)) {
            publishReplacement();
          }
          return selected;
        };
    // 경계 선택 직후와 통계 준비 확인 직후에 각각 외부 트랜잭션을 확정한다.
    if (point.equals("boundary")) {
      doAnswer(publishAfterRead).when(regions).findLatestPublishedBatch();
    } else {
      doAnswer(publishAfterRead).when(repository).hasPublishedData();
    }
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.monthlySalesAmount").value("9007199254740993"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(SALES.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
    assertThat(published).isTrue();
    mvc.perform(request("00110001", "20262", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.monthlySalesAmount").value("77"))
        .andExpect(
            jsonPath("$.data.sourceBatch.batchId").value("00000000-0000-0000-0000-000000000011"))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-21T00:00:00Z"));
  }

  /** 테스트 컨테이너의 별도 연결에서 경계·통계·PUBLISHED 이력을 원자적으로 교체한다. */
  private void publishReplacement() throws Exception {
    try (var connection = flyway.getConfiguration().getDataSource().getConnection();
        var statement = connection.createStatement()) {
      connection.setAutoCommit(false);
      statement.executeUpdate(
          """
          INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
            etl_version,status,published_at,started_at) VALUES
          ('00000000-0000-0000-0000-000000000010','SEOUL_DONG_BOUNDARY','SHAPEFILE','SEOUL',
            'synthetic fixture','test-v1','PUBLISHED','2026-10-21T00:00:00Z','2026-10-21T00:00:00Z'),
          ('00000000-0000-0000-0000-000000000011','SEOUL_DONG_SALES_STAT','CSV','SEOUL',
            'synthetic fixture','test-v1','RUNNING',NULL,'2026-10-21T00:00:00Z')
          """);
      statement.executeUpdate(
          "UPDATE district SET boundary_batch_id='00000000-0000-0000-0000-000000000010'");
      statement.executeUpdate(
          "UPDATE administrative_dong SET boundary_batch_id='00000000-0000-0000-0000-000000000010'");
      statement.executeUpdate(
          "UPDATE dong_sales_stat SET monthly_sales_amount=77,source_batch_id='00000000-0000-0000-0000-000000000011' WHERE quarter_code='20262'");
      statement.executeUpdate(
          "UPDATE etl_batch SET status='PUBLISHED',published_at='2026-10-21T00:00:00Z' WHERE batch_id='00000000-0000-0000-0000-000000000011'");
      connection.commit();
    }
  }

  private MockHttpServletRequestBuilder request(String dong, String quarter, String industry) {
    return get("/api/v1/dongs/{dong}/stats/sales", dong)
        .param("quarterCode", quarter)
        .param("industryCode", industry);
  }

  private void batch(
      UUID id,
      String dataset,
      String source,
      String scope,
      String scopeCode,
      String state,
      String published) {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,scope_code,
          source_reference,etl_version,status,published_at,started_at)
        VALUES (:id,:dataset,:source,:scope,:scopeCode,'synthetic fixture','test-v1',:state,
          CAST(:published AS timestamptz),'2026-10-01T00:00:00Z')
        """)
        .param("id", id)
        .param("dataset", dataset)
        .param("source", source)
        .param("scope", scope)
        .param("scopeCode", scopeCode)
        .param("state", state)
        .param("published", published == null ? null : published + "T00:00:00Z")
        .update();
  }
}
