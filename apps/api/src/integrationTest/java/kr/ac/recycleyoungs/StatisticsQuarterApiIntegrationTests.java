package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.DriverManager;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import kr.ac.recycleyoungs.store.DistrictStoreStatRepository;
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
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("db")
@Testcontainers
class StatisticsQuarterApiIntegrationTests {

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

  private static final String PATH = "/api/v1/statistics/quarters";
  private static final UUID BOUNDARY = new UUID(0, 1);
  private static final UUID OLD_BOUNDARY = new UUID(0, 2);
  private static final UUID DISTRICT_STORES = new UUID(0, 3);
  private static final UUID DISTRICT_SALES = new UUID(0, 4);
  private static final UUID DISTRICT_FOOT = new UUID(0, 5);
  private static final UUID DONG_STORES = new UUID(0, 6);
  private static final UUID DONG_SALES = new UUID(0, 7);
  private static final UUID DONG_FOOT = new UUID(0, 8);
  private static final UUID OLD_STORES = new UUID(0, 9);
  private static final UUID RUNNING_STORES = new UUID(0, 10);
  private static final UUID EMPTY_STORES = new UUID(0, 11);

  @Autowired private JdbcClient jdbc;
  @Autowired private MockMvc mvc;
  @MockitoSpyBean private DistrictStoreStatRepository districtStores;

  @BeforeEach
  void prepareIsolatedDatabase() {
    // 이 클래스의 일회용 컨테이너에 있는 fixture만 지운다.
    jdbc.sql("TRUNCATE etl_batch CASCADE").update();
  }

  @Test
  void choosesLatestCompleteQuarterAndKeepsEligiblePartialAndHistoricalRows() throws Exception {
    boundaries();
    statBatches();
    completeQuarter("20262");
    completeQuarter("20254");
    row("district_store_stat", "district_code", "00110", "CS100010", "20263", DISTRICT_STORES);
    row("district_store_stat", "district_code", "00110", "CS100010", "20251", OLD_STORES);
    row("district_store_stat", "district_code", "00220", "CS100010", "20251", DISTRICT_STORES);

    row("district_store_stat", "district_code", "00110", "CS100010", "20264", RUNNING_STORES);
    row("district_store_stat", "district_code", "00110", "CS100011", "20271", DISTRICT_STORES);
    row("district_sales_stat", "district_code", "00330", "CS100010", "20272", DISTRICT_SALES);
    row("dong_foot_traffic_stat", "dong_code", "00330001", null, "20273", DONG_FOOT);
    row("district_store_stat", "district_code", "00110", "CS100010", "20274", DISTRICT_SALES);
    row("dong_foot_traffic_stat", "dong_code", "00110002", null, "20281", DONG_FOOT);

    mvc.perform(get(PATH))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.industryCode").value("CS100010"))
        .andExpect(jsonPath("$.defaultQuarterCode").value("20262"))
        .andExpect(
            jsonPath("$.quarters[*].quarterCode")
                .value(contains("20263", "20262", "20254", "20251")))
        .andExpect(jsonPath("$.quarters[0].districtMetrics").value(contains("stores")))
        .andExpect(jsonPath("$.quarters[0].dongMetrics").isEmpty())
        .andExpect(
            jsonPath("$.quarters[1].districtMetrics")
                .value(contains("stores", "sales", "foot-traffic")))
        .andExpect(
            jsonPath("$.quarters[1].dongMetrics")
                .value(contains("stores", "sales", "foot-traffic")))
        .andExpect(jsonPath("$.quarters[3].districtMetrics").value(contains("stores")));
  }

  @Test
  void choosesNewestPartialQuarterWhenNoQuarterHasAllSixMetrics() throws Exception {
    boundaries();
    statBatches();
    row("district_store_stat", "district_code", "00110", "CS100010", "20262", DISTRICT_STORES);
    row("dong_foot_traffic_stat", "dong_code", "00110001", null, "20263", DONG_FOOT);
    mvc.perform(get(PATH))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultQuarterCode").value("20263"))
        .andExpect(jsonPath("$.quarters[0].dongMetrics").value(contains("foot-traffic")));
  }

  @Test
  void returnsEmptyListWhenBoundaryIsReadyButNoEligibleRowsExist() throws Exception {
    boundaries();
    statBatches();
    row("district_store_stat", "district_code", "00110", "CS100010", "20262", RUNNING_STORES);
    mvc.perform(get(PATH))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.defaultQuarterCode").value(nullValue()))
        .andExpect(jsonPath("$.quarters").isEmpty());
  }

