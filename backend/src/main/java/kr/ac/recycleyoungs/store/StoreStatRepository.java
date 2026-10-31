package kr.ac.recycleyoungs.store;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import kr.ac.recycleyoungs.store.StoreStatResponse.StoreData;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** 각 통계 행의 실제 게시 출처를 검사하며 과거 정상 배치에 남은 분기도 보존한다. */
@Repository
@Profile("db")
public class StoreStatRepository {

  private static final String PUBLISHED_STORE_BATCH =
      """
      b.dataset_code = 'SEOUL_DONG_STORE_STAT' AND b.source_type = 'CSV'
        AND b.scope_type = 'SEOUL' AND b.scope_code IS NULL
        AND b.status = 'PUBLISHED' AND b.published_at IS NOT NULL
      """;

  private final JdbcClient jdbc;

  public StoreStatRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  /** 게시 이력만 있고 유효한 통계 행이 하나도 없으면 데이터셋 미준비로 판정한다. */
  public boolean hasPublishedData() {
    return jdbc.sql(
            """
        SELECT EXISTS (SELECT 1 FROM dong_store_stat s
          JOIN etl_batch b ON b.batch_id = s.source_batch_id WHERE
        """
                + PUBLISHED_STORE_BATCH
                + ")")
        .query(Boolean.class)
        .single();
  }

  public Optional<StoreData> findStores(String dongCode, String quarterCode, String industryCode) {
    // 전역 최신 배치 제한을 두면 ETL이 보존한 과거 분기가 사라진다. 출처별 정상 여부만 검사한다.
    return jdbc.sql(
            """
        SELECT s.store_count,s.general_store_count,s.franchise_store_count,
          s.opened_store_count,s.closed_store_count,
          CAST(s.opening_rate AS text) AS opening_rate,
          CAST(s.closure_rate AS text) AS closure_rate,
          b.batch_id,b.published_at
        FROM dong_store_stat s JOIN etl_batch b ON b.batch_id = s.source_batch_id
        WHERE s.dong_code = :dong AND s.quarter_code = :quarter AND s.industry_code = :industry
          AND
        """
                + PUBLISHED_STORE_BATCH)
        .param("dong", dongCode)
        .param("quarter", quarterCode)
        .param("industry", industryCode)
        .query(
            (rs, row) ->
                new StoreData(
                    // NUMERIC은 SQL에서 text로 변환해 JDBC 전송 형식에 따른 지수 표기 차이도 피한다.
                    // getLong/getDouble을 쓰지 않아 NULL과 0 및 십진 소수 정밀도를 보존한다.
                    rs.getString("store_count"),
                    rs.getString("general_store_count"),
                    rs.getString("franchise_store_count"),
                    rs.getString("opened_store_count"),
                    rs.getString("closed_store_count"),
                    rs.getString("opening_rate"),
                    rs.getString("closure_rate"),
                    new PublishedBatch(
                        rs.getObject("batch_id", UUID.class),
                        rs.getObject("published_at", OffsetDateTime.class))))
        .optional();
  }
}
