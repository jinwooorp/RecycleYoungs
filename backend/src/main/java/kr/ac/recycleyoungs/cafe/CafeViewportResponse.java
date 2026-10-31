package kr.ac.recycleyoungs.cafe;

import java.util.List;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.jspecify.annotations.Nullable;

/** 중심점이 없는 지도 영역 조회에는 거리를 포함하지 않고 반경 응답과 구분한다. */
public record CafeViewportResponse(
    List<Cafe> items,
    long totalCount,
    int limit,
    int offset,
    boolean hasMore,
    PublishedBatch sourceBatch) {

  public record Cafe(
      String bizesId,
      String storeName,
      @Nullable String branchName,
      String semasIndustryCode,
      String semasIndustryName,
      @Nullable String roadAddress,
      @Nullable String lotAddress,
      double longitude,
      double latitude) {}
}
