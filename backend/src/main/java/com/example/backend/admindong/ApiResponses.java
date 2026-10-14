package com.example.backend.admindong;

import io.swagger.v3.oas.annotations.media.Schema;

public final class ApiResponses {
    private ApiResponses() {}

    @Schema(description = "lookup의 문자열 코드 및 이름. 내부 DB id를 외부 코드로 사용하지 않음.")
    public record NamedCode(String code, String name) {}
    public record Quarter(@Schema(description = "YYYYQ 분기 코드", example = "20251") String code, String label) {}
    @Schema(description = "점포 건수는 JSON 정수. 개별 NULL은 null, 실제 0은 0.")
    public record StoreStats(
        @Schema(types = {"integer", "null"}, format = "int32") Integer storeCount,
        @Schema(types = {"integer", "null"}, format = "int32") Integer similarStoreCount,
        @Schema(types = {"integer", "null"}, format = "int32") Integer openingStoreCount,
        @Schema(types = {"integer", "null"}, format = "int32") Integer closingStoreCount,
        @Schema(types = {"integer", "null"}, format = "int32") Integer franchiseStoreCount) {}
    @Schema(description = "BIGINT 정밀도 보존용 십진 정수 문자열. 매출 단위 원, 거래건수 단위 건. 개별 NULL은 null, 실제 0은 문자열 0.")
    public record SalesStats(
        @Schema(types = {"string", "null"}, pattern = "^-?[0-9]+$", example = "9007199254740993") String estimatedSalesAmount,
        @Schema(types = {"string", "null"}, pattern = "^-?[0-9]+$") String transactionCount,
        @Schema(types = {"string", "null"}, pattern = "^-?[0-9]+$") String weekdayEstimatedSalesAmount,
        @Schema(types = {"string", "null"}, pattern = "^-?[0-9]+$") String weekendEstimatedSalesAmount) {}
    @Schema(description = "해당 집계 행 부재일 때 NO_ROW, 행이 존재하면 null. 개별 필드 NULL/정상 0과 구분.")
    public record MissingReasons(
        @Schema(types = {"string", "null"}, description = "NO_ROW 또는 null") String storeStats,
        @Schema(types = {"string", "null"}, description = "NO_ROW 또는 null") String salesStats) {}
    public record Stats(NamedCode dong, NamedCode industry, Quarter quarter,
        @Schema(types = {"object", "null"}, description = "행 부재 시 null/NO_ROW") StoreStats storeStats,
        @Schema(types = {"object", "null"}, description = "행 부재 시 null/NO_ROW") SalesStats salesStats,
        MissingReasons missingReasons) {}
    public record TrendQuarter(Quarter quarter,
        @Schema(types = {"object", "null"}) StoreStats storeStats,
        @Schema(types = {"object", "null"}) SalesStats salesStats, MissingReasons missingReasons) {}
    @Schema(description = "20251~20254 고정 4개 분기 오름차순. 누락 분기를 제거하지 않음.")
    public record Trend(NamedCode dong, NamedCode industry, java.util.List<TrendQuarter> quarters) {}
    @Schema(name = "ApiError", description = "공통 오류 {code,message,field}. 400은 오류 query 이름, 500/503은 field=null. 내부 SQL/접속정보를 노출하지 않음.")
    public record Error(String code, String message, @Schema(types = {"string", "null"}) String field) {}
}
