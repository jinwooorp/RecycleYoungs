package kr.ac.recycleyoungs.store;

import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.jspecify.annotations.Nullable;

/** 요청 식별자와 조건에 맞는 통계 한 건을 반환하며 미존재는 명시적인 data: null로 표현한다. */
public record StoreStatResponse(
    String dongCode, String quarterCode, String industryCode, @Nullable StoreData data) {

  /** BIGINT·NUMERIC은 문자열로 전송해 정밀도와 원본 NULL을 보존한다. */
  public record StoreData(
      @Nullable String storeCount,
      @Nullable String generalStoreCount,
      @Nullable String franchiseStoreCount,
      @Nullable String openedStoreCount,
      @Nullable String closedStoreCount,
      @Nullable String openingRate,
      @Nullable String closureRate,
      PublishedBatch sourceBatch) {}
}
