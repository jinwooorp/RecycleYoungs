package kr.ac.recycleyoungs.sales;

import kr.ac.recycleyoungs.sales.SalesStatResponse.SalesData;
import org.jspecify.annotations.Nullable;

/** 공식 자치구 식별자를 유지하고 네 측정값·출처는 기존 매출 응답 계약을 공유한다. */
public record DistrictSalesStatResponse(
    String districtCode, String quarterCode, String industryCode, @Nullable SalesData data) {}
