package com.example.backend.nearby;

import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

public final class NearbyResponses {
    private NearbyResponses() {}
    @Schema(name = "NearbyCoordinate", description = "EPSG:4326 좌표")
    public record Coordinate(double lat, double lng) {}
    public record Query(Coordinate coordinate, int radius, String industryCode) {}
    @Schema(name = "NearbyStore", description = "개별 SEMAS 점포. 거리 단위 m, 거리/ID 순 정렬. sourceStoreId는 원천 문자열 식별자.")
    public record Store(String sourceStoreId, @Schema(types = {"string", "null"}) String name, Coordinate coordinate, double distanceMeters) {}
    @Schema(name = "NearbyQuality", description = "각 건수는 정밀도 보존용 십진 정수 문자열. 누락/미분류/부적합 POINT 등의 자료 품질을 포함.")
    public record Quality(String totalStoreCount, String cafeSourceCount, String usableCafeCount,
        String unclassifiedCafeCount, String missingLocationCafeCount, String invalidLocationCafeCount,
        String incompleteSourceCoordinateCafeCount) {}
    @Schema(name = "NearbyData", description = "가용 자료만 조회하며 완전한 영업 snapshot을 보증하지 않음. 서울시 통계와 집계 시점이 다름.")
    public record Data(@Schema(allowableValues = {"SEMAS"}) String source,
        @Schema(allowableValues = {"I21201"}) String sourceCategoryCode,
        @Schema(allowableValues = {"AVAILABLE_RECORDS"}) String availability,
        @Schema(allowableValues = {"UNVERIFIED"}) String snapshotStatus,
        @Schema(types = {"string", "null"}, description = "현재 null: 원천 기준일 미검증") String referenceDate,
        @Schema(types = {"string", "null"}, description = "현재 null: snapshot 적재 catalog 없음") String loadedAt, Quality quality) {}
    @Schema(name = "NearbyStoresResult", description = "가용 자료에서 0개이면 totalCount=문자열 0/stores=[]. 미준비는 503. 최대 100개 목록과 전체 건수를 구분.")
    public record Result(Coordinate coordinate,
        @Schema(allowableValues = {"CAFE"}) String industryCode,
        @Schema(allowableValues = {"500"}, example = "500") int radiusMeters,
        @Schema(pattern = "^[0-9]+$", example = "0") String totalCount,
        int listedCount, @Schema(allowableValues = {"100"}, example = "100") int listLimit,
        boolean listComplete, List<Store> stores, Data data) {}
}
