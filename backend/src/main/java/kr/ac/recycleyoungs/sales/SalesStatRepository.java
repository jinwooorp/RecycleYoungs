package kr.ac.recycleyoungs.sales;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import kr.ac.recycleyoungs.sales.SalesStatResponse.SalesData;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** 행별 정상 게시 출처를 검사하고 과거 분기의 원본 추정매출을 그대로 조회한다. */
@Repository
@Profile("db")
public class SalesStatRepository {

  private static final String PUBLISHED_SALES_BATCH =
      """
      b.dataset_code = 'SEOUL_DONG_SALES_STAT' AND b.source_type = 'CSV'
        AND b.scope_type = 'SEOUL' AND b.scope_code IS NULL
        AND b.status = 'PUBLISHED' AND b.published_at IS NOT NULL
      """;

  private final JdbcClient jdbc;

  public SalesStatRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  /** 게시 이력만 있고 유효 통계 행이 전혀 없으면 데이터셋 미준비로 구분한다. */
  public boolean hasPublishedData() {
    return jdbc.sql(
            """
        SELECT EXISTS (SELECT 1 FROM dong_sales_stat s
          JOIN etl_batch b ON b.batch_id = s.source_batch_id WHERE
        """
                + PUBLISHED_SALES_BATCH
                + ")")
        .query(Boolean.class)
        .single();
  }

  public Optional<SalesData> findSales(String dongCode, String quarterCode, String industryCode) {
    // 전역 최신 배치로 제한하면 ETL이 유지한 과거 분기를 잃으므로 행별 출처만 검증한다.
    return jdbc.sql(
            """
        SELECT s.monthly_sales_amount,s.monthly_sales_count,
          s.weekday_sales_amount,s.weekend_sales_amount,b.batch_id,b.published_at
        FROM dong_sales_stat s JOIN etl_batch b ON b.batch_id = s.source_batch_id
        WHERE s.dong_code = :dong AND s.quarter_code = :quarter AND s.industry_code = :industry
          AND
        """
                + PUBLISHED_SALES_BATCH)
        .param("dong", dongCode)
        .param("quarter", quarterCode)
        .param("industry", industryCode)
        .query(
            (rs, row) ->
                new SalesData(
                    // getLong/getDouble을 사용하지 않아 NULL·실제 0·BIGINT 최댓값을 구분한다.
                    // 당월 값을 환산하거나 전체·주중·주말 합계를 보정하지 않는다.
                    rs.getString("monthly_sales_amount"),
                    rs.getString("monthly_sales_count"),
                    rs.getString("weekday_sales_amount"),
                    rs.getString("weekend_sales_amount"),
                    new PublishedBatch(
                        rs.getObject("batch_id", UUID.class),
                        rs.getObject("published_at", OffsetDateTime.class))))
        .optional();
  }
}
