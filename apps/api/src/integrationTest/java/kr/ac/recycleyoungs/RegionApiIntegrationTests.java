package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import kr.ac.recycleyoungs.region.RegionRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 합성 경계와 일회용 PostGIS로 HTTP부터 실제 JdbcClient 조회까지 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("db")
@Testcontainers
class RegionApiIntegrationTests {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
    // 서비스·마이그레이션 모두 외부 설정보다 우선하는 컨테이너 연결로 고정한다.
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  private static final UUID OLD = new UUID(0, 1);
  private static final UUID CURRENT = new UUID(0, 2);
  private static final String GEOMETRY =
      "ST_GeomFromText('MULTIPOLYGON(((127 37,127.01 37,127.01 37.01,127 37.01,127 37)))',4326)";

  @Autowired private JdbcClient jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private Flyway flyway;
  @MockitoSpyBean private RegionRepository repository;

  @BeforeEach
  void seedIsolatedDatabase() {
    // 이 클래스 전용 컨테이너의 합성 데이터만 정리한다. 개발 DB에는 접근하지 않는다.
    jdbc.sql("DELETE FROM administrative_dong").update();
    jdbc.sql("DELETE FROM district").update();
    jdbc.sql("DELETE FROM etl_batch").update();
    batch(
        OLD,
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-01",
        "2026-10-20");
    batch(
        CURRENT,
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-02",
        "2026-10-02");
    batch(
        new UUID(0, 3),
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "SKIPPED",
        "2026-10-03",
        "2026-10-03");
    batch(
        new UUID(0, 4),
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "FAILED",
        "2026-10-04",
        "2026-10-04");
    batch(
        new UUID(0, 5),
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "RUNNING",
        "2026-10-05",
        "2026-10-05");
    batch(
        new UUID(0, 6),
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        null,
        "2026-10-06");
    batch(
        new UUID(0, 7),
        "OTHER_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-07",
        "2026-10-07");
    batch(
        new UUID(0, 8),
        "SEOUL_DONG_BOUNDARY",
        "CSV",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-08",
        "2026-10-08");
    batch(
        new UUID(0, 9),
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "DISTRICT",
        "11110",
        "PUBLISHED",
        "2026-10-09",
        "2026-10-09");
    district("11140", "가구", CURRENT);
    district("11110", "나구", CURRENT);
    district("00001", "다구", CURRENT);
    district("11680", "과거구", OLD);
    dong("11110002", "가동", CURRENT);
    dong("11110001", "나동", CURRENT);
    dong("00001001", "영동", CURRENT);
    dong("11110999", "과거동", OLD);
    dong("11680001", "과거구의동", OLD);
    // 동 출처만 최신이어도 부모 구가 과거 출처이면 현행 행정동으로 노출하지 않는다.
    dong("11680002", "부모구불일치동", CURRENT);
  }