  @Test
  void reportsNotReadyWithoutCurrentBoundaryRows() throws Exception {
    boundaries();
    batch(new UUID(0, 20), "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "PUBLISHED", "2026-10-20");
    mvc.perform(get(PATH))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @Test
  void seesPublicationOnlyOnNextRequestAndUsesReadOnlyRepeatableRead() throws Exception {
    boundaries();
    statBatches();
    completeQuarter("20262");
    var committed = new AtomicBoolean();
    doAnswer(
            invocation -> {
              var quarters = invocation.callRealMethod();
              assertThat(jdbc.sql("SHOW transaction_read_only").query(String.class).single())
                  .isEqualTo("on");
              assertThat(jdbc.sql("SHOW transaction_isolation").query(String.class).single())
                  .isEqualTo("repeatable read");
              if (committed.compareAndSet(false, true)) {
                try (var connection =
                        DriverManager.getConnection(
                            POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
                    var insert =
                        connection.prepareStatement(
                            """
                        INSERT INTO dong_sales_stat(dong_code,industry_code,quarter_code,source_batch_id)
                        VALUES ('00110001','CS100010','20264',?)
                        """)) {
                  insert.setObject(1, DONG_SALES);
                  insert.executeUpdate();
                }
              }
              return quarters;
            })
        .when(districtStores)
        .findPublishedQuarters(BOUNDARY, "CS100010");
    mvc.perform(get(PATH))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.quarters.length()").value(1))
        .andExpect(jsonPath("$.quarters[0].quarterCode").value("20262"));
    assertThat(committed.get()).isTrue();
    mvc.perform(get(PATH))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.quarters[0].quarterCode").value("20264"))
        .andExpect(jsonPath("$.defaultQuarterCode").value("20262"));
  }

  private void boundaries() {
    batch(BOUNDARY, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "PUBLISHED", "2026-10-01");
    batch(OLD_BOUNDARY, "SEOUL_DONG_BOUNDARY", "SHAPEFILE", "PUBLISHED", "2026-09-01");
    jdbc.sql(
            """
            INSERT INTO district
            SELECT code, code, ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)), batch
            FROM (VALUES ('00110',:latest),('00220',:latest),('00330',:old)) AS rows(code,batch)
            """)
        .param("latest", BOUNDARY)
        .param("old", OLD_BOUNDARY)
        .update();
    jdbc.sql(
            """
            INSERT INTO administrative_dong
            SELECT code, LEFT(code,5), code, ST_Multi(ST_MakeEnvelope(127,37,127.01,37.01,4326)),
              ST_SetSRID(ST_MakePoint(127.005,37.005),4326), 1000, batch
            FROM (VALUES ('00110001',:latest),('00110002',:old),('00330001',:latest)) AS rows(code,batch)
            """)
        .param("latest", BOUNDARY)
        .param("old", OLD_BOUNDARY)
        .update();
  }

  private void statBatches() {
    batch(DISTRICT_STORES, "SEOUL_DISTRICT_STORE_STAT", "CSV", "PUBLISHED", "2026-10-02");
    batch(DISTRICT_SALES, "SEOUL_DISTRICT_SALES_STAT", "CSV", "PUBLISHED", "2026-10-02");
    batch(DISTRICT_FOOT, "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT", "CSV", "PUBLISHED", "2026-10-02");
    batch(DONG_STORES, "SEOUL_DONG_STORE_STAT", "API", "PUBLISHED", "2026-10-02");
    batch(DONG_SALES, "SEOUL_DONG_SALES_STAT", "API", "PUBLISHED", "2026-10-02");
    batch(DONG_FOOT, "SEOUL_DONG_FOOT_TRAFFIC_STAT", "API", "PUBLISHED", "2026-10-02");
    batch(OLD_STORES, "SEOUL_DISTRICT_STORE_STAT", "CSV", "PUBLISHED", "2026-09-02");
    batch(RUNNING_STORES, "SEOUL_DISTRICT_STORE_STAT", "CSV", "RUNNING", null);
    batch(EMPTY_STORES, "SEOUL_DISTRICT_STORE_STAT", "CSV", "PUBLISHED", "2026-10-03");
    jdbc.sql(
            "INSERT INTO service_industry VALUES ('CS100010','카페',:batch),('CS100011','기타',:batch)")
        .param("batch", DISTRICT_STORES)
        .update();
  }

  private void completeQuarter(String quarter) {
    row("district_store_stat", "district_code", "00110", "CS100010", quarter, DISTRICT_STORES);
    row("district_sales_stat", "district_code", "00110", "CS100010", quarter, DISTRICT_SALES);
    row("district_foot_traffic_stat", "district_code", "00110", null, quarter, DISTRICT_FOOT);
    row("dong_store_stat", "dong_code", "00110001", "CS100010", quarter, DONG_STORES);
    row("dong_sales_stat", "dong_code", "00110001", "CS100010", quarter, DONG_SALES);
    row("dong_foot_traffic_stat", "dong_code", "00110001", null, quarter, DONG_FOOT);
  }

  private void row(
      String table,
      String regionColumn,
      String region,
      String industry,
      String quarter,
      UUID batch) {
    var insert =
        jdbc.sql(
                "INSERT INTO "
                    + table
                    + "("
                    + regionColumn
                    + ",quarter_code,source_batch_id"
                    + (industry == null
                        ? ") VALUES (:region,:quarter,:batch)"
                        : ",industry_code) VALUES (:region,:quarter,:batch,:industry)"))
            .param("region", region)
            .param("quarter", quarter)
            .param("batch", batch);
    if (industry != null) insert.param("industry", industry);
    insert.update();
  }

  private void batch(UUID id, String dataset, String source, String state, String published) {
    jdbc.sql(
            """
            INSERT INTO etl_batch(batch_id,dataset_code,source_type,scope_type,period_from,period_to,
              source_reference,etl_version,status,published_at,started_at)
            VALUES (:id,:dataset,:source,'SEOUL','20991','20994',
              'synthetic fixture','test-v1',:state,CAST(:published AS timestamptz), now())
            """)
        .param("id", id)
        .param("dataset", dataset)
        .param("source", source)
        .param("state", state)
        .param("published", published)
        .update();
  }
}
