package kr.ac.recycleyoungs.sales;

import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.jspecify.annotations.Nullable;

/** 요청 식별자를 유지하며 조건별 추정매출 미존재는 명시적인 data: null로 반환한다. */
public record SalesStatResponse(
    String dongCode, String quarterCode, String industryCode, @Nullable SalesData data) {

  /** 원천의 당월·주중·주말 의미와 BIGINT 정밀도를 보존하는 문자열 응답 계약. */
  public record SalesData(
      @Nullable String monthlySalesAmount,
      @Nullable String monthlySalesCount,
      @Nullable String weekdaySalesAmount,
      @Nullable String weekendSalesAmount,
      PublishedBatch sourceBatch) {}
}
