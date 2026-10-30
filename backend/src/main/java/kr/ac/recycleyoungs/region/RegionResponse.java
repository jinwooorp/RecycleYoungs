package kr.ac.recycleyoungs.region;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** 행정구역 목록과 WGS84 GeoJSON 경계 응답의 데이터 계약. */
public final class RegionResponse {

  private RegionResponse() {}

  public record District(String districtCode, String districtName) {}

  public record Dong(String dongCode, String districtCode, String dongName, JsonNode labelPoint) {}

  public record DistrictList(List<District> items) {}

  public record DongList(List<Dong> items) {}

  public record NearbyDistrict(String districtCode, String districtName, boolean containsCenter) {}

  public record NearbyDong(
      String dongCode, String districtCode, String dongName, boolean containsCenter) {}

  public record NearbyRegions(
      PublishedBatch boundaryBatch, List<NearbyDistrict> districts, List<NearbyDong> dongs) {}

  public record PublishedBatch(UUID batchId, OffsetDateTime publishedAt) {}

  public record BoundaryProperties(
      String regionType,
      String regionCode,
      String regionName,
      String districtCode,
      PublishedBatch boundaryBatch) {}

  public record BoundaryFeature(
      String type, String id, JsonNode geometry, BoundaryProperties properties) {}
}
