package kr.ac.recycleyoungs.store;

import kr.ac.recycleyoungs.store.StoreStatResponse.StoreData;
import org.jspecify.annotations.Nullable;

/** 공식 자치구 원천의 식별자를 반환하고 7개 측정값·출처 형식은 기존 점포 응답과 공유한다. */
public record DistrictStoreStatResponse(
    String districtCode, String quarterCode, String industryCode, @Nullable StoreData data) {}
