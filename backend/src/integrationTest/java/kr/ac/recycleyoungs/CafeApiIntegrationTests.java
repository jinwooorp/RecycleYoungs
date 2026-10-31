package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;
import kr.ac.recycleyoungs.cafe.CafeRepository;
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
import org.springframework.http.MediaType;
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

/** 일회용 PostGIS의 합성 카페로 HTTP부터 공간 조회와 게시 출처까지 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("db")
@Testcontainers
class CafeApiIntegrationTests {

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
  private static final UUID CURRENT = new UUID(0, 2);
  private static final UUID OLD = new UUID(0, 3);
  private static final String FULL_SOURCE =
      "{\"collection_mode\":\"FULL_SEOUL\",\"complete\":true,\"classification_verified\":true}";

  @Autowired private JdbcClient jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private Flyway flyway;
  @MockitoSpyBean private CafeRepository repository;

  @BeforeEach
  void seedIsolatedDatabase() {
    // 이 클래스 전용 컨테이너만 정리하며 개발 DB나 다른 테스트 컨테이너에 접근하지 않는다.
    jdbc.sql("DELETE FROM cafe_store").update();
    jdbc.sql("DELETE FROM administrative_dong").update();
    jdbc.sql("DELETE FROM district").update();
    jdbc.sql("DELETE FROM etl_batch").update();
    batch(CURRENT, "2026-10-02", "2026-10-02", FULL_SOURCE);
    batch(OLD, "2026-09-01", "2026-10-20", FULL_SOURCE);
    cafe("000001", "중심카페", 127, 37, CURRENT);
    cafe("000099", "과거카페", 127, 37, OLD);
  }

  @Test
  void findsPublishedCafeInViewportWithoutRequiringBoundaryData() throws Exception {
    jdbc.sql(
            """
        UPDATE cafe_store SET branch_name='서울점',road_address='서울시 예시로 1',
          lot_address='서울시 예시동 1',ksic_code='56221',source_dong_code='1234567890'
        WHERE bizes_id='000001'
        """)
        .update();
    cafe("2", "가까운카페", 127, 37, CURRENT);
    cafe("10", "먼카페", 127.09, 37.09, CURRENT);
    mvc.perform(viewport())
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.length()").value(6))
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "10", "2")))
        .andExpect(jsonPath("$.items[0].length()").value(9))
        .andExpect(jsonPath("$.items[0].storeName").value("중심카페"))
        .andExpect(jsonPath("$.items[0].branchName").value("서울점"))
        .andExpect(jsonPath("$.items[0].semasIndustryCode").value("I21201"))
        .andExpect(jsonPath("$.items[0].semasIndustryName").value("카페"))
        .andExpect(jsonPath("$.items[0].roadAddress").value("서울시 예시로 1"))
        .andExpect(jsonPath("$.items[0].lotAddress").value("서울시 예시동 1"))
        .andExpect(jsonPath("$.items[0].longitude").value(127.0))
        .andExpect(jsonPath("$.items[0].latitude").value(37.0))
        .andExpect(jsonPath("$.items[1].branchName").value(nullValue()))
        .andExpect(jsonPath("$.items[1].roadAddress").value(nullValue()))
        .andExpect(jsonPath("$.items[1].lotAddress").value(nullValue()))
        .andExpect(jsonPath("$.items[*].distanceM").isEmpty())
        .andExpect(jsonPath("$.items[0].sourceBatchId").doesNotExist())
        .andExpect(jsonPath("$.items[0].sourceDongCode").doesNotExist())
        .andExpect(jsonPath("$.items[0].ksicCode").doesNotExist())
        .andExpect(jsonPath("$.sourceReference").doesNotExist())
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.limit").value(100))
        .andExpect(jsonPath("$.offset").value(0))
        .andExpect(jsonPath("$.hasMore").value(false))
        .andExpect(jsonPath("$.sourceBatch.length()").value(2))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()))
        .andExpect(jsonPath("$.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
  }

  @Test
  void viewportCoversEveryEdgeAndCornerButExcludesOutsideAndNullGeometry() throws Exception {
    cafe("edge-west", "서쪽변", 126.9, 37, CURRENT);
    cafe("edge-east", "동쪽변", 127.1, 37, CURRENT);
    cafe("edge-south", "남쪽변", 127, 36.9, CURRENT);
    cafe("edge-north", "북쪽변", 127, 37.1, CURRENT);
    cafe("corner-sw", "남서꼭짓점", 126.9, 36.9, CURRENT);
    cafe("corner-se", "남동꼭짓점", 127.1, 36.9, CURRENT);
    cafe("corner-nw", "북서꼭짓점", 126.9, 37.1, CURRENT);
    cafe("corner-ne", "북동꼭짓점", 127.1, 37.1, CURRENT);
    cafe("outside-west", "서쪽밖", 126.899999, 37, CURRENT);
    cafe("outside-east", "동쪽밖", 127.100001, 37, CURRENT);
    cafe("outside-south", "남쪽밖", 127, 36.899999, CURRENT);
    cafe("outside-north", "북쪽밖", 127, 37.100001, CURRENT);
    cafe("null-geometry", "좌표없음", 127, 37, CURRENT);
    jdbc.sql("UPDATE cafe_store SET geom=NULL WHERE bizes_id='null-geometry'").update();
    mvc.perform(viewport())
        .andExpect(status().isOk())
        .andExpect(
            jsonPath(
                "$.items[*].bizesId",
                contains(
                    "000001",
                    "corner-ne",
                    "corner-nw",
                    "corner-se",
                    "corner-sw",
                    "edge-east",
                    "edge-north",
                    "edge-south",
                    "edge-west")))
        .andExpect(jsonPath("$.totalCount").value(9));
  }

  @ParameterizedTest
  @ValueSource(strings = {"11110", "11140"})
  void viewportDistrictUsesPointGeometryWithNullOrMismatchedDongForeignKey(String code)
      throws Exception {
    boundaries();
    cafe("000010", "서쪽카페", 126.999, 37, CURRENT);
    cafe("000020", "동쪽카페", 127.001, 37, CURRENT);
    jdbc.sql(
            """
        UPDATE cafe_store SET source_dong_code='11140001',dong_code='11140001'
        WHERE bizes_id='000010'
        """)
        .update();
    // 경계 위 중심점은 NULL FK여도 양쪽 구에 속하고, 잘못 연결된 FK는 공간 판정에 쓰지 않는다.
    mvc.perform(viewport().param("districtCodes", code))
        .andExpect(status().isOk())
        .andExpect(
            jsonPath(
                "$.items[*].bizesId",
                contains("000001", code.equals("11110") ? "000010" : "000020")))
        .andExpect(jsonPath("$.totalCount").value(2));
  }

  @Test
  void viewportDistrictUnionDeduplicatesSharedBoundaryAndDoesNotExpandEnvelope() throws Exception {
    boundaries();
    cafe("000010", "서쪽카페", 126.999, 37, CURRENT);
    cafe("000020", "동쪽카페", 127.001, 37, CURRENT);
    cafe("000030", "영역밖같은구", 127.009, 37, CURRENT);
    mvc.perform(
            viewport("126.998", "36.999", "127.002", "37.001")
                .param("districtCodes", "11140", "11110", "11140"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "000010", "000020")))
        .andExpect(jsonPath("$.totalCount").value(3));
    mvc.perform(viewport().param("districtCodes", "00001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(0));
  }

  @ParameterizedTest
  @ValueSource(strings = {"99999", "11680"})
  void viewportValidatesAllCodesAgainstLatestBoundaryEvenOutsideEnvelope(String code)
      throws Exception {
    boundaries();
    mvc.perform(viewport("139", "35", "140", "36").param("districtCodes", "11110", code))
        .andExpect(status().isNotFound())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"missing", "unpublished", "latestEmpty"})
  void viewportRequiresPreparedBoundaryOnlyForDistrictFilters(String condition) throws Exception {
    if (!condition.equals("missing")) {
      boundaries();
      if (condition.equals("unpublished")) {
        jdbc.sql("UPDATE etl_batch SET status='SKIPPED' WHERE batch_id=:id")
            .param("id", BOUNDARY)
            .update();
      } else {
        jdbc.sql(
                """
            INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
              etl_version,status,published_at,started_at)
            VALUES ('00000000-0000-0000-0000-000000000099','SEOUL_DONG_BOUNDARY',
              'SHAPEFILE','SEOUL','synthetic fixture','test-v1','PUBLISHED',
              '2026-10-30T00:00:00Z','2026-10-30T00:00:00Z')
            """)
            .update();
      }
    }
    mvc.perform(viewport().param("districtCodes", "11110"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
    mvc.perform(viewport())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")));
  }

  @Test
  void viewportCountsBeforePagingAndRetainsCountBeyondLastPage() throws Exception {
    cafe("000002", "두번째카페", 127.001, 37, CURRENT);
    cafe("000003", "세번째카페", 127.002, 37, CURRENT);
    mvc.perform(viewport().param("limit", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")))
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.limit").value(1))
        .andExpect(jsonPath("$.offset").value(0))
        .andExpect(jsonPath("$.hasMore").value(true));
    mvc.perform(viewport().param("limit", "1").param("offset", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000002")))
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.offset").value(1))
        .andExpect(jsonPath("$.hasMore").value(true));
    mvc.perform(viewport().param("limit", "1").param("offset", "2"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000003")))
        .andExpect(jsonPath("$.hasMore").value(false));
    mvc.perform(viewport().param("limit", "500").param("offset", "100000"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.limit").value(500))
        .andExpect(jsonPath("$.offset").value(100000))
        .andExpect(jsonPath("$.hasMore").value(false));
  }

  @ParameterizedTest
  @ValueSource(strings = {"outside", "allNull"})
  void viewportEmptyResultStillReportsPreparedBatch(String condition) throws Exception {
    var request = viewport("139", "35", "140", "36");
    if (condition.equals("allNull")) {
      jdbc.sql("UPDATE cafe_store SET geom=NULL WHERE source_batch_id=:id")
          .param("id", CURRENT)
          .update();
      request = viewport();
    }
    mvc.perform(request)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(0))
        .andExpect(jsonPath("$.hasMore").value(false))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()));
  }

  @ParameterizedTest
  @ValueSource(strings = {"noPublication", "noActualRows", "emptyLatest"})
  void viewportRejectsUnpreparedCafePublicationWithoutFallback(String condition) throws Exception {
    if (condition.equals("noPublication")) {
      jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    } else if (condition.equals("noActualRows")) {
      jdbc.sql("DELETE FROM cafe_store WHERE source_batch_id=:id").param("id", CURRENT).update();
    } else {
      batch(new UUID(0, 99), "2026-10-30", "2026-10-30", FULL_SOURCE);
    }
    mvc.perform(viewport())
        .andExpect(status().isServiceUnavailable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @ParameterizedTest
  @MethodSource("unqualifiedPublications")
  void viewportSafelyIgnoresEveryNewerUnqualifiedPublication(String column, String value)
      throws Exception {
    var candidate = new UUID(0, 99);
    batch(candidate, "2026-10-30", "2026-10-30", FULL_SOURCE);
    if (column.equals("scope")) {
      jdbc.sql("UPDATE etl_batch SET scope_type='DISTRICT',scope_code='11110' WHERE batch_id=:id")
          .param("id", candidate)
          .update();
    } else {
      // 컬럼명은 기존 고정 인자 목록에서만 가져오며, 메타데이터 값은 바인딩한다.
      jdbc.sql("UPDATE etl_batch SET " + column + "=:value WHERE batch_id=:id")
          .param("value", value)
          .param("id", candidate)
          .update();
    }
    mvc.perform(viewport())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()));
  }

  @ParameterizedTest
  @MethodSource("invalidViewportParameters")
  void viewportRejectsInvalidParametersBeforeDataReadiness(String name, String[] values)
      throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    var request = get("/api/v1/cafes/viewport");
    if (!name.equals("west")) request.param("west", "126.9");
    if (!name.equals("south")) request.param("south", "36.9");
    if (!name.equals("east")) request.param("east", "127.1");
    if (!name.equals("north")) request.param("north", "37.1");
    if (values.length > 0) request.param(name, values);
    mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.status").value(400))
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  static Stream<Arguments> invalidViewportParameters() {
    var coordinates =
        Stream.of("west", "south", "east", "north")
            .flatMap(
                name -> {
                  // 중복을 제거하면 유효한 사각형이 되도록 각 좌표의 정상 값을 반복한다.
                  var repeated =
                      switch (name) {
                        case "west" -> "126.9";
                        case "south" -> "36.9";
                        case "east" -> "127.1";
                        default -> "37.1";
                      };
                  return Stream.concat(
                      Stream.of(
                          Arguments.of(name, new String[] {}),
                          Arguments.of(name, new String[] {repeated, repeated})),
                      Stream.of("", " ", "NaN", "Infinity", "-Infinity", "1e309", "abc", "127,37")
                          .map(value -> Arguments.of(name, new String[] {value})));
                });
    var bounds =
        Stream.of("west", "south", "east", "north")
            .flatMap(
                name -> {
                  var bound = name.equals("west") || name.equals("east") ? "180.0001" : "90.0001";
                  return Stream.of(
                      Arguments.of(name, new String[] {bound}),
                      Arguments.of(name, new String[] {"-" + bound}));
                });
    var inversions =
        Stream.of(
            Arguments.of("west", new String[] {"127.1"}),
            Arguments.of("west", new String[] {"127.2"}),
            Arguments.of("east", new String[] {"126.9"}),
            Arguments.of("east", new String[] {"126.8"}),
            Arguments.of("south", new String[] {"37.1"}),
            Arguments.of("south", new String[] {"37.2"}),
            Arguments.of("north", new String[] {"36.9"}),
            Arguments.of("north", new String[] {"36.8"}));
    var sharedPagingAndCodes =
        invalidParameters()
            .filter(
                arguments -> {
                  var name = arguments.get()[0];
                  return name.equals("limit")
                      || name.equals("offset")
                      || name.equals("districtCodes");
                });
    return Stream.of(coordinates, bounds, inversions, sharedPagingAndCodes)
        .flatMap(stream -> stream);
  }

  @Test
  void viewportAcceptsWorldBoundsAndRejectsAntimeridianWrapping() throws Exception {
    mvc.perform(viewport("-180", "-90", "180", "90"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")));
    mvc.perform(viewport("170", "-10", "-170", "10"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @ParameterizedTest
  @MethodSource("viewportPublicationPoints")
  void viewportKeepsItemsCountAndBatchInReadOnlyRepeatableReadSnapshot(
      String point, boolean filtered) throws Exception {
    if (filtered) boundaries();
    var published = new AtomicBoolean();
    org.mockito.stubbing.Answer<Object> publishAfterRead =
        invocation -> {
          var selected = invocation.callRealMethod();
          assertThat(jdbc.sql("SHOW transaction_read_only").query(String.class).single())
              .isEqualTo("on");
          assertThat(jdbc.sql("SHOW transaction_isolation").query(String.class).single())
              .isEqualTo("repeatable read");
          if (published.compareAndSet(false, true)) publishReplacement();
          return selected;
        };
    // 경계 필터가 있는 조회도 게시 선택·건수·목록이 같은 DB 스냅샷을 유지해야 한다.
    if (point.equals("batch")) {
      doAnswer(publishAfterRead).when(repository).findLatestPublishedBatch();
    } else {
      doAnswer(publishAfterRead)
          .when(repository)
          .countViewport(
              any(UUID.class),
              nullable(UUID.class),
              anyDouble(),
              anyDouble(),
              anyDouble(),
              anyDouble(),
              anyList());
    }
    var first = viewport();
    if (filtered) first.param("districtCodes", "11140");
    mvc.perform(first)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")))
        .andExpect(jsonPath("$.items[0].storeName").value("중심카페"))
        .andExpect(jsonPath("$.totalCount").value(1))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()))
        .andExpect(jsonPath("$.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
    assertThat(published).isTrue();
    var next = viewport();
    if (filtered) next.param("districtCodes", "11140");
    mvc.perform(next)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "000002")))
        .andExpect(jsonPath("$.items[0].storeName").value("새로운카페"))
        .andExpect(jsonPath("$.totalCount").value(2))
        .andExpect(jsonPath("$.sourceBatch.batchId").value("00000000-0000-0000-0000-000000000011"))
        .andExpect(jsonPath("$.sourceBatch.publishedAt").value("2026-10-21T00:00:00Z"));
  }

  static Stream<Arguments> viewportPublicationPoints() {
    return Stream.of(
        Arguments.of("batch", false), Arguments.of("count", false),
        Arguments.of("batch", true), Arguments.of("count", true));
  }

  @Test
  void viewportGeometryIndexIsUsableWithoutRequiringNaturalPlannerChoice() throws Exception {
    jdbc.sql(
            """
        INSERT INTO cafe_store(bizes_id,store_name,semas_industry_code,semas_industry_name,
          geom,source_batch_id)
        SELECT 'V'||n,'영역인덱스카페','I21201','카페',
          ST_SetSRID(ST_MakePoint(110+(n%200)*0.1,25+(n/200)*0.1),4326),:id
        FROM generate_series(1,40000) AS n
        """)
        .param("id", CURRENT)
        .update();
    jdbc.sql("ANALYZE cafe_store").update();
    var query =
        """
        EXPLAIN SELECT count(*) FROM cafe_store s
        CROSS JOIN (SELECT ST_MakeEnvelope(126.999,36.999,127.001,37.001,4326) AS geom) v
        WHERE s.source_batch_id=? AND s.geom IS NOT NULL
          AND s.geom && v.geom AND ST_Covers(v.geom,s.geom)
        """;
    // 자연 계획은 데이터 분포와 통계에 따라 달라지므로 유효한 계획인지만 확인한다.
    try (var connection = flyway.getConfiguration().getDataSource().getConnection();
        var statement = connection.prepareStatement(query)) {
      statement.setObject(1, CURRENT);
      try (var rows = statement.executeQuery()) {
        var naturalPlan = new StringBuilder();
        while (rows.next()) naturalPlan.append(rows.getString(1)).append('\n');
        assertThat(naturalPlan.toString()).contains("Aggregate", "cafe_store");
      }
      connection.setAutoCommit(false);
      try {
        // SET LOCAL은 이 트랜잭션에만 적용하여 풀 연결이나 다른 테스트의 설정을 바꾸지 않는다.
        try (var settings = connection.createStatement()) {
          settings.execute("SET LOCAL enable_seqscan=off");
          settings.execute("SET LOCAL enable_indexscan=on");
          settings.execute("SET LOCAL enable_bitmapscan=on");
        }
        try (var rows = statement.executeQuery()) {
          var indexPlan = new StringBuilder();
          while (rows.next()) indexPlan.append(rows.getString(1)).append('\n');
          assertThat(indexPlan.toString()).contains("cafe_store_geom_idx");
        }
      } finally {
        connection.rollback();
      }
    }
    mvc.perform(viewport("126.999", "36.999", "127.001", "37.001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "V24170")))
        .andExpect(jsonPath("$.totalCount").value(2));
  }

  @Test
  void findsPublishedCafeWithoutRequiringBoundaryData() throws Exception {
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(jsonPath("$.length()").value(6))
        .andExpect(jsonPath("$.items.length()").value(1))
        .andExpect(jsonPath("$.items[0].length()").value(10))
        .andExpect(jsonPath("$.items[0].bizesId").value("000001"))
        .andExpect(jsonPath("$.items[0].storeName").value("중심카페"))
        .andExpect(jsonPath("$.items[0].branchName").value(nullValue()))
        .andExpect(jsonPath("$.items[0].semasIndustryCode").value("I21201"))
        .andExpect(jsonPath("$.items[0].semasIndustryName").value("카페"))
        .andExpect(jsonPath("$.items[0].roadAddress").value(nullValue()))
        .andExpect(jsonPath("$.items[0].lotAddress").value(nullValue()))
        .andExpect(jsonPath("$.items[0].longitude").value(127.0))
        .andExpect(jsonPath("$.items[0].latitude").value(37.0))
        .andExpect(jsonPath("$.items[0].distanceM").value(0.0))
        .andExpect(jsonPath("$.totalCount").value(1))
        .andExpect(jsonPath("$.limit").value(100))
        .andExpect(jsonPath("$.offset").value(0))
        .andExpect(jsonPath("$.hasMore").value(false))
        .andExpect(jsonPath("$.sourceBatch.length()").value(2))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()))
        .andExpect(jsonPath("$.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
  }

  @Test
  void returnsOptionalTextWithoutExposingEtlOrRawSourceFields() throws Exception {
    jdbc.sql(
            """
        UPDATE cafe_store SET branch_name='서울점',road_address='서울시 예시로 1',
          lot_address='서울시 예시동 1',ksic_code='56221',ksic_name='음료점',
          source_dong_code='1234567890' WHERE bizes_id='000001'
        """)
        .update();
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].branchName").value("서울점"))
        .andExpect(jsonPath("$.items[0].roadAddress").value("서울시 예시로 1"))
        .andExpect(jsonPath("$.items[0].lotAddress").value("서울시 예시동 1"))
        .andExpect(jsonPath("$.items[0].length()").value(10))
        .andExpect(jsonPath("$.sourceReference").doesNotExist())
        .andExpect(jsonPath("$.items[0].sourceBatchId").doesNotExist())
        .andExpect(jsonPath("$.items[0].sourceDongCode").doesNotExist())
        .andExpect(jsonPath("$.items[0].ksicCode").doesNotExist());
  }

  @Test
  void usesMetersDefaultRadiusAndExactDistanceOrdering() throws Exception {
    cafe("000002", "가까운카페", 127.001, 37, CURRENT);
    cafe("000003", "대각선바깥카페", 127.005, 37.004, CURRENT);
    cafe("000004", "오백미터밖카페", 127.006, 37, CURRENT);
    // 대각선 점은 반경의 좌표 사각형 안에 있지만 실제 500m 원 밖에 있다.
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "000002")))
        .andExpect(jsonPath("$.totalCount").value(2));
    mvc.perform(nearby().param("radiusM", "1000"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "000002", "000004", "000003")))
        .andExpect(jsonPath("$.totalCount").value(4));
    var distance =
        jdbc.sql(
                """
            SELECT ST_Distance(geom::geography,
              ST_SetSRID(ST_MakePoint(127,37),4326)::geography)
            FROM cafe_store WHERE bizes_id='000002'
            """)
            .query(Double.class)
            .single();
    assertThat(distance).isBetween(88.0, 90.0);
    mvc.perform(nearby()).andExpect(jsonPath("$.items[1].distanceM").value(distance));
  }

  @Test
  void includesExactMeterRadiusContactAndExcludesJustOutside() throws Exception {
    // 경도 0.002도는 0.002m가 아니다. DB가 계산한 실제 미터 값을 경계 반경으로 쓴다.
    cafe("000002", "경계카페", 0.002, 0, CURRENT);
    var distance =
        jdbc.sql(
                """
            SELECT ST_Distance(geom::geography,
              ST_SetSRID(ST_MakePoint(0,0),4326)::geography)
            FROM cafe_store WHERE bizes_id='000002'
            """)
            .query(Double.class)
            .single();
    assertThat(distance).isBetween(222.0, 224.0);
    mvc.perform(nearby("0", "0").param("radiusM", distance.toString()))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000002")))
        .andExpect(jsonPath("$.items[0].distanceM").value(distance));
    mvc.perform(nearby("0", "0").param("radiusM", Double.toString(distance - 0.001)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(0));
  }

  @Test
  void breaksEqualDistanceTiesByLiteralBusinessIdentifier() throws Exception {
    cafe("2", "두번째", 127, 37, CURRENT);
    cafe("10", "열번째", 127, 37, CURRENT);
    mvc.perform(nearby().param("radiusM", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "10", "2")));
  }

  @Test
  void countsBeforePagingAndKeepsCountWhenOffsetExceedsResults() throws Exception {
    cafe("000002", "두번째카페", 127.001, 37, CURRENT);
    cafe("000003", "세번째카페", 127.002, 37, CURRENT);
    mvc.perform(nearby().param("limit", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")))
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.limit").value(1))
        .andExpect(jsonPath("$.offset").value(0))
        .andExpect(jsonPath("$.hasMore").value(true));
    mvc.perform(nearby().param("limit", "1").param("offset", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000002")))
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.offset").value(1))
        .andExpect(jsonPath("$.hasMore").value(true));
    mvc.perform(nearby().param("limit", "1").param("offset", "2"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000003")))
        .andExpect(jsonPath("$.hasMore").value(false));
    mvc.perform(nearby().param("limit", "500").param("offset", "100000"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.limit").value(500))
        .andExpect(jsonPath("$.offset").value(100000))
        .andExpect(jsonPath("$.hasMore").value(false));
  }

  @Test
  void returnsNormalEmptyResultAndReadyBatchForOutOfAreaSearch() throws Exception {
    mvc.perform(nearby("139.7", "35.7"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(0))
        .andExpect(jsonPath("$.hasMore").value(false))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()));
  }

  @Test
  void ignoresNullGeometryWithoutTreatingPreparedBatchAsMissing() throws Exception {
    jdbc.sql("UPDATE cafe_store SET geom=NULL WHERE source_batch_id=:batch")
        .param("batch", CURRENT)
        .update();
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(0))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()));
    cafe("000002", "좌표있는카페", 127, 37, CURRENT);
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000002")))
        .andExpect(jsonPath("$.totalCount").value(1));
  }

  @ParameterizedTest
  @ValueSource(strings = {"11110", "11140"})
  void districtFiltersUseGeometryIncludingSharedBoundaryInsteadOfDongForeignKey(String code)
      throws Exception {
    boundaries();
    cafe("000010", "서쪽카페", 126.999, 37, CURRENT);
    cafe("000020", "동쪽카페", 127.001, 37, CURRENT);
    // 중심 업소는 동 FK가 없고, 서쪽 업소의 FK는 동쪽 구에 연결되어 있다.
    jdbc.sql(
            """
        UPDATE cafe_store SET source_dong_code='11140001',dong_code='11140001'
        WHERE bizes_id='000010'
        """)
        .update();
    var expected = code.equals("11110") ? "000010" : "000020";
    mvc.perform(nearby().param("districtCodes", code))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", expected)))
        .andExpect(jsonPath("$.totalCount").value(2));
  }

  @Test
  void repeatedDistrictsFormSpatialUnionWithoutDuplicatesOrRadiusExpansion() throws Exception {
    boundaries();
    cafe("000010", "서쪽카페", 126.999, 37, CURRENT);
    cafe("000020", "동쪽카페", 127.001, 37, CURRENT);
    cafe("000030", "같은구먼카페", 127.009, 37, CURRENT);
    mvc.perform(nearby().param("districtCodes", "11140", "11110", "11140"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items.length()").value(3))
        .andExpect(jsonPath("$.items[*].bizesId", containsInAnyOrder("000001", "000010", "000020")))
        .andExpect(jsonPath("$.totalCount").value(3))
        .andExpect(jsonPath("$.items[0].bizesId").value("000001"));
    mvc.perform(nearby().param("districtCodes", "00001"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty())
        .andExpect(jsonPath("$.totalCount").value(0));
  }

  @ParameterizedTest
  @ValueSource(strings = {"99999", "11680"})
  void validatesEverySelectedDistrictAgainstLatestBoundaryEvenOutsideRadius(String code)
      throws Exception {
    boundaries();
    mvc.perform(nearby("139.7", "35.7").param("districtCodes", "11110", code))
        .andExpect(status().isNotFound())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"missing", "unpublished", "latestEmpty"})
  void requiresPreparedBoundaryOnlyWhenDistrictFilterIsPresent(String condition) throws Exception {
    if (!condition.equals("missing")) {
      boundaries();
      if (condition.equals("unpublished")) {
        jdbc.sql("UPDATE etl_batch SET status='SKIPPED' WHERE batch_id=:id")
            .param("id", BOUNDARY)
            .update();
      } else {
        jdbc.sql(
                """
            INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
              etl_version,status,published_at,started_at)
            VALUES ('00000000-0000-0000-0000-000000000099','SEOUL_DONG_BOUNDARY',
              'SHAPEFILE','SEOUL','synthetic fixture','test-v1','PUBLISHED',
              '2026-10-30T00:00:00Z','2026-10-30T00:00:00Z')
            """)
            .update();
      }
    }
    mvc.perform(nearby().param("districtCodes", "11110"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")));
  }

  @ParameterizedTest
  @MethodSource("unqualifiedPublications")
  void safelyIgnoresNewerUnqualifiedPublications(String column, String value) throws Exception {
    var candidate = new UUID(0, 99);
    batch(candidate, "2026-10-30", "2026-10-30", FULL_SOURCE);
    if (column.equals("scope")) {
      jdbc.sql("UPDATE etl_batch SET scope_type='DISTRICT',scope_code='11110' WHERE batch_id=:id")
          .param("id", candidate)
          .update();
    } else {
      // 컬럼명은 아래 테스트 인자에만 존재하는 고정 식별자이며 값은 모두 바인딩한다.
      jdbc.sql("UPDATE etl_batch SET " + column + "=:value WHERE batch_id=:id")
          .param("value", value)
          .param("id", candidate)
          .update();
    }
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()));
  }

  static Stream<Arguments> unqualifiedPublications() {
    return Stream.of(
        Arguments.of("dataset_code", "OTHER_CAFE"),
        Arguments.of("source_type", "CSV"),
        Arguments.of("scope", "DISTRICT"),
        Arguments.of("status", "SKIPPED"),
        Arguments.of("status", "FAILED"),
        Arguments.of("status", "RUNNING"),
        Arguments.of("published_at", null),
        Arguments.of("source_reference", "not json"),
        Arguments.of("source_reference", "{broken}"),
        Arguments.of("source_reference", "null"),
        Arguments.of("source_reference", "[]"),
        Arguments.of("source_reference", "{}"),
        Arguments.of(
            "source_reference",
            "{\"collection_mode\":\"PROBE\",\"complete\":true,\"classification_verified\":true}"),
        Arguments.of(
            "source_reference",
            "{\"collection_mode\":\"FULL_SEOUL\",\"complete\":false,\"classification_verified\":true}"),
        Arguments.of(
            "source_reference",
            "{\"collection_mode\":\"FULL_SEOUL\",\"complete\":true,\"classification_verified\":false}"),
        Arguments.of(
            "source_reference",
            "{\"collection_mode\":\"FULL_SEOUL\",\"complete\":\"true\",\"classification_verified\":true}"),
        Arguments.of("source_reference", "{\"collection_mode\":\"FULL_SEOUL\",\"complete\":true}"),
        // JSON 문법은 맞아도 jsonb가 거부하는 Unicode와 NUMERIC 범위 초과를 포함한다.
        Arguments.of("source_reference", FULL_SOURCE.replace("}", ",\"bad\":\"\\u0000\"}")),
        Arguments.of("source_reference", FULL_SOURCE.replace("}", ",\"bad\":\"\\ud800\"}")),
        Arguments.of("source_reference", FULL_SOURCE.replace("}", ",\"bad\":1e1000000}")));
  }

  @ParameterizedTest
  @ValueSource(strings = {"noPublication", "noActualRows", "emptyLatest"})
  void rejectsUnpreparedLatestCafeBatchWithoutFallingBack(String condition) throws Exception {
    if (condition.equals("noPublication")) {
      jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    } else if (condition.equals("noActualRows")) {
      jdbc.sql("DELETE FROM cafe_store WHERE source_batch_id=:id").param("id", CURRENT).update();
    } else {
      batch(new UUID(0, 99), "2026-10-30", "2026-10-30", FULL_SOURCE);
    }
    mvc.perform(nearby())
        .andExpect(status().isServiceUnavailable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void selectsLatestPublicationThenStartedAtThenBatchIdentifier() throws Exception {
    var laterStart = new UUID(0, 10);
    batch(laterStart, "2026-10-02", "2026-10-03", FULL_SOURCE);
    cafe("000010", "나중시작카페", 127, 37, laterStart);
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000010")))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(laterStart.toString()));
    var laterId = new UUID(0, 11);
    batch(laterId, "2026-10-02", "2026-10-03", FULL_SOURCE);
    cafe("000011", "나중식별자카페", 127, 37, laterId);
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000011")))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(laterId.toString()));
  }

  @ParameterizedTest
  @MethodSource("invalidParameters")
  void rejectsInvalidParametersAsProblemDetailBeforeDataReadiness(String name, String[] values)
      throws Exception {
    jdbc.sql("UPDATE etl_batch SET status='SKIPPED'").update();
    var request = get("/api/v1/cafes/nearby");
    if (!name.equals("longitude")) request.param("longitude", "127");
    if (!name.equals("latitude")) request.param("latitude", "37");
    if (values.length > 0) request.param(name, values);
    mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.status").value(400))
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  static Stream<Arguments> invalidParameters() {
    var coordinates =
        Stream.of("longitude", "latitude")
            .flatMap(
                name ->
                    Stream.concat(
                        Stream.of(
                            Arguments.of(name, new String[] {}),
                            Arguments.of(name, new String[] {"37", "37"})),
                        Stream.of("", " ", "NaN", "Infinity", "-Infinity", "1e309", "abc", "127,37")
                            .map(value -> Arguments.of(name, new String[] {value}))));
    var bounds =
        Stream.of(
            Arguments.of("longitude", new String[] {"180.0001"}),
            Arguments.of("longitude", new String[] {"-180.0001"}),
            Arguments.of("latitude", new String[] {"90.0001"}),
            Arguments.of("latitude", new String[] {"-90.0001"}));
    var radius =
        Stream.concat(
            Stream.of("", " ", "0", "0.9", "-1", "1000.01", "NaN", "Infinity", "1e309", "abc")
                .map(value -> Arguments.of("radiusM", new String[] {value})),
            Stream.of(Arguments.of("radiusM", new String[] {"500", "500"})));
    var paging =
        Stream.of("limit", "offset")
            .flatMap(
                name ->
                    Stream.concat(
                        Stream.of("", " ", "-1", "+1", "1.0", "1e2", "１", "١", "2147483648", "1,2")
                            .map(value -> Arguments.of(name, new String[] {value})),
                        Stream.of(Arguments.of(name, new String[] {"1", "1"}))));
    var pagingBounds =
        Stream.of(
            Arguments.of("limit", new String[] {"0"}),
            Arguments.of("limit", new String[] {"501"}),
            Arguments.of("offset", new String[] {"100001"}));
    var codes =
        Stream.concat(
            Stream.of("", " ", "1111", "111111", "1111A", "１１１１０", "١١١١٠", "11110,11140")
                .map(value -> Arguments.of("districtCodes", new String[] {value})),
            Stream.of(Arguments.of("districtCodes", new String[] {"11110", ""})));
    return Stream.of(coordinates, bounds, radius, paging, pagingBounds, codes)
        .flatMap(stream -> stream);
  }

  @ParameterizedTest
  @ValueSource(strings = {"-180,-90", "180,90", "0,0"})
  void acceptsWgs84CoordinateBounds(String coordinates) throws Exception {
    var pair = coordinates.split(",");
    mvc.perform(nearby(pair[0], pair[1]).param("radiusM", "1.5"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty());
  }

  @ParameterizedTest
  @ValueSource(strings = {"batch", "count"})
  void keepsItemsCountAndBatchInSingleReadOnlySnapshotDuringPublication(String point)
      throws Exception {
    var published = new AtomicBoolean();
    org.mockito.stubbing.Answer<Object> publishAfterRead =
        invocation -> {
          var selected = invocation.callRealMethod();
          assertThat(jdbc.sql("SHOW transaction_read_only").query(String.class).single())
              .isEqualTo("on");
          assertThat(jdbc.sql("SHOW transaction_isolation").query(String.class).single())
              .isEqualTo("repeatable read");
          if (published.compareAndSet(false, true)) publishReplacement();
          return selected;
        };
    // 첫 게시 선택과 전체 건수 조회 직후에 각각 별도 연결의 원자적 게시를 끼워 넣는다.
    if (point.equals("batch")) {
      doAnswer(publishAfterRead).when(repository).findLatestPublishedBatch();
    } else {
      doAnswer(publishAfterRead)
          .when(repository)
          .countNearby(
              any(UUID.class),
              nullable(UUID.class),
              anyDouble(),
              anyDouble(),
              anyDouble(),
              anyList());
    }
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001")))
        .andExpect(jsonPath("$.items[0].storeName").value("중심카페"))
        .andExpect(jsonPath("$.totalCount").value(1))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(CURRENT.toString()))
        .andExpect(jsonPath("$.sourceBatch.publishedAt").value("2026-10-02T00:00:00Z"));
    assertThat(published).isTrue();
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "000002")))
        .andExpect(jsonPath("$.items[0].storeName").value("새로운카페"))
        .andExpect(jsonPath("$.totalCount").value(2))
        .andExpect(jsonPath("$.sourceBatch.batchId").value("00000000-0000-0000-0000-000000000011"))
        .andExpect(jsonPath("$.sourceBatch.publishedAt").value("2026-10-21T00:00:00Z"));
  }

  @Test
  void normalPlannerUsesGeographyIndexForSelectiveMeterSearch() throws Exception {
    // 작은 fixture에서는 순차 조회가 합리적이므로 공간적으로 넓게 분포한 합성 행을 충분히 둔다.
    jdbc.sql(
            """
        INSERT INTO cafe_store(bizes_id,store_name,semas_industry_code,semas_industry_name,
          geom,source_batch_id)
        SELECT 'G'||n,'공간인덱스카페','I21201','카페',
          ST_SetSRID(ST_MakePoint(110+(n%200)*0.1,25+(n/200)*0.1),4326),:id
        FROM generate_series(1,40000) AS n
        """)
        .param("id", CURRENT)
        .update();
    jdbc.sql("ANALYZE cafe_store").update();
    var plan =
        jdbc.sql(
                """
            EXPLAIN SELECT bizes_id FROM cafe_store
            WHERE source_batch_id=:id AND geom IS NOT NULL
              AND ST_DWithin(geom::geography,
                ST_SetSRID(ST_MakePoint(127,37),4326)::geography,500)
            ORDER BY ST_Distance(geom::geography,
              ST_SetSRID(ST_MakePoint(127,37),4326)::geography),bizes_id LIMIT 100
            """)
            .param("id", CURRENT)
            .query(String.class)
            .list();
    assertThat(String.join("\n", plan)).contains("cafe_store_geography_idx");
    // enable_seqscan이나 비용 설정을 변경하지 않은 실제 실행 계획과 HTTP 결과를 함께 확인한다.
    mvc.perform(nearby())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[*].bizesId", contains("000001", "G24170")))
        .andExpect(jsonPath("$.totalCount").value(2));
  }

  private MockHttpServletRequestBuilder viewport() {
    return viewport("126.9", "36.9", "127.1", "37.1");
  }

  private MockHttpServletRequestBuilder viewport(
      String west, String south, String east, String north) {
    return get("/api/v1/cafes/viewport")
        .param("west", west)
        .param("south", south)
        .param("east", east)
        .param("north", north);
  }

  private MockHttpServletRequestBuilder nearby() {
    return nearby("127", "37");
  }

  private MockHttpServletRequestBuilder nearby(String longitude, String latitude) {
    return get("/api/v1/cafes/nearby").param("longitude", longitude).param("latitude", latitude);
  }

  private void batch(UUID id, String published, String started, String source) {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
          etl_version,status,published_at,started_at)
        VALUES (:id,'SEMAS_CAFE_STORE','API','SEOUL',:source,'test-v1','PUBLISHED',
          CAST(:published AS timestamptz),CAST(:started AS timestamptz))
        """)
        .param("id", id)
        .param("source", source)
        .param("published", published + "T00:00:00Z")
        .param("started", started + "T00:00:00Z")
        .update();
  }

  private void cafe(String id, String name, double longitude, double latitude, UUID batch) {
    jdbc.sql(
            """
        INSERT INTO cafe_store(bizes_id,store_name,semas_industry_code,semas_industry_name,
          geom,source_batch_id)
        VALUES (:id,:name,'I21201','카페',ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326),:batch)
        """)
        .param("id", id)
        .param("name", name)
        .param("longitude", longitude)
        .param("latitude", latitude)
        .param("batch", batch)
        .update();
  }

  private void boundaries() {
    jdbc.sql(
            """
        INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
          etl_version,status,published_at,started_at)
        VALUES (:id,'SEOUL_DONG_BOUNDARY','SHAPEFILE','SEOUL','synthetic fixture','test-v1',
          'PUBLISHED','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')
        """)
        .param("id", BOUNDARY)
        .update();
    jdbc.sql(
            """
        INSERT INTO district VALUES
          ('11110','서쪽구',ST_Multi(ST_MakeEnvelope(126.99,36.99,127,37.01,4326)),:id),
          ('11140','동쪽구',ST_Multi(ST_MakeEnvelope(127,36.99,127.01,37.01,4326)),:id),
          ('00001','먼구',ST_Multi(ST_MakeEnvelope(129,37,129.01,37.01,4326)),:id),
          ('11680','과거구',ST_Multi(ST_MakeEnvelope(126.99,36.99,127.01,37.01,4326)),:old)
        """)
        .param("id", BOUNDARY)
        .param("old", OLD)
        .update();
    jdbc.sql(
            """
        INSERT INTO administrative_dong VALUES ('11140001','11140','동쪽동',
          ST_Multi(ST_MakeEnvelope(127,36.99,127.01,37.01,4326)),
          ST_SetSRID(ST_MakePoint(127.005,37),4326),1000,:id)
        """)
        .param("id", BOUNDARY)
        .update();
  }

  /** 별도 연결에서 기존 업소 갱신·새 업소 추가·게시 상태 변경을 한 번에 확정한다. */
  private void publishReplacement() throws Exception {
    try (var connection = flyway.getConfiguration().getDataSource().getConnection();
        var statement = connection.createStatement()) {
      connection.setAutoCommit(false);
      statement.executeUpdate(
          """
          INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,source_reference,
            etl_version,status,published_at,started_at)
          VALUES ('00000000-0000-0000-0000-000000000011','SEMAS_CAFE_STORE','API','SEOUL',
            '{"collection_mode":"FULL_SEOUL","complete":true,"classification_verified":true}',
            'test-v1','RUNNING',NULL,'2026-10-21T00:00:00Z')
          """);
      statement.executeUpdate(
          """
          UPDATE cafe_store SET store_name='새로운카페',
            source_batch_id='00000000-0000-0000-0000-000000000011' WHERE bizes_id='000001'
          """);
      statement.executeUpdate(
          """
          INSERT INTO cafe_store(bizes_id,store_name,semas_industry_code,semas_industry_name,
            geom,source_batch_id) VALUES ('000002','새로추가카페','I21201','카페',
            ST_SetSRID(ST_MakePoint(127.001,37),4326),'00000000-0000-0000-0000-000000000011')
          """);
      statement.executeUpdate(
          """
          UPDATE etl_batch SET status='PUBLISHED',published_at='2026-10-21T00:00:00Z'
          WHERE batch_id='00000000-0000-0000-0000-000000000011'
          """);
      connection.commit();
    }
  }
}
