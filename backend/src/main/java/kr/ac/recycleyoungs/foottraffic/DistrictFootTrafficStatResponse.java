package kr.ac.recycleyoungs.foottraffic;

import kr.ac.recycleyoungs.foottraffic.FootTrafficStatResponse.FootTrafficData;
import org.jspecify.annotations.Nullable;

/** 자치구·분기 식별자를 유지하고 세 NUMERIC 측정값·출처는 기존 유동인구 계약을 공유한다. */
public record DistrictFootTrafficStatResponse(
    String districtCode, String quarterCode, @Nullable FootTrafficData data) {}
