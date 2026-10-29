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

@SpringBootTest
@ActiveProfiles("db")
@Testcontainers
class PostgisMigrationIntegrationTests {

  @Container
  static final PostgreSQLContainer POSTGRES =
      new PostgreSQLContainer(
          DockerImageName.parse("postgis/postgis:17-3.5").asCompatibleSubstituteFor("postgres"));

  @DynamicPropertySource
  static void configureDatabase(DynamicPropertyRegistry registry) {
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
    assertThat(flyway.info().applied())
        .extracting(migration -> migration.getVersion().getVersion())
        .containsExactly("1", "2");
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
  void upgradesAnExistingV1SchemaWithoutChangingV1() {
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
            .filter(migration -> migration.getVersion() != null)
            .toList();
    assertThat(appliedMigrations)
        .extracting(migration -> migration.getVersion().getVersion())
        .containsExactly("1", "2");
    assertThat(appliedMigrations.getFirst().getChecksum()).isEqualTo(v1Checksum);
    v2.validate();
    assertThat(v2.migrate().migrationsExecuted).isZero();
  }

  @Test
  void createsCoreTablesWithPrimaryAndForeignKeys() throws Exception {
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
    insertBatch();
    assertRejected("UPDATE etl_batch SET " + assignment, "23514");
  }

  @ParameterizedTest
  @ValueSource(strings = {"etl_batch", "district", "administrative_dong", "service_industry"})
  void rejectsDuplicatePrimaryKeys(String table) throws Exception {
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
    insertCoreData();
    assertRejected("UPDATE " + assignment + " = '" + MISSING_BATCH_ID + "'", "23503");
  }

  @Test
  void rejectsMissingDistrictEvenWhenDongPrefixMatches() throws Exception {
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

  private void assertRejected(String sql, String sqlState) throws SQLException {
    var savepoint = connection.setSavepoint();
    try {
      assertThatThrownBy(() -> execute(sql))
          .as(sql)
          .isInstanceOfSatisfying(
              SQLException.class,
              exception -> assertThat(exception.getSQLState()).isEqualTo(sqlState));
    } finally {
      connection.rollback(savepoint);
      connection.releaseSavepoint(savepoint);
    }
  }
}
