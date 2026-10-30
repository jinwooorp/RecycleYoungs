package kr.ac.recycleyoungs.region;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.Dong;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyDistrict;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyDong;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.json.JsonMapper;

/** 선택한 게시 배치를 참조하는 현행 경계만 조회하며 공간 JSON은 PostGIS에서 생성한다. */
@Repository
@Profile("db")
public class RegionRepository {

  private final JdbcClient jdbc;
  private final JsonMapper jsonMapper;

  public RegionRepository(JdbcClient jdbc, JsonMapper jsonMapper) {
    this.jdbc = jdbc;
    this.jsonMapper = jsonMapper;
  }

  public Optional<PublishedBatch> findLatestPublishedBatch() {
    return jdbc.sql(
            """
        SELECT batch_id, published_at FROM etl_batch
        WHERE dataset_code = 'SEOUL_DONG_BOUNDARY' AND source_type = 'SHAPEFILE'
          AND scope_type = 'SEOUL' AND scope_code IS NULL
          AND status = 'PUBLISHED' AND published_at IS NOT NULL
        ORDER BY published_at DESC, started_at DESC, batch_id DESC LIMIT 1
        """)
        .query(
            (rs, row) ->
                new PublishedBatch(
                    rs.getObject("batch_id", UUID.class),
                    rs.getObject("published_at", OffsetDateTime.class)))
        .optional()
        // 최신 배치가 비었을 때 과거 게시본으로 돌아가지 않도록 LIMIT 이후에 확인한다.
        .filter(batch -> hasBoundaryRows(batch.batchId()));
  }

  /** 구·동 경계가 모두 없는 게시 이력을 정상 공간 검색의 빈 결과와 구분한다. */
  private boolean hasBoundaryRows(UUID batchId) {
    return jdbc.sql(
            """
        SELECT EXISTS (SELECT 1 FROM district WHERE boundary_batch_id = :batch)
          OR EXISTS (SELECT 1 FROM administrative_dong WHERE boundary_batch_id = :batch)
        """)
        .param("batch", batchId)
        .query(Boolean.class)
        .single();
  }

  public List<District> findDistricts(UUID batchId) {
    return jdbc.sql(
            """
        SELECT district_code, district_name FROM district
        WHERE boundary_batch_id = :batch ORDER BY district_code
        """)
        .param("batch", batchId)
        .query(
            (rs, row) -> new District(rs.getString("district_code"), rs.getString("district_name")))
        .list();
  }

  public Optional<District> findDistrict(UUID batchId, String districtCode) {
    return jdbc.sql(
            """
        SELECT district_code, district_name FROM district
        WHERE boundary_batch_id = :batch AND district_code = :code
        """)
        .param("batch", batchId)
        .param("code", districtCode)
        .query(
            (rs, row) -> new District(rs.getString("district_code"), rs.getString("district_name")))
        .optional();
  }

  public List<Dong> findDongs(UUID batchId, String districtCode) {
    return jdbc.sql(
            """
        SELECT a.dong_code, a.district_code, a.dong_name,
          ST_AsGeoJSON(a.label_point, 9, 0) AS label_point
        FROM administrative_dong a JOIN district d ON d.district_code = a.district_code
        WHERE a.boundary_batch_id = :batch AND d.boundary_batch_id = :batch
          AND a.district_code = :code ORDER BY a.dong_code
        """)
        .param("batch", batchId)
        .param("code", districtCode)
        .query(
            (rs, row) ->
                new Dong(
                    rs.getString("dong_code"),
                    rs.getString("district_code"),
                    rs.getString("dong_name"),
                    jsonMapper.readTree(rs.getString("label_point"))))
        .list();
  }

  public Optional<BoundaryRow> findDistrictBoundary(UUID batchId, String districtCode) {
    // V2가 SRID 4326을 강제한다. options=0은 GeoJSON에 별도 CRS 필드를 붙이지 않는다.
    return jdbc.sql(
            """
        SELECT district_code AS code, district_name AS name, district_code,
          ST_AsGeoJSON(geom, 9, 0) AS geometry
        FROM district WHERE boundary_batch_id = :batch AND district_code = :code
        """)
        .param("batch", batchId)
        .param("code", districtCode)
        .query(this::boundaryRow)
        .optional();
  }

