package kr.ac.recycleyoungs.foottraffic;

import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.jspecify.annotations.Nullable;

/** 동·분기 식별자를 유지하며 통계 미존재는 data: null로 표현한다. */
public record FootTrafficStatResponse(
    String dongCode, String quarterCode, @Nullable FootTrafficData data) {

  /** NUMERIC의 정수·소수 정밀도와 NULL을 보존하며 성별 합계를 보정하지 않는다. */
  public record FootTrafficData(
      @Nullable String totalFootTraffic,
      @Nullable String maleFootTraffic,
      @Nullable String femaleFootTraffic,
      PublishedBatch sourceBatch) {}
}