  @Test
  void listsOnlyCurrentDistrictsInCodeOrderPreservingLeadingZeros() throws Exception {
    mvc.perform(get("/api/v1/districts"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].districtCode", contains("00001", "11110", "11140")))
        .andExpect(jsonPath("$.items[1].districtName").value("나구"));
  }

  @Test
  void nearbyFindsMultipleDistrictsAndOnlyIntersectingDongs() throws Exception {
    nearbyGeometry();
    mvc.perform(nearby("127.009", "37.005"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11110", "11140")))
        .andExpect(jsonPath("$.districts[*].containsCenter", contains(true, false)))
        .andExpect(jsonPath("$.dongs[*].dongCode", contains("11110001", "11140001")))
        .andExpect(jsonPath("$.dongs[*].containsCenter", contains(true, false)))
        .andExpect(jsonPath("$.boundaryBatch.batchId").value(CURRENT.toString()))
        .andExpect(jsonPath("$.boundaryBatch.publishedAt").value("2026-10-02T00:00:00Z"));
  }

  @Test
  void nearbyIncludesEveryRegionCoveringCenterOnSharedBoundary() throws Exception {
    nearbyGeometry();
    mvc.perform(nearby("127.01", "37.01").param("radiusM", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].containsCenter", contains(true, true)))
        .andExpect(
            jsonPath(
                "$.dongs[*].dongCode", contains("11110001", "11110002", "11140001", "11140002")))
        .andExpect(jsonPath("$.dongs[*].containsCenter", contains(true, true, true, true)));
  }

  @Test
  void nearbyUsesDefault500MetersAndAllows1000Meters() throws Exception {
    nearbyGeometry();
    mvc.perform(nearby("127.004", "37.005"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11110")));
    mvc.perform(nearby("127.004", "37.005").param("radiusM", "1000"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11110", "11140")));
  }

  @Test
  void nearbyRestrictsRepeatedDistrictFiltersWithoutExpandingRadius() throws Exception {
    nearbyGeometry();
    mvc.perform(nearby("127.009", "37.005").param("districtCodes", "11140"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11140")))
        .andExpect(jsonPath("$.dongs[*].dongCode", contains("11140001")));
    mvc.perform(nearby("127.009", "37.005").param("districtCodes", "11140", "11110", "11140"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11110", "11140")))
        .andExpect(jsonPath("$.dongs[*].dongCode", contains("11110001", "11140001")));
  }

  @Test
  void nearbyChecksActualDistrictIntersectionInsteadOfOnlyDongForeignKey() throws Exception {
    nearbyGeometry();
    setGeometry("district", "district_code", "11110", "127,37,127.005,37.01");
    setGeometry("administrative_dong", "dong_code", "11110001", "127.008,37,127.01,37.01");
    // 구와 동이 각각 반경에 닿더라도 두 경계가 서로 만나지 않으면 선택 영역의 동이 아니다.
    mvc.perform(nearby("127.009", "37.005").param("districtCodes", "11110"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11110")))
        .andExpect(jsonPath("$.dongs").isEmpty());
  }

  @Test
  void nearbyIncludesRadiusContactButExcludesJustOutside() throws Exception {
    nearbyGeometry();
    setGeometry("district", "district_code", "11110", "0.001,-0.001,0.002,0.001");
    setGeometry("administrative_dong", "dong_code", "11110001", "0.001,-0.001,0.002,0.001");
    // 이론상 거리는 111.31949079327357m다. PostGIS 부동소수 연산 차이를 반영해
    // 접촉 반경을 1nm 안쪽으로 표현하고, 아래에서는 1mm 바깥의 제외도 확인한다.
    mvc.perform(nearby("0", "0").param("radiusM", "111.31949079427357"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts[*].districtCode", contains("11110")))
        .andExpect(jsonPath("$.dongs[*].dongCode", contains("11110001")))
        .andExpect(jsonPath("$.districts[0].containsCenter").value(false));
    mvc.perform(nearby("0", "0").param("radiusM", "111.31849079327357"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts").isEmpty())
        .andExpect(jsonPath("$.dongs").isEmpty());
  }

  @ParameterizedTest
  @ValueSource(strings = {"99999", "11680"})
  void nearbyRejectsMissingOrHistoricalSelectedDistricts(String code) throws Exception {
    nearbyGeometry();
    mvc.perform(nearby("139.7", "35.7").param("districtCodes", "11110", code))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @Test
  void nearbyReturnsEmptyListsForOutsideSeoulAndNonIntersectingSelectedDistrict() throws Exception {
    nearbyGeometry();
    mvc.perform(nearby("139.7", "35.7"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts").isEmpty())
        .andExpect(jsonPath("$.dongs").isEmpty())
        .andExpect(jsonPath("$.boundaryBatch.batchId").value(CURRENT.toString()));
    mvc.perform(nearby("127.009", "37.005").param("districtCodes", "00001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts").isEmpty())
        .andExpect(jsonPath("$.dongs").isEmpty());
  }

  @Test
  void nearbyReturnsDataNotReadyWithoutPublication() throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(nearby("127", "37"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void nearbyRejectsInvalidParametersBeforeCheckingPublication() throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(nearby("NaN", "37"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder nearby(
      String longitude, String latitude) {
    return get("/api/v1/regions/nearby").param("longitude", longitude).param("latitude", latitude);
  }

  private void nearbyGeometry() {
    setGeometry("district", "district_code", "11110", "127,37,127.01,37.02");
    setGeometry("district", "district_code", "11140", "127.01,37,127.02,37.02");
    setGeometry("district", "district_code", "00001", "129,37,129.01,37.02");
    setGeometry("administrative_dong", "dong_code", "11110001", "127,37,127.01,37.01");
    setGeometry("administrative_dong", "dong_code", "11110002", "127,37.01,127.01,37.02");
    setGeometry("administrative_dong", "dong_code", "00001001", "129,37,129.01,37.02");
    dong("11140002", "동쪽위동", CURRENT);
    dong("11140001", "동쪽아래동", CURRENT);
    setGeometry("administrative_dong", "dong_code", "11140001", "127.01,37,127.02,37.01");
    setGeometry("administrative_dong", "dong_code", "11140002", "127.01,37.01,127.02,37.02");
  }

  /** 테이블·컬럼·좌표는 합성 테스트 상수만 사용하고 식별 코드만 바인딩한다. */
  private void setGeometry(String table, String key, String code, String envelope) {
    jdbc.sql(
            "UPDATE "
                + table
                + " SET geom=ST_Multi(ST_MakeEnvelope("
                + envelope
                + ",4326)) WHERE "
                + key
                + "=:code")
        .param("code", code)
        .update();
  }

  @Test
  void listsOnlyCurrentDongsWithinSelectedDistrictInCodeOrder() throws Exception {
    // 대표점은 경계 중심으로 재계산하지 않고 저장된 원본 값을 반환해야 한다.
    jdbc.sql(
            "UPDATE administrative_dong SET label_point=ST_SetSRID(ST_MakePoint(127.002,37.003),4326) WHERE dong_code='11110001'")
        .update();
    mvc.perform(get("/api/v1/districts/11110/dongs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].dongCode", contains("11110001", "11110002")))
        .andExpect(jsonPath("$.items[0].districtCode").value("11110"))
        .andExpect(jsonPath("$.items[0].labelPoint.type").value("Point"))
        .andExpect(jsonPath("$.items[0].labelPoint.coordinates[0]").value(127.002))
        .andExpect(jsonPath("$.items[0].labelPoint.coordinates[1]").value(37.003))
        .andExpect(jsonPath("$.items[0].labelPoint.crs").doesNotExist());
    mvc.perform(get("/api/v1/districts/11140/dongs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty());
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/api/v1/districts", "/api/v1/districts/11110/dongs",
        "/api/v1/districts/11110/boundary", "/api/v1/dongs/11110001/boundary",
        "/api/v1/regions/nearby?longitude=127&latitude=37"
      })
  void rejectsLatestPublicationWithoutAnyBoundaryRowsInsteadOfFallingBack(String path)
      throws Exception {
    // 기존 정상 행은 과거 배치에 그대로 둔 채 빈 최신 게시 이력만 추가한다.
    batch(
        new UUID(0, 99),
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-30",
        "2026-10-30");
    mvc.perform(get(path))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void keepsPublishedDistrictUsableWhenItHasNoDongRows() throws Exception {
    // 경계 행이 일부라도 존재하면 전체 적재 건수를 임의로 요구하지 않는다.
    jdbc.sql("DELETE FROM administrative_dong").update();
    mvc.perform(get("/api/v1/districts/11110/dongs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty());
  }

  @Test
  void returnsDistrictGeoJsonFeatureAndPublicationMetadata() throws Exception {
    mvc.perform(get("/api/v1/districts/00001/boundary"))
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith("application/geo+json"))
        .andExpect(jsonPath("$.type").value("Feature"))
        .andExpect(jsonPath("$.id").value("00001"))
        .andExpect(jsonPath("$.geometry.type").value("MultiPolygon"))
        .andExpect(jsonPath("$.geometry.coordinates[0][0][0][0]").value(127.0))
        .andExpect(jsonPath("$.geometry.coordinates[0][0][0][1]").value(37.0))
        .andExpect(jsonPath("$.geometry.crs").doesNotExist())
        .andExpect(jsonPath("$.properties.regionType").value("DISTRICT"))
        .andExpect(jsonPath("$.properties.regionCode").value("00001"))
        .andExpect(jsonPath("$.properties.regionName").value("다구"))
        .andExpect(jsonPath("$.properties.boundaryBatch.batchId").value(CURRENT.toString()))
        .andExpect(
            jsonPath("$.properties.boundaryBatch.publishedAt").value("2026-10-02T00:00:00Z"));
  }

  @Test
  void returnsDongGeoJsonFeatureWithParentDistrict() throws Exception {
    mvc.perform(get("/api/v1/dongs/11110001/boundary"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.type").value("Feature"))
        .andExpect(jsonPath("$.id").value("11110001"))
        .andExpect(jsonPath("$.geometry.type").value("MultiPolygon"))
        .andExpect(jsonPath("$.properties.regionType").value("DONG"))
        .andExpect(jsonPath("$.properties.regionName").value("나동"))
        .andExpect(jsonPath("$.properties.districtCode").value("11110"))
        .andExpect(jsonPath("$.properties.boundaryBatch.batchId").value(CURRENT.toString()));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/api/v1/districts/11680/dongs", "/api/v1/districts/11680/boundary",
        "/api/v1/dongs/11110999/boundary", "/api/v1/dongs/11680002/boundary",
        "/api/v1/districts/99999/dongs", "/api/v1/districts/99999/boundary",
        "/api/v1/dongs/99999999/boundary"
      })
  void rejectsHistoricalAndMissingRegions(String path) throws Exception {
    mvc.perform(get(path))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/api/v1/districts", "/api/v1/districts/11110/dongs",
        "/api/v1/districts/11110/boundary", "/api/v1/dongs/11110001/boundary"
      })
  void returnsDataNotReadyWhenNoQualifiedPublicationExists(String path) throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(get(path))
        .andExpect(status().isServiceUnavailable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void rejectsInvalidCodeBeforeCheckingPublication() throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    mvc.perform(get("/api/v1/districts/1111A/boundary"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @Test
  void breaksPublicationTiesByStartedAtThenBatchId() throws Exception {
    var laterStart = new UUID(0, 10);
    batch(
        laterStart,
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-02",
        "2026-10-03");
    jdbc.sql("UPDATE district SET boundary_batch_id=:batch WHERE district_code='11140'")
        .param("batch", laterStart)
        .update();
    mvc.perform(get("/api/v1/districts"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].districtCode", contains("11140")));
    var laterId = new UUID(0, 11);
    batch(
        laterId,
        "SEOUL_DONG_BOUNDARY",
        "SHAPEFILE",
        "SEOUL",
        null,
        "PUBLISHED",
        "2026-10-02",
        "2026-10-03");
    jdbc.sql("UPDATE district SET boundary_batch_id=:batch WHERE district_code='11110'")
        .param("batch", laterId)
        .update();
    mvc.perform(get("/api/v1/districts"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].districtCode", contains("11110")));
  }

  @Test
  void keepsBatchAndRegionsInSameSnapshotDuringPublication() throws Exception {
    doAnswer(
            invocation -> {
              var selected = invocation.callRealMethod();
              // 첫 SELECT 직후 별도 연결에서 새 게시를 확정해 두 조회 사이의 갱신을 재현한다.
              try (var connection = flyway.getConfiguration().getDataSource().getConnection();
                  var statement = connection.createStatement()) {
                connection.setAutoCommit(false);
                statement.executeUpdate(
                    """
            INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
              etl_version,status,published_at,started_at)
            VALUES ('00000000-0000-0000-0000-000000000010','SEOUL_DONG_BOUNDARY',
              'SHAPEFILE','SEOUL','synthetic fixture','test-v1','PUBLISHED',
              '2026-10-10T00:00:00Z','2026-10-10T00:00:00Z')
            """);
                statement.executeUpdate(
                    "UPDATE district SET district_name='새구' WHERE district_code='11110'");
                statement.executeUpdate(
                    "UPDATE district SET boundary_batch_id='00000000-0000-0000-0000-000000000010' WHERE boundary_batch_id='00000000-0000-0000-0000-000000000002'");
                statement.executeUpdate(
                    "UPDATE administrative_dong SET boundary_batch_id='00000000-0000-0000-0000-000000000010' WHERE boundary_batch_id='00000000-0000-0000-0000-000000000002'");
                connection.commit();
              }
              return selected;
            })
        .when(repository)
        .findLatestPublishedBatch();
    mvc.perform(get("/api/v1/districts"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].districtCode", contains("00001", "11110", "11140")))
        .andExpect(jsonPath("$.items[1].districtName").value("나구"));
    assertThat(
            jdbc.sql("SELECT district_name FROM district WHERE district_code='11110'")
                .query(String.class)
                .single())
        .isEqualTo("새구");
  }

  private void batch(
      UUID id,
      String dataset,
      String source,
      String scope,
      String scopeCode,
      String state,
      String published,
      String started) {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,scope_code,
          source_reference,etl_version,status,published_at,started_at)
        VALUES (:id,:dataset,:source,:scope,:scopeCode,'synthetic fixture','test-v1',:state,
          CAST(:published AS timestamptz),CAST(:started AS timestamptz))
        """)
        .param("id", id)
        .param("dataset", dataset)
        .param("source", source)
        .param("scope", scope)
        .param("scopeCode", scopeCode)
        .param("state", state)
        .param("published", published == null ? null : published + "T00:00:00Z")
        .param("started", started + "T00:00:00Z")
        .update();
  }

  private void district(String code, String name, UUID batch) {
    jdbc.sql("INSERT INTO district VALUES (:code,:name," + GEOMETRY + ",:batch)")
        .param("code", code)
        .param("name", name)
        .param("batch", batch)
        .update();
  }

  private void dong(String code, String name, UUID batch) {
    jdbc.sql(
            "INSERT INTO administrative_dong VALUES (:code,:district,:name,"
                + GEOMETRY
                + ",ST_SetSRID(ST_MakePoint(127.005,37.005),4326),100,:batch)")
        .param("code", code)
        .param("district", code.substring(0, 5))
        .param("name", name)
        .param("batch", batch)
        .update();
  }
}