  public Optional<BoundaryRow> findDongBoundary(UUID batchId, String dongCode) {
    return jdbc.sql(
            """
        SELECT a.dong_code AS code, a.dong_name AS name, a.district_code,
          ST_AsGeoJSON(a.geom, 9, 0) AS geometry
        FROM administrative_dong a JOIN district d ON d.district_code = a.district_code
        WHERE a.boundary_batch_id = :batch AND d.boundary_batch_id = :batch
          AND a.dong_code = :code
        """)
        .param("batch", batchId)
        .param("code", dongCode)
        .query(this::boundaryRow)
        .optional();
  }

  public List<NearbyDistrict> findNearbyDistricts(
      UUID batchId, double longitude, double latitude, double radiusM, List<String> districtCodes) {
    // geography 거리는 미터 단위다. geometry GiST가 이 캐스팅까지 지원한다고 가정하지 않는다.
    var filter = districtCodes.isEmpty() ? "" : " AND d.district_code IN (:districtCodes)";
    var query =
        jdbc.sql(
                """
        WITH center AS (SELECT ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326) AS geom)
        SELECT d.district_code, d.district_name, ST_Covers(d.geom, c.geom) AS contains_center
        FROM district d CROSS JOIN center c
        WHERE d.boundary_batch_id = :batch
          AND ST_DWithin(d.geom::geography,c.geom::geography,:radiusM)
        """
                    + filter
                    + " ORDER BY d.district_code")
            .param("batch", batchId)
            .param("longitude", longitude)
            .param("latitude", latitude)
            .param("radiusM", radiusM);
    if (!districtCodes.isEmpty()) query.param("districtCodes", districtCodes);
    return query
        .query(
            (rs, row) ->
                new NearbyDistrict(
                    rs.getString("district_code"),
                    rs.getString("district_name"),
                    rs.getBoolean("contains_center")))
        .list();
  }

  public List<NearbyDong> findNearbyDongs(
      UUID batchId, double longitude, double latitude, double radiusM, List<String> districtCodes) {
    // 구·동이 각각 반경에만 닿는 경우를 제외하려면 선택 구와 동의 실제 교집합 거리를 판정해야 한다.
    var filter =
        districtCodes.isEmpty()
            ? ""
            : """
         AND d.district_code IN (:districtCodes)
         AND ST_DWithin(ST_Intersection(a.geom,d.geom)::geography,c.geom::geography,:radiusM)
        """;
    var query =
        jdbc.sql(
                """
        WITH center AS (SELECT ST_SetSRID(ST_MakePoint(:longitude,:latitude),4326) AS geom)
        SELECT a.dong_code, a.district_code, a.dong_name, ST_Covers(a.geom,c.geom) AS contains_center
        FROM administrative_dong a JOIN district d ON d.district_code = a.district_code
        CROSS JOIN center c
        WHERE a.boundary_batch_id = :batch AND d.boundary_batch_id = :batch
          AND ST_DWithin(a.geom::geography,c.geom::geography,:radiusM)
        """
                    + filter
                    + " ORDER BY a.dong_code")
            .param("batch", batchId)
            .param("longitude", longitude)
            .param("latitude", latitude)
            .param("radiusM", radiusM);
    if (!districtCodes.isEmpty()) query.param("districtCodes", districtCodes);
    return query
        .query(
            (rs, row) ->
                new NearbyDong(
                    rs.getString("dong_code"),
                    rs.getString("district_code"),
                    rs.getString("dong_name"),
                    rs.getBoolean("contains_center")))
        .list();
  }

  private BoundaryRow boundaryRow(ResultSet rs, int row) throws SQLException {
    return new BoundaryRow(
        rs.getString("code"),
        rs.getString("name"),
        rs.getString("district_code"),
        rs.getString("geometry"));
  }

  /** 아직 직렬화하지 않은 PostGIS geometry JSON과 경계의 식별 정보를 전달한다. */
  record BoundaryRow(String code, String name, String districtCode, String geometry) {}
}
