package kr.ac.recycleyoungs.foottraffic;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.foottraffic.FootTrafficStatResponse.FootTrafficData;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** 유동인구의 행별 정상 게시 출처를 검사하며 과거 정상 분기의 값과 소수 자릿수를 보존한다. */
@Repository
@Profile("db")
public class FootTrafficStatRepository {

  private static final String PUBLISHED_FOOT_TRAFFIC_BATCH =
      """
      b.dataset_code = 'SEOUL_DONG_FOOT_TRAFFIC_STAT' AND b.source_type = 'CSV'
        AND b.scope_type = 'SEOUL' AND b.scope_code IS NULL
        AND b.status = 'PUBLISHED' AND b.published_at IS NOT NULL
      """;

  private final JdbcClient jdbc;

  public FootTrafficStatRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  /** 정상 게시 이력뿐 아니라 그 출처를 참조하는 실제 통계 행이 있어야 준비 완료다. */
  public boolean hasPublishedData() {
    return jdbc.sql(
            """
        SELECT EXISTS (SELECT 1 FROM dong_foot_traffic_stat s
          JOIN etl_batch b ON b.batch_id = s.source_batch_id WHERE
        """
                + PUBLISHED_FOOT_TRAFFIC_BATCH
                + ")")
        .query(Boolean.class)
        .single();
  }

  public Optional<FootTrafficData> findFootTraffic(String dongCode, String quarterCode) {
    // 최신 배치만 강제하면 ETL이 보존한 과거 분기를 잃으므로 각 행의 출처를 검증한다.
    // SQL text 변환은 JDBC 바이너리 전송·지수 표기의 차이를 피하고 NUMERIC scale도 유지한다.
    return jdbc.sql(
            """
        SELECT CAST(s.total_foot_traffic AS text) AS total_foot_traffic,
          CAST(s.male_foot_traffic AS text) AS male_foot_traffic,
          CAST(s.female_foot_traffic AS text) AS female_foot_traffic,
          b.batch_id,b.published_at
        FROM dong_foot_traffic_stat s JOIN etl_batch b ON b.batch_id = s.source_batch_id
        WHERE s.dong_code = :dong AND s.quarter_code = :quarter AND
        """
                + PUBLISHED_FOOT_TRAFFIC_BATCH)
        .param("dong", dongCode)
        .param("quarter", quarterCode)
        .query(
            (rs, row) ->
                new FootTrafficData(
                    rs.getString("total_foot_traffic"),
                    rs.getString("male_foot_traffic"),
                    rs.getString("female_foot_traffic"),
                    new PublishedBatch(
                        rs.getObject("batch_id", UUID.class),
                        rs.getObject("published_at", OffsetDateTime.class))))
        .optional();
  }
}
