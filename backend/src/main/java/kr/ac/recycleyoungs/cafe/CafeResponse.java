package kr.ac.recycleyoungs.cafe;

import java.util.List;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.jspecify.annotations.Nullable;

/** 주변 카페와 페이징·게시 출처만 공개하며 ETL 내부 메타데이터는 포함하지 않는다. */
public record CafeResponse(
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
      double latitude,
      double distanceM) {}
}
