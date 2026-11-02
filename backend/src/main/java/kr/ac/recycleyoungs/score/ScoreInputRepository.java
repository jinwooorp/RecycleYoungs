package kr.ac.recycleyoungs.score;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 호출자의 읽기 전용 REPEATABLE_READ에 참여하며 원본 입력을 단위별 SQL 한 번으로 읽는다. */
@Repository
@Profile("db")
@Transactional(
    readOnly = true,
    isolation = Isolation.REPEATABLE_READ,
    propagation = Propagation.MANDATORY)
public class ScoreInputRepository {
  private static final List<String> BATCH_FIELDS =
      List.of(
          "batch_id",
          "dataset_code",
          "source_type",
          "scope_type",
          "scope_code",
          "period_from",
          "period_to",
          "source_checksum",
          "etl_version",
          "status",
          "started_at",
          "finished_at",
          "published_at");
  private final JdbcClient jdbc;

  public ScoreInputRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public ScoreInputSnapshot findDistrictInputs(String quarterCode, String industryCode) {
    return findInputs(ScoreCalculation.RegionUnit.DISTRICT, quarterCode, industryCode);
  }

  public ScoreInputSnapshot findDongInputs(String quarterCode, String industryCode) {
    return findInputs(ScoreCalculation.RegionUnit.DONG, quarterCode, industryCode);
  }

  private ScoreInputSnapshot findInputs(
      ScoreCalculation.RegionUnit unit, String quarter, String industry) {
    // MANDATORY는 트랜잭션 없는 프록시 호출을 막는다. 기존 트랜잭션의 실제 속성도 확인하여
    // READ_COMMITTED·쓰기 트랜잭션에 묵시적으로 합류하거나 독립 스냅샷을 만드는 일을 막는다.
    if (!TransactionSynchronizationManager.isActualTransactionActive()
        || !TransactionSynchronizationManager.isCurrentTransactionReadOnly()
        || !Objects.equals(
            TransactionSynchronizationManager.getCurrentTransactionIsolationLevel(),
            java.sql.Connection.TRANSACTION_REPEATABLE_READ)) {
      throw new IllegalStateException("점수 입력 조회에는 상위 읽기 전용 REPEATABLE_READ 트랜잭션이 필요합니다.");
    }
    Objects.requireNonNull(quarter, "quarterCode");
    Objects.requireNonNull(industry, "industryCode");
    String datasetUnit = unit == ScoreCalculation.RegionUnit.DISTRICT ? "DISTRICT" : "DONG";
    var rows =
        jdbc.sql(query(unit))
            .param("quarter", quarter)
            .param("industry", industry)
            .param("storeDataset", "SEOUL_" + datasetUnit + "_STORE_STAT")
            .param("salesDataset", "SEOUL_" + datasetUnit + "_SALES_STAT")
            .param("footDataset", "SEOUL_" + datasetUnit + "_FOOT_TRAFFIC_STAT")
            .query(
                (rs, row) ->
                    new SnapshotRow(
                        batch(rs, "boundary"),
                        rs.getBoolean("boundary_rows"),
                        new ScoreInputSnapshot.DatasetReadiness(
                            rs.getBoolean("stores_ready"),
                            rs.getBoolean("sales_ready"),
                            rs.getBoolean("foot_ready")),
                        region(rs)))
            .list();
    // anchor가 경계·지역 부재에도 한 행을 반환하므로 빈 최신 게시본의 메타데이터를 잃지 않는다.
    var first = rows.getFirst();
    return new ScoreInputSnapshot(
        unit,
        quarter,
        industry,
        first.boundary(),
        first.boundaryRowsPresent(),
        first.readiness(),
        rows.stream().map(SnapshotRow::region).filter(Objects::nonNull).toList());
  }

