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
import kr.ac.recycleyoungs.foottraffic.DistrictFootTrafficStatRepository;
import kr.ac.recycleyoungs.region.RegionRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
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

/** 일회용 PostGIS의 공식 자치구 통계로 HTTP·게시 출처·정밀도·스냅샷을 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("db")
@Testcontainers
class DistrictFootTrafficStatApiIntegrationTests {

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
  private static final UUID FOOT_TRAFFIC = new UUID(0, 2);
  private static final UUID OLD_FOOT_TRAFFIC = new UUID(0, 3);
  private static final UUID API_FOOT_TRAFFIC = new UUID(0, 9);
  @Autowired private JdbcClient jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private Flyway flyway;
  @MockitoSpyBean private RegionRepository regions;
  @MockitoSpyBean private DistrictFootTrafficStatRepository repository;

  @BeforeEach
  void seedIsolatedDatabase() {
    jdbc.sql("DELETE FROM district_foot_traffic_stat").update();
    jdbc.sql("DELETE FROM dong_foot_traffic_stat").update();
    jdbc.sql("DELETE FROM administrative_dong").update();
    jdbc.sql("DELETE FROM district").update();
    jdbc.sql("DELETE FROM etl_batch").update();
    batch(BOUNDARY, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-10-01");
    batch(
        FOOT_TRAFFIC,
        "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
        "CSV",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-02");
    batch(
        OLD_FOOT_TRAFFIC,
        "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
        "CSV",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-09-01");
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
        INSERT INTO district_foot_traffic_stat(district_code,quarter_code,total_foot_traffic,source_batch_id)
        VALUES ('00110','20261',42,:batch)
        """)
        .param("batch", OLD_FOOT_TRAFFIC)
        .update();
    jdbc.sql(
            """
        INSERT INTO district_foot_traffic_stat VALUES ('00110','20262',
          9007199254740993.123456789012345678900,0.00000000000000000000100,NULL,:batch)
        """)
        .param("batch", FOOT_TRAFFIC)
        .update();
    batch(
        new UUID(0, 20),
        "SEOUL_DONG_FOOT_TRAFFIC_STAT",
        "CSV",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-03");
    // 동 통계와 다른 값을 넣어 공식 자치구 통계를 동 합계로 대체할 수 없게 한다.
    jdbc.sql(
            "INSERT INTO dong_foot_traffic_stat(dong_code,quarter_code,total_foot_traffic,source_batch_id) VALUES ('00110001','20262',999,:batch)")
        .param("batch", new UUID(0, 20))
        .update();
  }

  @Test
  void returnsExactNumericStringsAndNullWithPublication() throws Exception {
    mvc.perform(get("/api/v1/districts/00110/stats/foot-traffic").param("quarterCode", "20262"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districtCode").value("00110"))
        .andExpect(jsonPath("$.dongCode").doesNotExist())
        .andExpect(jsonPath("$.quarterCode").value("20262"))
        .andExpect(jsonPath("$.industryCode").doesNotExist())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"))
        .andExpect(jsonPath("$.data.maleFootTraffic").value("0.00000000000000000000100"))
        .andExpect(jsonPath("$.data.femaleFootTraffic").value(nullValue()))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(FOOT_TRAFFIC.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"))
        .andExpect(jsonPath("$.data.sourceBatch.sourceReference").doesNotExist())
        .andExpect(jsonPath("$.data.sourceBatch.sourceChecksum").doesNotExist())
        .andExpect(jsonPath("$.data.sourceBatch.path").doesNotExist());
  }

  @Test
  void apiOnlyPublicationPreparesDatasetAndPreservesExactValuesAndSource() throws Exception {
    jdbc.sql("DELETE FROM district_foot_traffic_stat WHERE quarter_code='20261'").update();
    publishCurrentQuarterFromApi();
    jdbc.sql(
            "UPDATE district_foot_traffic_stat SET male_foot_traffic=0.0000 WHERE quarter_code='20262'")
        .update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"))
        .andExpect(jsonPath("$.data.maleFootTraffic").value("0.0000"))
        .andExpect(jsonPath("$.data.femaleFootTraffic").value(nullValue()))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(API_FOOT_TRAFFIC.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-04T00:00:00Z"));
    mvc.perform(request("00110", "20261"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(nullValue()));
  }

  @Test
  void preservesScaleAndMismatchBetweenTotalAndGenderSum() throws Exception {
    jdbc.sql(
            """
        UPDATE district_foot_traffic_stat SET total_foot_traffic=10.2500,
          male_foot_traffic=4.100,female_foot_traffic=5.10 WHERE quarter_code='20262'
        """)
        .update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.totalFootTraffic").value("10.2500"))
        .andExpect(jsonPath("$.data.maleFootTraffic").value("4.100"))
        .andExpect(jsonPath("$.data.femaleFootTraffic").value("5.10"));
  }

  @Test
  void keepsPlainNumericTextAcrossRepeatedJdbcExecutions() throws Exception {
    // JDBC가 반복 실행에서 바이너리 전송으로 바뀌어도 소수 자릿수·표현이 같아야 한다.
    for (var attempt = 0; attempt < 8; attempt++) {
      mvc.perform(request("00110", "20262"))
          .andExpect(status().isOk())
          .andExpect(
              jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"))
          .andExpect(jsonPath("$.data.maleFootTraffic").value("0.00000000000000000000100"));
    }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"9007199254740993", "123.45000", "0", "0.0000", "0.00000000000000000000100"})
  void preservesIntegerFractionAndZeroScaleForEveryMeasurement(String value) throws Exception {
    jdbc.sql(
            """
        UPDATE district_foot_traffic_stat SET total_foot_traffic=CAST(:value AS numeric),
          male_foot_traffic=CAST(:value AS numeric),female_foot_traffic=CAST(:value AS numeric)
        WHERE quarter_code='20262'
        """)
        .param("value", value)
        .update();
    var result = mvc.perform(request("00110", "20262")).andExpect(status().isOk());
    for (var field : new String[] {"totalFootTraffic", "maleFootTraffic", "femaleFootTraffic"}) {
      result
          .andExpect(jsonPath("$.data." + field).isString())
          .andExpect(jsonPath("$.data." + field).value(value));
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"CS100010", "", " "})
  void rejectsIndustryEvenWhenPublishedDataIsNotReady(String industry) throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(request("00110", "20262").param("industryCode", industry))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @Test
  void keepsHistoricalCsvAndCurrentApiSourcesDespiteNewerPublications() throws Exception {
    publishCurrentQuarterFromApi();
    // 더 최신의 빈 정상 배치나 SKIPPED 이력이 기존 분기의 정상 출처를 가리지 않아야 한다.
    batch(
        new UUID(0, 4),
        "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
        "CSV",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-20");
    batch(
        new UUID(0, 5), "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "SKIPPED", null);
    batch(new UUID(0, 6), "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "FAILED", null);
    batch(
        new UUID(0, 7), "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "RUNNING", null);
    mvc.perform(request("00110", "20261"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.totalFootTraffic").value("42"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(OLD_FOOT_TRAFFIC.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-09-01T00:00:00Z"));
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(API_FOOT_TRAFFIC.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-04T00:00:00Z"));
  }

  /** 해당 분기 행이 API 배치를 참조하는 게시 상태를 재현한다. */
  private void publishCurrentQuarterFromApi() {
    batch(
        API_FOOT_TRAFFIC,
        "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
        "API",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-04");
    jdbc.sql(
            "UPDATE district_foot_traffic_stat SET source_batch_id=:batch WHERE quarter_code='20262'")
        .param("batch", API_FOOT_TRAFFIC)
        .update();
  }

  @ParameterizedTest
  @ValueSource(strings = {"20254", "20263"})
  void returnsNullWithoutSubstitutingAnotherQuarter(String quarter) throws Exception {
    mvc.perform(request("00110", quarter))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districtCode").value("00110"))
        .andExpect(jsonPath("$.quarterCode").value(quarter))
        .andExpect(jsonPath("$.data").value(nullValue()));
  }

  @Test
  void distinguishesRowWithAllNullMeasurementsFromMissingRow() throws Exception {
    jdbc.sql(
            """
        UPDATE district_foot_traffic_stat SET total_foot_traffic=NULL,
          male_foot_traffic=NULL,female_foot_traffic=NULL WHERE quarter_code='20262'
        """)
        .update();
    var result =
        mvc.perform(request("00110", "20262"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isMap())
            .andExpect(jsonPath("$.data.sourceBatch.batchId").value(FOOT_TRAFFIC.toString()));
    for (var field : new String[] {"totalFootTraffic", "maleFootTraffic", "femaleFootTraffic"}) {
      result.andExpect(jsonPath("$.data." + field).value(nullValue()));
    }
  }

  @Test
  void allNullRowAloneStillPreparesDatasetAndKeepsSource() throws Exception {
    jdbc.sql("DELETE FROM district_foot_traffic_stat WHERE quarter_code='20261'").update();
    jdbc.sql(
            "UPDATE district_foot_traffic_stat SET total_foot_traffic=NULL,male_foot_traffic=NULL,female_foot_traffic=NULL")
        .update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").isMap())
        .andExpect(jsonPath("$.data.totalFootTraffic").value(nullValue()))
        .andExpect(jsonPath("$.data.maleFootTraffic").value(nullValue()))
        .andExpect(jsonPath("$.data.femaleFootTraffic").value(nullValue()))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(FOOT_TRAFFIC.toString()));
    mvc.perform(request("00110", "20261"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(nullValue()));
  }

  @Test
  void serializesActualZeroAsStringInEveryMeasurement() throws Exception {
    jdbc.sql(
            """
        UPDATE district_foot_traffic_stat SET total_foot_traffic=0,
          male_foot_traffic=0,female_foot_traffic=0 WHERE quarter_code='20262'
        """)
        .update();
    var result = mvc.perform(request("00110", "20262")).andExpect(status().isOk());
    for (var field : new String[] {"totalFootTraffic", "maleFootTraffic", "femaleFootTraffic"}) {
      result.andExpect(jsonPath("$.data." + field).value("0"));
    }
  }

  static Stream<Arguments> invalidBatches() {
    return Stream.of(
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "SKIPPED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "FAILED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "RUNNING", "2026-10-02"),
        Arguments.of("SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "PUBLISHED", null),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "API", "SEOUL", null, "SKIPPED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "API", "SEOUL", null, "FAILED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "API", "SEOUL", null, "RUNNING", "2026-10-02"),
        Arguments.of("SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "API", "SEOUL", null, "PUBLISHED", null),
        Arguments.of(
            "SEOUL_DONG_FOOT_TRAFFIC_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-02"),
        Arguments.of("SEOUL_DISTRICT_STORE_STAT", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DONG_FOOT_TRAFFIC_STAT", "API", "SEOUL", null, "PUBLISHED", "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
            "SHAPEFILE",
            "SEOUL",
            null,
            "PUBLISHED",
            "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
            "CSV",
            "DISTRICT",
            "00110",
            "PUBLISHED",
            "2026-10-02"),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
            "API",
            "DISTRICT",
            "00110",
            "PUBLISHED",
            "2026-10-02"));
  }

  @ParameterizedTest
  @MethodSource("invalidBatches")
  void excludesUnqualifiedRowSourceWhileOtherPublishedDataRemains(
      String dataset, String source, String scope, String scopeCode, String state, String published)
      throws Exception {
    var invalid = new UUID(0, 8);
    batch(invalid, dataset, source, scope, scopeCode, state, published);
    jdbc.sql(
            "UPDATE district_foot_traffic_stat SET source_batch_id=:batch WHERE quarter_code='20262'")
        .param("batch", invalid)
        .update();
    mvc.perform(request("00110", "20262"))
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
    jdbc.sql("UPDATE district_foot_traffic_stat SET source_batch_id=:batch")
        .param("batch", invalid)
        .update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void reportsEmptyDistrictDatasetAsNotReadyDespiteHistoryAndActualDongData() throws Exception {
    jdbc.sql("DELETE FROM district_foot_traffic_stat").update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void rejectsMissingDistrictBeforeCheckingFootTrafficReadiness() throws Exception {
    jdbc.sql("DELETE FROM district_foot_traffic_stat").update();
    mvc.perform(request("99999", "20262"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @Test
  void excludesDistrictOutsideLatestBoundaryEvenWhenItsStatisticsExist() throws Exception {
    var oldBoundary = new UUID(0, 9);
    batch(
        oldBoundary, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", "2026-09-01");
    // 최신 동 경계가 남아 있어도 요청한 구 자체의 현행 게시본을 확인해야 한다.
    jdbc.sql("UPDATE district SET boundary_batch_id=:batch").param("batch", oldBoundary).update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @Test
  void doesNotRequireDongBoundariesOrAggregateDongStatistics() throws Exception {
    jdbc.sql("DELETE FROM dong_foot_traffic_stat").update();
    jdbc.sql("DELETE FROM administrative_dong").update();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"));
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
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void appliesV7InDisposablePostgis() {
    assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("7");
    assertThat(flyway.info().pending()).isEmpty();
  }

  @ParameterizedTest
  @ValueSource(strings = {"0011", "001100", "0011A", "００１１０", "00110 "})
  void rejectsMalformedDistrictBeforeLookup(String district) throws Exception {
    mvc.perform(request(district, "20262"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"", " ", "20260", "20265", "2026", "202612", "２０２６2", "20262\n", "20262,20262"})
  void rejectsMalformedQuarterBeforeLookup(String quarter) throws Exception {
    mvc.perform(request("00110", quarter))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @Test
  void rejectsMissingQuarterAndIndustryWithoutValue() throws Exception {
    mvc.perform(get("/api/v1/districts/00110/stats/foot-traffic"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(get("/api/v1/districts/00110/stats/foot-traffic?quarterCode=20262&industryCode"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  static Stream<Arguments> invalidBoundaryBatches() {
    return Stream.of(
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "SKIPPED", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "FAILED", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "RUNNING", "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "SHAPEFILE", "SEOUL", null, "PUBLISHED", null),
        Arguments.of(
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
            "SHAPEFILE",
            "SEOUL",
            null,
            "PUBLISHED",
            "2026-10-20"),
        Arguments.of("SEOUL_DONG_BOUNDARY", "CSV", "SEOUL", null, "PUBLISHED", "2026-10-20"),
        Arguments.of(
            "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "DISTRICT", "00110", "PUBLISHED", "2026-10-20"));
  }

  @ParameterizedTest
  @MethodSource("invalidBoundaryBatches")
  void ignoresNewerUnqualifiedBoundaryHistory(
      String dataset, String source, String scope, String scopeCode, String state, String published)
      throws Exception {
    batch(new UUID(0, 9), dataset, source, scope, scopeCode, state, published);
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"));
  }

  @Test
  void validatesParametersBeforeDataReadiness() throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(request("00110", "20265"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(request("00110", "20262").param("quarterCode", "20262"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @ParameterizedTest
  @CsvSource({"boundary,CSV", "footTraffic,CSV", "boundary,API", "footTraffic,API"})
  void keepsBoundaryStatisticsAndSourceInOneSnapshotDuringPublication(String point, String source)
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
            publishReplacement(source);
          }
          return selected;
        };
    // 경계 선택 직후와 통계 준비 확인 직후에 각각 외부 트랜잭션을 확정한다.
    if (point.equals("boundary")) {
      doAnswer(publishAfterRead).when(regions).findLatestPublishedBatch();
    } else {
      doAnswer(publishAfterRead).when(repository).hasPublishedData();
    }
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(FOOT_TRAFFIC.toString()))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
    assertThat(published).isTrue();
    mvc.perform(request("00110", "20262"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.totalFootTraffic").value("77"))
        .andExpect(
            jsonPath("$.data.sourceBatch.batchId").value("00000000-0000-0000-0000-000000000011"))
        .andExpect(jsonPath("$.data.sourceBatch.publishedAt").value("2026-10-21T00:00:00Z"));
  }

  /** 테스트 컨테이너의 별도 연결에서 경계·통계·PUBLISHED 이력을 원자적으로 교체한다. */
  private void publishReplacement(String source) throws Exception {
    try (var connection = flyway.getConfiguration().getDataSource().getConnection();
        var statement = connection.createStatement();
        var insert =
            connection.prepareStatement(
                """
            INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
              etl_version,status,published_at,started_at) VALUES
            ('00000000-0000-0000-0000-000000000010','SEOUL_DONG_BOUNDARY','SHAPEFILE','SEOUL',
              'synthetic fixture','test-v1','PUBLISHED','2026-10-21T00:00:00Z','2026-10-21T00:00:00Z'),
            ('00000000-0000-0000-0000-000000000011','SEOUL_DISTRICT_FOOT_TRAFFIC_STAT',?,'SEOUL',
              'synthetic fixture','test-v1','RUNNING',NULL,'2026-10-21T00:00:00Z')
            """)) {
      connection.setAutoCommit(false);
      insert.setString(1, source);
      insert.executeUpdate();
      statement.executeUpdate(
          "UPDATE district SET boundary_batch_id='00000000-0000-0000-0000-000000000010'");
      statement.executeUpdate(
          "UPDATE administrative_dong SET boundary_batch_id='00000000-0000-0000-0000-000000000010'");
      statement.executeUpdate(
          "UPDATE district_foot_traffic_stat SET total_foot_traffic=77,source_batch_id='00000000-0000-0000-0000-000000000011' WHERE quarter_code='20262'");
      statement.executeUpdate(
          "UPDATE etl_batch SET status='PUBLISHED',published_at='2026-10-21T00:00:00Z' WHERE batch_id='00000000-0000-0000-0000-000000000011'");
      connection.commit();
    }
  }

  private MockHttpServletRequestBuilder request(String district, String quarter) {
    return get("/api/v1/districts/{district}/stats/foot-traffic", district)
        .param("quarterCode", quarter);
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
