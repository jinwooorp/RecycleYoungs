package kr.ac.recycleyoungs.cafe;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.cafe.CafeResponse.Cafe;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.jspecify.annotations.Nullable;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** 서울 전체 정상 게시본과 실제 공간 조건으로 카페를 조회한다. */
@Repository
@Profile("db")
public class CafeRepository {

  private final JdbcClient jdbc;

  public CafeRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  public Optional<PublishedBatch> findLatestPublishedBatch() {
    // TEXT 출처가 잘못된 JSON이어도 SQL 오류가 나지 않도록 CASE 안에서만 jsonb로 변환한다.
    // 별도 AND 조건의 평가 순서에 의존하면 안전한 형 변환을 보장할 수 없다.
    return jdbc.sql(
            """
        SELECT batch_id, published_at FROM etl_batch
        WHERE dataset_code = 'SEMAS_CAFE_STORE' AND source_type = 'API'
          AND scope_type = 'SEOUL' AND scope_code IS NULL
          AND status = 'PUBLISHED' AND published_at IS NOT NULL
          AND CASE WHEN pg_input_is_valid(source_reference, 'jsonb')
            THEN source_reference::jsonb @>
              '{"collection_mode":"FULL_SEOUL","complete":true,"classification_verified":true}'::jsonb
            ELSE false END
        ORDER BY published_at DESC, started_at DESC, batch_id DESC LIMIT 1
        """)
        .query(
            (rs, row) ->
                new PublishedBatch(
                    rs.getObject("batch_id", UUID.class),
                    rs.getObject("published_at", OffsetDateTime.class)))
        .optional()
        // 최신 정상 게시본이 비었을 때 과거로 돌아가지 않는다. 좌표 없는 행도 준비된 데이터다.
        .filter(
            batch ->
                jdbc.sql("SELECT EXISTS (SELECT 1 FROM cafe_store WHERE source_batch_id = :batch)")
                    .param("batch", batch.batchId())
                    .query(Boolean.class)
                    .single());
  }

  public long countNearby(
      UUID cafeBatch,
      @Nullable UUID boundaryBatch,
      double longitude,
      double latitude,
      double radiusM,
      List<String> districtCodes) {
    return matching(
            "count(*)", cafeBatch, boundaryBatch, longitude, latitude, radiusM, districtCodes, "")
        .query(Long.class)
        .single();
  }

  public List<Cafe> findNearby(
      UUID cafeBatch,
      @Nullable UUID boundaryBatch,
      double longitude,
      double latitude,
      double radiusM,
      List<String> districtCodes,
      int limit,
      int offset) {
    return matching(
            """
        s.bizes_id, s.store_name, s.branch_name, s.semas_industry_code, s.semas_industry_name,
        s.road_address, s.lot_address, ST_X(s.geom) AS longitude, ST_Y(s.geom) AS latitude,
        ST_Distance(s.geom::geography,c.geom::geography) AS distance_m
        """,
            cafeBatch,
            boundaryBatch,
            longitude,
            latitude,
            radiusM,
            districtCodes,
            " ORDER BY distance_m, s.bizes_id LIMIT :limit OFFSET :offset")
        .param("limit", limit)
        .param("offset", offset)
        .query(
            (rs, row) ->
                new Cafe(
                    rs.getString("bizes_id"),
                    rs.getString("store_name"),
                    rs.getString("branch_name"),
                    rs.getString("semas_industry_code"),
                    rs.getString("semas_industry_name"),
                    rs.getString("road_address"),
                    rs.getString("lot_address"),
                    rs.getDouble("longitude"),
                    rs.getDouble("latitude"),
                    rs.getDouble("distance_m")))
        .list();
  }

  private JdbcClient.StatementSpec matching(
      String select,
      UUID cafeBatch,
      @Nullable UUID boundaryBatch,
      double longitude,
      double latitude,
      double radiusM,
      List<String> districtCodes,
      String suffix) {
    // 개수와 페이지에 같은 조건을 적용한다. geography 식은 V4의 GiST 인덱스와 일치한다.
    // 카페 점이 반경과 선택 구 안에 모두 있어야 한다. EXISTS는 경계의 중복과 동 FK 의존을 피한다.
    var filter =
        districtCodes.isEmpty()
            ? ""
            : """
        AND EXISTS (SELECT 1 FROM district d WHERE d.boundary_batch_id = :boundaryBatch
          AND d.district_code IN (:districtCodes) AND ST_Covers(d.geom,s.geom))
        """;
    var query =
        jdbc.sql(
                """
        WITH center AS (SELECT ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326) AS geom)
        SELECT
        """
                    + select
                    + " FROM cafe_store s CROSS JOIN center c "
                    + """
        WHERE s.source_batch_id = :cafeBatch AND s.geom IS NOT NULL
          AND ST_DWithin(s.geom::geography,c.geom::geography,:radiusM)
        """
                    + filter
                    + suffix)
            .param("cafeBatch", cafeBatch)
            .param("longitude", longitude)
            .param("latitude", latitude)
            .param("radiusM", radiusM);
    if (!districtCodes.isEmpty())
      query.param("boundaryBatch", boundaryBatch).param("districtCodes", districtCodes);
    return query;
  }
}