  private static String query(ScoreCalculation.RegionUnit unit) {
    // 식별자는 고정 enum에서만 고른다. 분기·업종·데이터셋 값은 모두 바인딩한다.
    String prefix = unit == ScoreCalculation.RegionUnit.DISTRICT ? "district" : "dong";
    String key = prefix + "_code";
    String cohort =
        unit == ScoreCalculation.RegionUnit.DISTRICT
            ? """
        SELECT d.district_code AS region_code,d.district_name AS region_name,
          d.district_code,d.district_name
        FROM district d JOIN latest_boundary b ON b.batch_id=d.boundary_batch_id
        """
            : """
        SELECT a.dong_code AS region_code,a.dong_name AS region_name,d.district_code,d.district_name
        FROM administrative_dong a JOIN district d ON d.district_code=a.district_code
        JOIN latest_boundary b ON b.batch_id=a.boundary_batch_id AND b.batch_id=d.boundary_batch_id
        """;
    return """
        WITH latest_boundary AS (
          SELECT %s FROM etl_batch
          WHERE dataset_code='SEOUL_DONG_BOUNDARY' AND source_type='SHAPEFILE'
            AND scope_type='SEOUL' AND scope_code IS NULL AND status='PUBLISHED' AND published_at IS NOT NULL
          ORDER BY published_at DESC,started_at DESC,batch_id DESC LIMIT 1
        ), cohort AS (%s)
        SELECT %s,%s,%s,%s,
          (EXISTS(SELECT 1 FROM district WHERE boundary_batch_id=b.batch_id)
           OR EXISTS(SELECT 1 FROM administrative_dong WHERE boundary_batch_id=b.batch_id)) AS boundary_rows,
          %s AS stores_ready,%s AS sales_ready,%s AS foot_ready,
          r.region_code,r.region_name,r.district_code,r.district_name,
          s.%s IS NOT NULL AS stores_present,s.source_batch_id AS stores_source_id,
          a.%s IS NOT NULL AS sales_present,a.source_batch_id AS sales_source_id,
          f.%s IS NOT NULL AS foot_present,f.source_batch_id AS foot_source_id,
          COALESCE(%s,FALSE) AS stores_eligible,
          COALESCE(%s,FALSE) AS sales_eligible,
          COALESCE(%s,FALSE) AS foot_eligible,
          CAST(s.store_count AS text) AS store_count,CAST(s.closure_rate AS text) AS closure_rate,
          CAST(a.monthly_sales_amount AS text) AS sales,CAST(f.total_foot_traffic AS text) AS foot
        FROM (VALUES(1)) anchor(dummy)
        LEFT JOIN latest_boundary b ON TRUE LEFT JOIN cohort r ON TRUE
        LEFT JOIN %s_store_stat s ON s.%s=r.region_code AND s.quarter_code=:quarter AND s.industry_code=:industry
        LEFT JOIN %s_sales_stat a ON a.%s=r.region_code AND a.quarter_code=:quarter AND a.industry_code=:industry
        LEFT JOIN %s_foot_traffic_stat f ON f.%s=r.region_code AND f.quarter_code=:quarter
        LEFT JOIN etl_batch bs ON bs.batch_id=s.source_batch_id
        LEFT JOIN etl_batch ba ON ba.batch_id=a.source_batch_id
        LEFT JOIN etl_batch bf ON bf.batch_id=f.source_batch_id
        ORDER BY r.region_code
        """
        .formatted(
            String.join(",", BATCH_FIELDS),
            cohort,
            batchColumns("b", "boundary"),
            batchColumns("bs", "stores"),
            batchColumns("ba", "sales"),
            batchColumns("bf", "foot"),
            readiness(prefix + "_store_stat", "storeDataset"),
            readiness(prefix + "_sales_stat", "salesDataset"),
            readiness(prefix + "_foot_traffic_stat", "footDataset"),
            key,
            key,
            key,
            published("bs", "storeDataset"),
            published("ba", "salesDataset"),
            published("bf", "footDataset"),
            prefix,
            key,
            prefix,
            key,
            prefix,
            key);
  }

  /** 정상 게시 검증은 전역 최신 통계 배치가 아닌 실제 행이 참조한 배치에만 적용한다. */
  private static String published(String alias, String datasetParameter) {
    return """
        (%1$s.dataset_code=:%2$s AND %1$s.source_type='CSV' AND %1$s.scope_type='SEOUL'
          AND %1$s.scope_code IS NULL AND %1$s.status='PUBLISHED' AND %1$s.published_at IS NOT NULL)
        """
        .formatted(alias, datasetParameter);
  }

  private static String readiness(String table, String datasetParameter) {
    return "EXISTS(SELECT 1 FROM "
        + table
        + " t JOIN etl_batch rb ON rb.batch_id=t.source_batch_id WHERE "
        + published("rb", datasetParameter)
        + ")";
  }

  private static String batchColumns(String alias, String prefix) {
    return String.join(
        ",",
        BATCH_FIELDS.stream()
            .map(field -> alias + "." + field + " AS " + prefix + "_" + field)
            .toList());
  }

  private static ScoreInputSnapshot.BatchMetadata batch(ResultSet rs, String prefix)
      throws SQLException {
    UUID id = rs.getObject(prefix + "_batch_id", UUID.class);
    if (id == null) return null;
    return new ScoreInputSnapshot.BatchMetadata(
        id,
        rs.getString(prefix + "_dataset_code"),
        rs.getString(prefix + "_source_type"),
        rs.getString(prefix + "_scope_type"),
        rs.getString(prefix + "_scope_code"),
        rs.getString(prefix + "_period_from"),
        rs.getString(prefix + "_period_to"),
        rs.getString(prefix + "_source_checksum"),
        rs.getString(prefix + "_etl_version"),
        rs.getString(prefix + "_status"),
        rs.getObject(prefix + "_started_at", OffsetDateTime.class),
        rs.getObject(prefix + "_finished_at", OffsetDateTime.class),
        rs.getObject(prefix + "_published_at", OffsetDateTime.class));
  }

  private static ScoreInputSnapshot.RowSource source(ResultSet rs, String prefix)
      throws SQLException {
    return new ScoreInputSnapshot.RowSource(
        rs.getBoolean(prefix + "_present"),
        rs.getObject(prefix + "_source_id", UUID.class),
        batch(rs, prefix),
        rs.getBoolean(prefix + "_eligible"));
  }

  private static ScoreInputSnapshot.RegionInput region(ResultSet rs) throws SQLException {
    String code = rs.getString("region_code");
    if (code == null) return null;
    var stores = source(rs, "stores");
    return new ScoreInputSnapshot.RegionInput(
        code,
        rs.getString("region_name"),
        rs.getString("district_code"),
        rs.getString("district_name"),
        new ScoreInputSnapshot.RawValue(rs.getString("sales"), source(rs, "sales")),
        new ScoreInputSnapshot.RawValue(rs.getString("foot"), source(rs, "foot")),
        new ScoreInputSnapshot.RawValue(rs.getString("store_count"), stores),
        new ScoreInputSnapshot.RawValue(rs.getString("closure_rate"), stores));
  }

  private record SnapshotRow(
      ScoreInputSnapshot.BatchMetadata boundary,
      boolean boundaryRowsPresent,
      ScoreInputSnapshot.DatasetReadiness readiness,
      ScoreInputSnapshot.RegionInput region) {}
}
