package kr.ac.recycleyoungs;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** 일회용 PostGIS DB에서 Flyway 적용과 스키마의 데이터 무결성 제약을 검증한다. */
@SpringBootTest
@ActiveProfiles("db")
@Testcontainers
class PostgisMigrationIntegrationTests {

  @Container
  // Docker의 별도 컨테이너를 사용하므로 Compose 개발 DB와 그 데이터를 변경하지 않는다.
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
    // 서비스 연결도 컨테이너로 고정해 db 프로필이 개발 DB에 접근하지 않도록 한다.
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.flyway.url", POSTGRES::getJdbcUrl);
    registry.add("spring.flyway.user", POSTGRES::getUsername);
    registry.add("spring.flyway.password", POSTGRES::getPassword);
  }

  @Autowired private Flyway flyway;

  private static final String BATCH_ID = "00000000-0000-0000-0000-000000000001";
  private static final String MISSING_BATCH_ID = "00000000-0000-0000-0000-000000000002";
  private static final String BOUNDARY =
      "ST_GeomFromText('MULTIPOLYGON(((127 37,127.01 37,127.01 37.01,127 37.01,127 37)))',4326)";

  private Connection connection;

  @BeforeEach
  void openTransaction() throws Exception {
    // 일반 데이터 검증은 테스트별 트랜잭션으로 격리하고 종료 시 되돌린다.
    connection = flyway.getConfiguration().getDataSource().getConnection();
    connection.setAutoCommit(false);
  }

  @AfterEach
  void rollbackTransaction() throws Exception {
    try {
      connection.rollback();
    } finally {
      connection.close();
    }
  }

  @Test
  void appliesMigrationAndEnablesPostgisSpatialQueries() throws Exception {
    // 버전 적용 여부뿐 아니라 실제 공간 질의와 재실행 시 중복 적용 방지도 확인한다.
    assertThat(flyway.info().applied())
        .extracting(migration -> migration.getVersion().getVersion())
        .containsExactly("1", "2", "3", "4", "5");
    assertThat(flyway.info().pending()).isEmpty();
    try (var connection = flyway.getConfiguration().getDataSource().getConnection();
        var statement = connection.createStatement();
        var results =
            statement.executeQuery(
                "SELECT ST_DWithin(ST_SetSRID(ST_MakePoint(127.0, 37.5), 4326)::geography, "
                    + "ST_SetSRID(ST_MakePoint(127.0, 37.5001), 4326)::geography, 100)")) {
      assertThat(results.next()).isTrue();
      assertThat(results.getBoolean(1)).isTrue();
    }
    assertThat(flyway.migrate().migrationsExecuted).isZero();
  }

  @Test
  void upgradesThroughV2V3AndV4WithoutChangingExistingData() throws Exception {
    // 전용 스키마에서 V1 → V2 → V3 → V4 경로의 체크섬과 기존 데이터를 확인한다.
    var v1 =
        Flyway.configure()
            .configuration(flyway.getConfiguration())
            .schemas("v1_upgrade")
            .defaultSchema("v1_upgrade")
            .target("1")
            .load();
    assertThat(v1.migrate().migrationsExecuted).isEqualTo(1);
    assertThat(v1.info().current().getVersion().getVersion()).isEqualTo("1");
    var v1Checksum = v1.info().current().getChecksum();

    var v2 = Flyway.configure().configuration(v1.getConfiguration()).target("2").load();
    assertThat(v2.migrate().migrationsExecuted).isEqualTo(1);
    var appliedMigrations =
        Arrays.stream(v2.info().applied())
            // 스키마 생성 표식은 버전이 NULL이므로 버전 마이그레이션만 비교한다.
            .filter(migration -> migration.getVersion() != null)
            .toList();
    assertThat(appliedMigrations)
        .extracting(migration -> migration.getVersion().getVersion())
        .containsExactly("1", "2");
    assertThat(appliedMigrations.getFirst().getChecksum()).isEqualTo(v1Checksum);
    v2.validate();
    assertThat(v2.migrate().migrationsExecuted).isZero();

    execute("SET search_path TO v1_upgrade, public");
    insertCoreData();
    var coreDataBeforeUpgrade =
        queryStrings(
            """
            SELECT 'etl_batch:' || to_jsonb(b)::text FROM etl_batch b
            UNION ALL SELECT 'district:' || to_jsonb(d)::text FROM district d
            UNION ALL SELECT 'administrative_dong:' || to_jsonb(a)::text FROM administrative_dong a
            UNION ALL SELECT 'service_industry:' || to_jsonb(s)::text FROM service_industry s
            """);
    // Flyway의 별도 연결에서 V3를 적용할 수 있도록 전용 스키마의 기준 데이터를 확정한다.
    connection.commit();

    var v3 = Flyway.configure().configuration(v2.getConfiguration()).target("3").load();
    assertThat(v3.migrate().migrationsExecuted).isEqualTo(1);
    assertThat(v3.info().current().getVersion().getVersion()).isEqualTo("3");
    assertThat(
            Arrays.stream(v3.info().applied())
                // 스키마 생성 표식을 제외한 앞선 V1·V2의 체크섬이 그대로인지 확인한다.
                .filter(migration -> migration.getVersion() != null)
                .limit(2)
                .map(migration -> migration.getChecksum())
                .toList())
        .containsExactlyElementsOf(
            appliedMigrations.stream().map(migration -> migration.getChecksum()).toList());
    assertThat(
            queryStrings(
                """
                SELECT 'etl_batch:' || to_jsonb(b)::text FROM etl_batch b
                UNION ALL SELECT 'district:' || to_jsonb(d)::text FROM district d
                UNION ALL SELECT 'administrative_dong:' || to_jsonb(a)::text FROM administrative_dong a
                UNION ALL SELECT 'service_industry:' || to_jsonb(s)::text FROM service_industry s
                """))
        .containsExactlyInAnyOrderElementsOf(coreDataBeforeUpgrade);
    v3.validate();
    assertThat(v3.migrate().migrationsExecuted).isZero();

    insertStat("dong_store_stat");
    insertStat("dong_sales_stat");
    insertStat("dong_foot_traffic_stat");
    // NULL뿐인 행으로는 측정값 손실을 발견하지 못하므로 모든 기존 지표를 채운다.
    execute(
        """
        UPDATE dong_store_stat SET store_count = 123, general_store_count = 100,
          franchise_store_count = 23, opened_store_count = 4, closed_store_count = 2,
          opening_rate = 3.25, closure_rate = 1.75
        """);
    execute(
        """
        UPDATE dong_sales_stat SET monthly_sales_amount = 9000000000000,
          monthly_sales_count = 3000000000,
          weekday_sales_amount = 4000000000000, weekend_sales_amount = 5000000000000
        """);
    execute(
        """
        UPDATE dong_foot_traffic_stat SET total_foot_traffic = 123.456789,
          male_foot_traffic = 12.345678, female_foot_traffic = 111.111111
        """);
    var statDataBeforeUpgrade =
        queryStrings(
            """
            SELECT 'store:' || to_jsonb(s)::text FROM dong_store_stat s
            UNION ALL SELECT 'sales:' || to_jsonb(s)::text FROM dong_sales_stat s
            UNION ALL SELECT 'foot:' || to_jsonb(s)::text FROM dong_foot_traffic_stat s
            """);
    var checksumsBeforeV4 =
        Arrays.stream(v3.info().applied())
            .filter(migration -> migration.getVersion() != null)
            .map(migration -> migration.getChecksum())
            .toList();
    // V4 적용 연결이 기존 데이터 조회의 잠금을 기다리지 않도록 먼저 확정한다.
    connection.commit();

    var v4 = Flyway.configure().configuration(v3.getConfiguration()).target("4").load();
    assertThat(v4.migrate().migrationsExecuted).isEqualTo(1);
    assertThat(
            Arrays.stream(v4.info().applied())
                .filter(migration -> migration.getVersion() != null)
                .map(migration -> migration.getVersion().getVersion())
                .toList())
        .containsExactly("1", "2", "3", "4");
    assertThat(
            Arrays.stream(v4.info().applied())
                .filter(migration -> migration.getVersion() != null)
                .limit(3)
                .map(migration -> migration.getChecksum())
                .toList())
        .containsExactlyElementsOf(checksumsBeforeV4);
    assertThat(
            queryStrings(
                """
                SELECT 'etl_batch:' || to_jsonb(b)::text FROM etl_batch b
                UNION ALL SELECT 'district:' || to_jsonb(d)::text FROM district d
                UNION ALL SELECT 'administrative_dong:' || to_jsonb(a)::text FROM administrative_dong a
                UNION ALL SELECT 'service_industry:' || to_jsonb(s)::text FROM service_industry s
                """))
        .containsExactlyInAnyOrderElementsOf(coreDataBeforeUpgrade);
    assertThat(
            queryStrings(
                """
                SELECT 'store:' || to_jsonb(s)::text FROM dong_store_stat s
                UNION ALL SELECT 'sales:' || to_jsonb(s)::text FROM dong_sales_stat s
                UNION ALL SELECT 'foot:' || to_jsonb(s)::text FROM dong_foot_traffic_stat s
                """))
        .containsExactlyInAnyOrderElementsOf(statDataBeforeUpgrade);
    assertThat(queryStrings("SELECT count(*)::text FROM cafe_store")).containsExactly("0");
    v4.validate();
    assertThat(v4.info().pending()).isEmpty();
    assertThat(v4.migrate().migrationsExecuted).isZero();
  }

  @Test
  void createsCoreTablesWithPrimaryAndForeignKeys() throws Exception {
    // 기본키의 식별 기준과 경계·업종에서 배치 및 행정구역으로 이어지는 외래키를 확인한다.
    assertThat(
            queryStrings(
                """
                SELECT c.relname || ':' || pg_get_constraintdef(k.oid)
                FROM pg_constraint k
                JOIN pg_class c ON c.oid = k.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND k.contype IN ('p', 'f')
                  AND c.relname IN ('etl_batch', 'district', 'administrative_dong', 'service_industry')
                """))
        .containsExactlyInAnyOrder(
            "etl_batch:PRIMARY KEY (batch_id)",
            "district:PRIMARY KEY (district_code)",
            "administrative_dong:PRIMARY KEY (dong_code)",
            "service_industry:PRIMARY KEY (industry_code)",
            "district:FOREIGN KEY (boundary_batch_id) REFERENCES etl_batch(batch_id)",
            "administrative_dong:FOREIGN KEY (district_code) REFERENCES district(district_code)",
            "administrative_dong:FOREIGN KEY (boundary_batch_id) REFERENCES etl_batch(batch_id)",
            "service_industry:FOREIGN KEY (source_batch_id) REFERENCES etl_batch(batch_id)");
  }

  @Test
  void createsOnlyRequiredIndexesBesidesPrimaryKeys() throws Exception {
    // 공간 검색과 자치구·배치 조회에 필요한 인덱스만 추가되었는지 확인한다.
    assertThat(
            queryStrings(
                """
                SELECT t.relname || ':' || am.amname || ':' ||
                       pg_get_indexdef(i.indexrelid, 1, true) ||
                       CASE WHEN i.indnatts > 1
                            THEN ',' || pg_get_indexdef(i.indexrelid, 2, true) ELSE '' END
                FROM pg_index i
                JOIN pg_class t ON t.oid = i.indrelid
                JOIN pg_class idx ON idx.oid = i.indexrelid
                JOIN pg_am am ON am.oid = idx.relam
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = 'public' AND NOT i.indisprimary
                  AND t.relname IN ('etl_batch', 'district', 'administrative_dong', 'service_industry')
                """))
        .containsExactlyInAnyOrder(
            "district:gist:geom",
            "administrative_dong:gist:geom",
            "administrative_dong:btree:district_code",
            "etl_batch:btree:dataset_code,started_at");
    assertThat(
            queryStrings(
                """
                SELECT indexdef FROM pg_indexes
                WHERE schemaname = 'public' AND tablename = 'etl_batch'
                  AND indexdef LIKE '%(dataset_code, started_at DESC)%'
                """))
        .hasSize(1);
  }

  @Test
  void definesRequiredAndOptionalColumns() throws Exception {
    // 배치의 선택 항목과 필수 경계 데이터, 도형 종류 및 SRID 계약을 함께 확인한다.
    assertThat(
            queryStrings(
                """
                SELECT table_name || '.' || column_name
                FROM information_schema.columns
                WHERE table_schema = 'public' AND is_nullable = 'YES'
                  AND table_name IN ('etl_batch', 'district', 'administrative_dong', 'service_industry')
                """))
        .containsExactlyInAnyOrder(
            "etl_batch.scope_code",
            "etl_batch.period_from",
            "etl_batch.period_to",
            "etl_batch.source_checksum",
            "etl_batch.expected_rows",
            "etl_batch.finished_at",
            "etl_batch.published_at",
            "etl_batch.error_message");
    assertThat(
            queryStrings(
                """
                SELECT f_table_name || '.' || f_geometry_column || ':' || type || ':' || srid
                FROM geometry_columns
                WHERE f_table_schema = 'public'
                  AND f_table_name IN ('district', 'administrative_dong')
                """))
        .containsExactlyInAnyOrder(
            "district.geom:MULTIPOLYGON:4326",
            "administrative_dong.geom:MULTIPOLYGON:4326",
            "administrative_dong.label_point:POINT:4326");
  }

  @Test
  void acceptsMinimalCoreDataAndDefaultsRowCountsToZero() throws Exception {
    // 선택 메타데이터는 NULL로 남고 아직 집계하지 않은 처리 건수는 기본값 0을 갖는다.
    insertCoreData();
    assertThat(
            queryStrings(
                """
                SELECT ST_IsEmpty(d.geom) || ':' || ST_IsEmpty(a.geom) || ':' ||
                       ST_IsEmpty(a.label_point)
                FROM administrative_dong a JOIN district d USING (district_code)
                """))
        .containsExactly("false:false:false");
    assertThat(
            queryStrings(
                """
                SELECT fetched_rows || ':' || valid_rows || ':' || rejected_rows || ':' ||
                       (expected_rows IS NULL) || ':' || (period_from IS NULL) || ':' ||
                       (period_to IS NULL) || ':' || (finished_at IS NULL) || ':' ||
                       (published_at IS NULL) || ':' || (error_message IS NULL) || ':' ||
                       (source_checksum IS NULL)
                FROM etl_batch
                """))
        .containsExactly("0:0:0:true:true:true:true:true:true:true");
    assertThat(
            queryStrings(
                """
                SELECT d.district_name || ':' || a.dong_name || ':' || s.industry_name
                FROM administrative_dong a
                JOIN district d USING (district_code)
                JOIN service_industry s ON s.source_batch_id = a.boundary_batch_id
                """))
        .containsExactly("테스트구:테스트동:테스트업종");
  }

  @ParameterizedTest
  @ValueSource(strings = {"RUNNING", "PUBLISHED", "FAILED", "SKIPPED"})
  void acceptsSupportedBatchStatuses(String status) throws Exception {
    insertBatch();
    execute("UPDATE etl_batch SET status = '" + status + "'");
    assertThat(queryStrings("SELECT status FROM etl_batch")).containsExactly(status);
  }

  @ParameterizedTest
  @ValueSource(strings = {"CSV", "API", "SHAPEFILE"})
  void acceptsSupportedSourceTypes(String sourceType) throws Exception {
    insertBatch();
    execute("UPDATE etl_batch SET source_type = '" + sourceType + "'");
    assertThat(queryStrings("SELECT source_type FROM etl_batch")).containsExactly(sourceType);
  }

  @Test
  void acceptsValidScopesQuarterBoundariesAndOptionalBatchDetails() throws Exception {
    // 연도를 넘는 분기 범위와 같은 분기, 한쪽 기간이 없는 배치도 허용한다.
    insertBatch();
    execute(
        """
        UPDATE etl_batch SET scope_type = 'DISTRICT', scope_code = '11110',
          period_from = '20254', period_to = '20261', expected_rows = 2,
          fetched_rows = 2, valid_rows = 1, rejected_rows = 1,
          source_checksum = repeat('a', 64), finished_at = now(), published_at = now(),
          error_message = 'test detail'
        """);
    execute("UPDATE etl_batch SET period_from = '20261', period_to = '20261'");
    execute("UPDATE etl_batch SET period_from = NULL");
    execute("UPDATE etl_batch SET period_from = '20261', period_to = NULL");
    execute("UPDATE etl_batch SET scope_type = 'SEOUL', scope_code = NULL, expected_rows = 0");
    assertThat(queryStrings("SELECT scope_type FROM etl_batch")).containsExactly("SEOUL");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "status = 'DONE'",
        "status = 'running'",
        "source_type = 'FILE'",
        "source_type = 'JSON'",
        "source_type = 'csv'",
        "source_type = ''",
        "expected_rows = -1",
        "fetched_rows = -1",
        "valid_rows = -1",
        "rejected_rows = -1",
        "period_from = '20260'",
        "period_to = '20265'",
        "period_from = '2026'",
        "period_to = '26Q1'",
        "period_from = '2026x'",
        "period_to = ''",
        "period_from = '20262', period_to = '20261'",
        "period_from = '20261', period_to = '20254'",
        "scope_type = 'UNKNOWN'",
        "scope_type = 'DISTRICT', scope_code = NULL",
        "scope_type = 'DISTRICT', scope_code = '1111'",
        "scope_type = 'DISTRICT', scope_code = '11a10'",
        "scope_type = 'SEOUL', scope_code = '11110'",
        "scope_type = 'SEOUL', scope_code = ''"
      })
  void rejectsInvalidBatchData(String assignment) throws Exception {
    // 상태·출처·범위 형식, 음수 건수, 분기 형식 및 역전된 기간을 CHECK 제약으로 거부한다.
    insertBatch();
    assertRejected("UPDATE etl_batch SET " + assignment, "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"etl_batch", "district", "administrative_dong", "service_industry"})
  void rejectsDuplicatePrimaryKeys(String table) throws Exception {
    // 동일 행을 복제했을 때 기본키 중복 오류가 발생하는지 실제 입력으로 검증한다.
    insertCoreData();
    assertRejected("INSERT INTO " + table + " SELECT * FROM " + table, "23505");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "district SET boundary_batch_id",
        "administrative_dong SET boundary_batch_id",
        "service_industry SET source_batch_id"
      })
  void rejectsMissingBatchReferences(String assignment) throws Exception {
    // 존재하지 않는 배치를 참조하는 경계·업종 데이터는 외래키 제약으로 거부한다.
    insertCoreData();
    assertRejected("UPDATE " + assignment + " = '" + MISSING_BATCH_ID + "'", "23503");
  }

  @Test
  void rejectsMissingDistrictEvenWhenDongPrefixMatches() throws Exception {
    // 행정동 코드 접두어가 일치하더라도 참조 자치구 행은 실제로 존재해야 한다.
    insertCoreData();
    assertRejected(
        "UPDATE administrative_dong SET dong_code = '11140101', district_code = '11140'", "23503");
  }

  @ParameterizedTest
  @ValueSource(strings = {"dong_code = '11140101'", "area_m2 = 0", "area_m2 = -1"})
  void rejectsInvalidDongData(String assignment) throws Exception {
    insertCoreData();
    assertRejected("UPDATE administrative_dong SET " + assignment, "23514");
  }

  @Test
  void acceptsNumericAdministrativeCodesWithLeadingZeros() throws Exception {
    // 행정구역 코드는 숫자 계산값이 아닌 고정 길이 문자열이므로 앞자리 0을 보존한다.
    insertBatch();
    execute("INSERT INTO district VALUES ('00001', '테스트구', " + BOUNDARY + ", '" + BATCH_ID + "')");
    execute(
        """
        INSERT INTO administrative_dong VALUES
          ('00001001', '00001', '테스트동', %s,
           ST_SetSRID(ST_MakePoint(127.005,37.005),4326), 100, '%s')
        """
            .formatted(BOUNDARY, BATCH_ID));
    assertThat(
            queryStrings(
                """
                SELECT district_code || ':' || dong_code
                FROM administrative_dong JOIN district USING (district_code)
                """))
        .containsExactly("00001:00001001");
  }

  @ParameterizedTest
  @ValueSource(strings = {"", "1111", "1111A", "1111 ", "１１１１０"})
  void rejectsInvalidDistrictCodeFormat(String districtCode) throws Exception {
    insertBatch();
    assertRejected(
        "INSERT INTO district VALUES ('"
            + districtCode
            + "', '테스트구', "
            + BOUNDARY
            + ", '"
            + BATCH_ID
            + "')",
        "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"1111010", "1111010A", "1111010 ", "11110１２３"})
  void rejectsInvalidDongCodeFormatEvenWhenDistrictPrefixMatches(String dongCode) throws Exception {
    insertCoreData();
    assertRejected("UPDATE administrative_dong SET dong_code = '" + dongCode + "'", "23514");
  }

  @ParameterizedTest
  @CsvSource({
    "district, geom, MULTIPOLYGON EMPTY",
    "administrative_dong, geom, MULTIPOLYGON EMPTY",
    "administrative_dong, label_point, POINT EMPTY"
  })
  void rejectsEmptySpatialData(String table, String column, String emptyGeometry) throws Exception {
    // NULL이 아닌 빈 도형도 유효한 경계나 대표점으로 취급하지 않는다.
    insertCoreData();
    assertRejected(
        "UPDATE " + table + " SET " + column + " = ST_GeomFromText('" + emptyGeometry + "',4326)",
        "23514");
  }

  @ParameterizedTest
  @CsvSource({"district, geom", "administrative_dong, geom", "administrative_dong, label_point"})
  void rejectsWrongSridAndNullSpatialData(String table, String column) throws Exception {
    insertCoreData();
    assertRejected(
        "UPDATE " + table + " SET " + column + " = ST_SetSRID(" + column + ", 5181)", "22023");
    assertRejected("UPDATE " + table + " SET " + column + " = NULL", "23502");
  }

  @ParameterizedTest
  @ValueSource(strings = {"district", "administrative_dong"})
  void rejectsInvalidBoundaryAndWrongGeometryType(String table) throws Exception {
    insertCoreData();
    assertRejected(
        "UPDATE "
            + table
            + " SET geom = ST_GeomFromText("
            + "'MULTIPOLYGON(((127 37,127.01 37.01,127.01 37,127 37.01,127 37)))',4326)",
        "23514");
    assertRejected(
        "UPDATE " + table + " SET geom = ST_SetSRID(ST_MakePoint(127,37),4326)", "22023");
  }

  @Test
  void rejectsInvalidLabelPointAndWrongGeometryType() throws Exception {
    insertCoreData();
    assertRejected(
        "UPDATE administrative_dong SET label_point = ST_GeomFromText('POINT(NaN 37)',4326)",
        "23514");
    assertRejected("UPDATE administrative_dong SET label_point = geom", "22023");
  }

  @Test
  void createsStatTablesWithCompositePrimaryAndForeignKeys() throws Exception {
    // 통계의 행정동·분기·해당 업종 조합과 원천 배치 참조가 스키마에 반영되어야 한다.
    assertThat(
            queryStrings(
                """
                SELECT c.relname || ':' || pg_get_constraintdef(k.oid)
                FROM pg_constraint k
                JOIN pg_class c ON c.oid = k.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND k.contype IN ('p', 'f')
                  AND c.relname IN ('dong_store_stat', 'dong_sales_stat', 'dong_foot_traffic_stat')
                """))
        .containsExactlyInAnyOrder(
            "dong_store_stat:PRIMARY KEY (dong_code, industry_code, quarter_code)",
            "dong_sales_stat:PRIMARY KEY (dong_code, industry_code, quarter_code)",
            "dong_foot_traffic_stat:PRIMARY KEY (dong_code, quarter_code)",
            "dong_store_stat:FOREIGN KEY (dong_code) REFERENCES administrative_dong(dong_code)",
            "dong_sales_stat:FOREIGN KEY (dong_code) REFERENCES administrative_dong(dong_code)",
            "dong_foot_traffic_stat:FOREIGN KEY (dong_code) REFERENCES administrative_dong(dong_code)",
            "dong_store_stat:FOREIGN KEY (industry_code) REFERENCES service_industry(industry_code)",
            "dong_sales_stat:FOREIGN KEY (industry_code) REFERENCES service_industry(industry_code)",
            "dong_store_stat:FOREIGN KEY (source_batch_id) REFERENCES etl_batch(batch_id)",
            "dong_sales_stat:FOREIGN KEY (source_batch_id) REFERENCES etl_batch(batch_id)",
            "dong_foot_traffic_stat:FOREIGN KEY (source_batch_id) REFERENCES etl_batch(batch_id)");
    assertThat(
            queryStrings(
                """
                SELECT indexrelid::regclass::text FROM pg_index
                WHERE indrelid IN ('dong_store_stat'::regclass, 'dong_sales_stat'::regclass,
                                   'dong_foot_traffic_stat'::regclass) AND NOT indisprimary
                """))
        .isEmpty();
  }

  @ParameterizedTest
  @CsvSource({
    "dong_store_stat, store_count",
    "dong_store_stat, general_store_count",
    "dong_store_stat, franchise_store_count",
    "dong_store_stat, opened_store_count",
    "dong_store_stat, closed_store_count",
    "dong_store_stat, opening_rate",
    "dong_store_stat, closure_rate",
    "dong_sales_stat, monthly_sales_amount",
    "dong_sales_stat, monthly_sales_count",
    "dong_sales_stat, weekday_sales_amount",
    "dong_sales_stat, weekend_sales_amount",
    "dong_foot_traffic_stat, total_foot_traffic",
    "dong_foot_traffic_stat, male_foot_traffic",
    "dong_foot_traffic_stat, female_foot_traffic"
  })
  void distinguishesMissingMeasurementsFromZeroAndRejectsNegatives(String table, String column)
      throws Exception {
    // 미수집 값(NULL)과 실제 측정값 0을 구분하고 음수 통계는 허용하지 않는다.
    insertCoreData();
    insertStat(table);
    assertThat(queryStrings("SELECT " + column + "::text FROM " + table))
        .containsExactly((String) null);
    execute("UPDATE " + table + " SET " + column + " = 0");
    assertThat(queryStrings("SELECT " + column + "::text FROM " + table)).containsExactly("0");
    assertRejected("UPDATE " + table + " SET " + column + " = -1", "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"dong_store_stat", "dong_sales_stat", "dong_foot_traffic_stat"})
  void rejectsDuplicateStatKeysButAllowsAnotherQuarter(String table) throws Exception {
    // 같은 통계 키는 중복 저장할 수 없지만 분기가 다르면 별도 시계열 행으로 저장한다.
    insertCoreData();
    insertStat(table);
    assertRejected("INSERT INTO " + table + " SELECT * FROM " + table, "23505");
    execute("UPDATE " + table + " SET quarter_code = '20262'");
    insertStat(table);
    assertThat(queryStrings("SELECT quarter_code FROM " + table + " ORDER BY quarter_code"))
        .containsExactly("20261", "20262");
  }

  @ParameterizedTest
  @ValueSource(strings = {"dong_store_stat", "dong_sales_stat"})
  void allowsDifferentIndustriesInTheSameDongAndQuarter(String table) throws Exception {
    insertCoreData();
    insertStat(table);
    execute("INSERT INTO service_industry VALUES ('TEST0002', '다른테스트업종', '" + BATCH_ID + "')");
    execute(
        "INSERT INTO "
            + table
            + " (dong_code, industry_code, quarter_code, source_batch_id) "
            + "VALUES ('11110101', 'TEST0002', '20261', '"
            + BATCH_ID
            + "')");
    assertThat(queryStrings("SELECT industry_code FROM " + table + " ORDER BY industry_code"))
        .containsExactly("TEST0001", "TEST0002");
  }

  @ParameterizedTest
  @ValueSource(strings = {"dong_store_stat", "dong_sales_stat", "dong_foot_traffic_stat"})
  void rejectsMissingStatKeysAndReferences(String table) throws Exception {
    insertCoreData();
    insertStat(table);
    assertRejected("UPDATE " + table + " SET dong_code = '11110102'", "23503");
    assertRejected(
        "UPDATE " + table + " SET source_batch_id = '" + MISSING_BATCH_ID + "'", "23503");
    assertRejected("UPDATE " + table + " SET source_batch_id = NULL", "23502");
    assertRejected("UPDATE " + table + " SET dong_code = NULL", "23502");
    assertRejected("UPDATE " + table + " SET quarter_code = NULL", "23502");
    if (!table.equals("dong_foot_traffic_stat")) {
      // 유동인구는 업종 구분이 없으므로 점포·매출 통계에만 업종 참조를 검증한다.
      assertRejected("UPDATE " + table + " SET industry_code = 'UNKNOWN1'", "23503");
      assertRejected("UPDATE " + table + " SET industry_code = NULL", "23502");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"dong_store_stat", "dong_sales_stat", "dong_foot_traffic_stat"})
  void rejectsMalformedStatQuarters(String table) throws Exception {
    // 분기는 ASCII 연도 4자리와 1~4분기로 구성하며 길이 초과 오류도 구분한다.
    insertCoreData();
    insertStat(table);
    for (var quarter : List.of("", "2026", "20260", "20265", "2026Q", "２0261")) {
      assertRejected("UPDATE " + table + " SET quarter_code = '" + quarter + "'", "23514");
    }
    assertRejected("UPDATE " + table + " SET quarter_code = '202611'", "22001");
  }

  @ParameterizedTest
  @CsvSource({
    "dong_store_stat, opening_rate",
    "dong_store_stat, closure_rate",
    "dong_foot_traffic_stat, total_foot_traffic",
    "dong_foot_traffic_stat, male_foot_traffic",
    "dong_foot_traffic_stat, female_foot_traffic"
  })
  void preservesNumericPrecisionAndRejectsNonfiniteOrNegativeValues(String table, String column)
      throws Exception {
    // 소수 정밀도는 보존하되 음수·NaN·양의 무한대·음의 무한대는 측정값에서 제외한다.
    insertCoreData();
    insertStat(table);
    execute("UPDATE " + table + " SET " + column + " = 123.456789");
    assertThat(queryStrings("SELECT " + column + "::text FROM " + table))
        .containsExactly("123.456789");
    for (var value : List.of("-0.001", "'NaN'", "'Infinity'", "'-Infinity'")) {
      assertRejected("UPDATE " + table + " SET " + column + " = " + value, "23514");
    }
  }

  @Test
  void acceptsLargeIntegerStatisticsAndDoesNotRequireComponentSumsToMatch() throws Exception {
    // 큰 정수와 100을 넘는 비율을 수용하며 원천 통계의 부분 합과 총계 일치를 강제하지 않는다.
    insertCoreData();
    insertStat("dong_store_stat");
    insertStat("dong_sales_stat");
    insertStat("dong_foot_traffic_stat");
    execute(
        """
        UPDATE dong_store_stat SET store_count = 3000000000, general_store_count = 1,
          franchise_store_count = 2, opened_store_count = 3, closed_store_count = 4,
          opening_rate = 150.25, closure_rate = 200.75
        """);
    execute(
        """
        UPDATE dong_sales_stat SET monthly_sales_amount = 9000000000000,
          monthly_sales_count = 3000000000,
          weekday_sales_amount = 4000000000, weekend_sales_amount = 5000000000
        """);
    execute(
        """
        UPDATE dong_foot_traffic_stat SET total_foot_traffic = 3000000000.123456,
          male_foot_traffic = 1.01, female_foot_traffic = 2.02
        """);
    assertThat(
            queryStrings(
                "SELECT store_count || ':' || opening_rate || ':' || closure_rate FROM dong_store_stat"))
        .containsExactly("3000000000:150.25:200.75");
    assertThat(
            queryStrings(
                "SELECT monthly_sales_amount || ':' || monthly_sales_count FROM dong_sales_stat"))
        .containsExactly("9000000000000:3000000000");
    assertThat(queryStrings("SELECT total_foot_traffic::text FROM dong_foot_traffic_stat"))
        .containsExactly("3000000000.123456");
  }

  @Test
  void definesCafeColumnTypesLengthsNullabilityAndNoDefaults() throws Exception {
    // 식별자·원천 코드의 문자열 길이와 선택 필드의 NULL 계약을 빠짐없이 확인한다.
    assertThat(
            queryStrings(
                """
                SELECT column_name || ':' || data_type || ':' ||
                       COALESCE(character_maximum_length::text, '-') || ':' ||
                       is_nullable || ':' || COALESCE(column_default, '-')
                FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'cafe_store'
                """))
        .containsExactlyInAnyOrder(
            "bizes_id:character varying:20:NO:-",
            "store_name:text:-:NO:-",
            "branch_name:text:-:YES:-",
            "semas_industry_code:character varying:8:NO:-",
            "semas_industry_name:text:-:NO:-",
            "ksic_code:character varying:6:YES:-",
            "ksic_name:text:-:YES:-",
            "source_dong_code:character varying:20:YES:-",
            "dong_code:character varying:8:YES:-",
            "road_address:text:-:YES:-",
            "lot_address:text:-:YES:-",
            "geom:USER-DEFINED:-:YES:-",
            "source_batch_id:uuid:-:NO:-");
    assertThat(
            queryStrings(
                """
                SELECT type || ':' || srid || ':' || coord_dimension
                FROM geometry_columns
                WHERE f_table_schema = 'public' AND f_table_name = 'cafe_store'
                  AND f_geometry_column = 'geom'
                """))
        .containsExactly("POINT:4326:2");
  }

  @Test
  void createsCafePrimaryForeignKeysAndOnlyThreeSearchIndexes() throws Exception {
    // 소진공 업종은 서울시 서비스 업종과 별개이며 삭제 연쇄 없이 배치·행정동만 참조한다.
    assertThat(
            queryStrings(
                """
                SELECT pg_get_constraintdef(oid)
                FROM pg_constraint
                WHERE conrelid = 'public.cafe_store'::regclass AND contype IN ('p', 'f')
                """))
        .containsExactlyInAnyOrder(
            "PRIMARY KEY (bizes_id)",
            "FOREIGN KEY (dong_code) REFERENCES administrative_dong(dong_code)",
            "FOREIGN KEY (source_batch_id) REFERENCES etl_batch(batch_id)");
    assertThat(
            queryStrings(
                """
                SELECT am.amname || ':' ||
                       regexp_replace(pg_get_indexdef(i.indexrelid, 1, true), '[() ]', '', 'g') ||
                       CASE WHEN i.indnatts > 1
                            THEN ',' || pg_get_indexdef(i.indexrelid, 2, true) ELSE '' END ||
                       ':' || i.indisunique || ':' || (i.indpred IS NULL)
                FROM pg_index i
                JOIN pg_class idx ON idx.oid = i.indexrelid
                JOIN pg_am am ON am.oid = idx.relam
                WHERE i.indrelid = 'public.cafe_store'::regclass AND NOT i.indisprimary
                """))
        .containsExactlyInAnyOrder(
            "btree:source_batch_id,dong_code:false:true",
            "gist:geom:false:true",
            "gist:geom::geography:false:true");
  }

  @Test
  void acceptsFullCafeWithoutSeoulIndustryOrSpatialMembershipChecks() throws Exception {
    insertCoreData();
    insertCafe();
    // 임의 소진공 코드와 경계 밖 좌표도 보존한다. 카페 대상·공간 소속 판정은 ETL 책임이다.
    assertThat(
            queryStrings(
                """
                SELECT bizes_id || ':' || store_name || ':' || branch_name || ':' ||
                       semas_industry_code || ':' || semas_industry_name || ':' ||
                       ksic_code || ':' || ksic_name || ':' || source_dong_code || ':' ||
                       dong_code || ':' || road_address || ':' || lot_address || ':' ||
                       ST_AsText(geom) || ':' || source_batch_id
                FROM cafe_store
                """))
        .containsExactly(
            "000001-opaque/a:테스트카페:테스트지점:Q9A7:합성업종:A12345:합성표준업종:11110101:11110101:"
                + "테스트로 1:테스트동 1:POINT(127.02 37.005):"
                + BATCH_ID);
    assertThat(queryStrings("SELECT status FROM etl_batch")).containsExactly("RUNNING");
    execute(
        """
        INSERT INTO cafe_store
        SELECT 'another-store', store_name, branch_name, semas_industry_code,
               semas_industry_name, ksic_code, ksic_name, source_dong_code,
               dong_code, road_address, lot_address, geom, source_batch_id
        FROM cafe_store
        """);
    assertThat(queryStrings("SELECT count(*)::text FROM cafe_store")).containsExactly("2");
    assertRejected("INSERT INTO cafe_store SELECT * FROM cafe_store", "23505");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "NULL",
        "'0'",
        "'1111010100'",
        "'0000100100'",
        "'99999999'",
        "'00000000000000000001'"
      })
  void acceptsUnlinkedCafeAndPreservesRawDongCode(String sourceDongCode) throws Exception {
    // 누락·구형 10자리·미등록 8자리 코드를 자르거나 연결하지 않고 원문으로 보관한다.
    insertBatch();
    execute(
        """
        INSERT INTO cafe_store
          (bizes_id, store_name, semas_industry_code, semas_industry_name,
           source_dong_code, source_batch_id)
        VALUES ('plain-id', '테스트카페', 'A1B2C3D4', '합성업종', %s, '%s')
        """
            .formatted(sourceDongCode, BATCH_ID));
    assertThat(
            queryStrings(
                """
                SELECT (branch_name IS NULL) AND (ksic_code IS NULL) AND (ksic_name IS NULL)
                  AND (dong_code IS NULL) AND (road_address IS NULL) AND (lot_address IS NULL)
                  AND (geom IS NULL) FROM cafe_store
                """))
        .containsExactly("t");
    assertThat(
            queryStrings(
                "SELECT source_dong_code IS NOT DISTINCT FROM "
                    + sourceDongCode
                    + " FROM cafe_store"))
        .containsExactly("t");
  }

  @Test
  void preservesLeadingZerosInCafeIdAndLinkedDongCodes() throws Exception {
    insertCoreData();
    execute(
        """
        INSERT INTO district
        SELECT '00001', district_name, geom, boundary_batch_id FROM district
        """);
    execute(
        """
        INSERT INTO administrative_dong
        SELECT '00001001', '00001', dong_name, geom, label_point, area_m2, boundary_batch_id
        FROM administrative_dong
        """);
    insertCafe();
    execute(
        """
        UPDATE cafe_store SET bizes_id = '00000000000000000001',
          source_dong_code = '00001001', dong_code = '00001001'
        """);
    assertThat(
            queryStrings(
                "SELECT bizes_id || ':' || source_dong_code || ':' || dong_code FROM cafe_store"))
        .containsExactly("00000000000000000001:00001001:00001001");
  }

  @Test
  void acceptsArbitraryUppercaseAlphanumericIndustryCodesAndIndependentOptionalText()
      throws Exception {
    insertCoreData();
    insertCafe();
    // 업종 코드는 접두사·최소 자릿수를 가정하지 않고 표준업종 이름과도 독립적으로 보관한다.
    for (var code : List.of("A", "1", "Z9", "A12345")) {
      execute(
          "UPDATE cafe_store SET semas_industry_code = '" + code + "', ksic_code = '" + code + "'");
      assertThat(queryStrings("SELECT semas_industry_code || ':' || ksic_code FROM cafe_store"))
          .containsExactly(code + ":" + code);
    }
    execute(
        "UPDATE cafe_store SET ksic_code = NULL, store_name = E' \\t테스트카페\\n ', branch_name = NULL");
    assertThat(queryStrings("SELECT ksic_name FROM cafe_store")).containsExactly("합성표준업종");
    execute("UPDATE cafe_store SET ksic_code = 'A', ksic_name = NULL");
    assertThat(queryStrings("SELECT ksic_code FROM cafe_store")).containsExactly("A");
  }

  @Test
  void supportsMeterRadiusAndViewportQueriesAndCoordinateLimits() throws Exception {
    insertCoreData();
    insertCafe();
    // geography의 미터 반경과 geometry의 경위도 뷰포트를 서로 다른 연산으로 검증한다.
    assertThat(
            queryStrings(
                """
                SELECT ST_DWithin(geom::geography,
                         ST_SetSRID(ST_MakePoint(127.02,37.0051),4326)::geography, 20)
                       AND NOT ST_DWithin(geom::geography,
                         ST_SetSRID(ST_MakePoint(127.02,37.006),4326)::geography, 20)
                       AND geom && ST_MakeEnvelope(127.019,37.004,127.021,37.006,4326)
                FROM cafe_store
                """))
        .containsExactly("t");
    for (var coordinates : List.of("180,90", "180,-90", "-180,90", "-180,-90", "0,0")) {
      execute("UPDATE cafe_store SET geom = ST_SetSRID(ST_MakePoint(" + coordinates + "),4326)");
      assertThat(queryStrings("SELECT ST_IsValid(geom) AND NOT ST_IsEmpty(geom) FROM cafe_store"))
          .containsExactly("t");
    }
    execute("UPDATE cafe_store SET geom = NULL");
    assertThat(queryStrings("SELECT geom IS NULL FROM cafe_store")).containsExactly("t");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "bizes_id",
        "store_name",
        "semas_industry_code",
        "semas_industry_name",
        "source_batch_id"
      })
  void rejectsMissingRequiredCafeValues(String column) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected("UPDATE cafe_store SET " + column + " = NULL", "23502");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "bizes_id",
        "store_name",
        "branch_name",
        "semas_industry_name",
        "ksic_name",
        "road_address",
        "lot_address"
      })
  void rejectsBlankCafeTextIncludingTabsAndNewlines(String column) throws Exception {
    insertCoreData();
    insertCafe();
    for (var blank : List.of("''", "' '", "E'\\t\\n\\r'")) {
      assertRejected("UPDATE cafe_store SET " + column + " = " + blank, "23514");
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"'with space'", "E'with\\ttab'", "E'with\\nline'"})
  void rejectsWhitespaceWithinOpaqueCafeId(String value) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected("UPDATE cafe_store SET bizes_id = " + value, "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"semas_industry_code", "ksic_code"})
  void rejectsInvalidCafeIndustryCodeFormats(String column) throws Exception {
    insertCoreData();
    insertCafe();
    for (var value : List.of("''", "' '", "'lower'", "'A-12'", "'가'", "'Ａ12'", "E'ABC\\n'")) {
      assertRejected("UPDATE cafe_store SET " + column + " = " + value, "23514");
    }
  }

  @ParameterizedTest
  @CsvSource({
    "bizes_id, 21",
    "semas_industry_code, 9",
    "ksic_code, 7",
    "source_dong_code, 21",
    "dong_code, 9"
  })
  void rejectsCafeValuesBeyondDeclaredStringLengths(String column, int length) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected("UPDATE cafe_store SET " + column + " = repeat('1', " + length + ")", "22001");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "''",
        "' '",
        "'11110A01'",
        "'1111１001'",
        "'-11110101'",
        "'111.10101'",
        "E'11110101\\n'"
      })
  void rejectsNondigitRawCafeDongCodes(String value) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected("UPDATE cafe_store SET dong_code = NULL, source_dong_code = " + value, "23514");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"''", "'1111010'", "'11110A01'", "'1111１001'", "'1111010 '", "E'1111010\\n'"})
  void rejectsMalformedCanonicalCafeDongCodes(String value) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected(
        "UPDATE cafe_store SET dong_code = " + value + ", source_dong_code = " + value, "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"NULL", "'11110102'", "'1111010100'"})
  void rejectsLinkedCafeWithoutExactRawDongCode(String sourceDongCode) throws Exception {
    insertCoreData();
    insertCafe();
    // 원천 10자리 코드의 앞 8자리만 같아도 정규 행정동 코드로 연결하지 않는다.
    assertRejected("UPDATE cafe_store SET source_dong_code = " + sourceDongCode, "23514");
  }

  @Test
  void rejectsMissingCafeDongAndBatchReferences() throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected(
        "UPDATE cafe_store SET source_dong_code = '99999999', dong_code = '99999999'", "23503");
    assertRejected("UPDATE cafe_store SET source_batch_id = '" + MISSING_BATCH_ID + "'", "23503");
    assertRejected("DELETE FROM administrative_dong", "23503");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "POINT EMPTY",
        "POINT(NaN 37)",
        "POINT(127 NaN)",
        "POINT(180.001 37)",
        "POINT(-180.001 37)",
        "POINT(127 90.001)",
        "POINT(127 -90.001)"
      })
  void rejectsEmptyNonfiniteAndOutOfRangeCafeLocations(String geometry) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected(
        "UPDATE cafe_store SET geom = ST_GeomFromText('" + geometry + "',4326)", "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"'Infinity',37", "'-Infinity',37", "127,'Infinity'", "127,'-Infinity'"})
  void rejectsInfiniteCafeCoordinates(String coordinates) throws Exception {
    insertCoreData();
    insertCafe();
    // Infinity 문자열은 WKT 파서가 먼저 거부하므로 실제 무한대 Point를 만들어 CHECK를 검증한다.
    assertRejected(
        "UPDATE cafe_store SET geom = ST_SetSRID(ST_MakePoint(" + coordinates + "),4326)", "23514");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "ST_SetSRID(ST_MakePoint(127,37),5181)",
        "ST_GeomFromText('LINESTRING(127 37,128 38)',4326)",
        "ST_GeomFromText('MULTIPOINT((127 37))',4326)",
        "ST_GeomFromText('POINT Z(127 37 1)',4326)",
        "ST_GeomFromText('POINT M(127 37 1)',4326)"
      })
  void rejectsWrongCafeGeometryTypeSridAndDimensions(String geometry) throws Exception {
    insertCoreData();
    insertCafe();
    assertRejected("UPDATE cafe_store SET geom = " + geometry, "22023");
  }

  /** 서로 다른 원천 업종 코드와 경계 밖 좌표를 포함한 합성 카페를 준비한다. */
  private void insertCafe() throws SQLException {
    execute(
        """
        INSERT INTO cafe_store
          (bizes_id, store_name, branch_name, semas_industry_code, semas_industry_name,
           ksic_code, ksic_name, source_dong_code, dong_code, road_address, lot_address,
           geom, source_batch_id)
        VALUES ('000001-opaque/a', '테스트카페', '테스트지점', 'Q9A7', '합성업종',
                'A12345', '합성표준업종', '11110101', '11110101', '테스트로 1', '테스트동 1',
                ST_SetSRID(ST_MakePoint(127.02,37.005),4326), '%s')
        """
            .formatted(BATCH_ID));
  }

  /** 측정값은 지정하지 않고 필수 키와 원천 배치만 갖춘 통계 행을 준비한다. */
  private void insertStat(String table) throws SQLException {
    var hasIndustry = !table.equals("dong_foot_traffic_stat");
    execute(
        "INSERT INTO "
            + table
            + " (dong_code, quarter_code, source_batch_id"
            + (hasIndustry ? ", industry_code" : "")
            + ") VALUES ('11110101', '20261', '"
            + BATCH_ID
            + "'"
            + (hasIndustry ? ", 'TEST0001'" : "")
            + ")");
  }

  private void insertBatch() throws SQLException {
    execute(
        """
        INSERT INTO etl_batch
          (batch_id, dataset_code, source_type, scope_type, scope_code,
           source_reference, etl_version, status, started_at)
        VALUES ('%s', 'TEST_BOUNDARY', 'CSV', 'DISTRICT', '11110',
                'synthetic fixture', 'test-v1', 'RUNNING', now())
        """
            .formatted(BATCH_ID));
  }

  /** 실제 공공데이터 대신 서로 참조하는 합성 배치·자치구·행정동·업종을 준비한다. */
  private void insertCoreData() throws SQLException {
    insertBatch();
    execute("INSERT INTO district VALUES ('11110', '테스트구', " + BOUNDARY + ", '" + BATCH_ID + "')");
    execute(
        """
        INSERT INTO administrative_dong VALUES
          ('11110101', '11110', '테스트동', %s,
           ST_SetSRID(ST_MakePoint(127.005,37.005),4326), 100, '%s')
        """
            .formatted(BOUNDARY, BATCH_ID));
    execute("INSERT INTO service_industry VALUES ('TEST0001', '테스트업종', '" + BATCH_ID + "')");
  }

  private void execute(String sql) throws SQLException {
    try (var statement = connection.createStatement()) {
      statement.executeUpdate(sql);
    }
  }

  private List<String> queryStrings(String sql) throws SQLException {
    try (var statement = connection.createStatement();
        var results = statement.executeQuery(sql)) {
      var values = new ArrayList<String>();
      while (results.next()) {
        values.add(results.getString(1));
      }
      return values;
    }
  }

  /** 제약 위반의 SQLSTATE를 확인한 뒤 저장점으로 복구해 다음 검증을 계속할 수 있게 한다. */
  private void assertRejected(String sql, String sqlState) throws SQLException {
    var savepoint = connection.setSavepoint();
    try {
      assertThatThrownBy(() -> execute(sql))
          .as(sql)
          .isInstanceOfSatisfying(
              SQLException.class,
              exception -> assertThat(exception.getSQLState()).isEqualTo(sqlState));
    } finally {
      // PostgreSQL의 오류로 중단된 트랜잭션을 복구하되 테스트의 기존 준비 데이터는 유지한다.
      connection.rollback(savepoint);
      connection.releaseSavepoint(savepoint);
    }
  }
}
