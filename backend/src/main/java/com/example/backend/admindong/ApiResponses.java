package com.example.backend.admindong;

public final class ApiResponses {
    private ApiResponses() {}

    public record NamedCode(String code, String name) {}
    public record Quarter(String code, String label) {}
    public record StoreStats(Integer storeCount, Integer similarStoreCount, Integer openingStoreCount,
                             Integer closingStoreCount, Integer franchiseStoreCount) {}
    public record SalesStats(String estimatedSalesAmount, String transactionCount,
                             String weekdayEstimatedSalesAmount, String weekendEstimatedSalesAmount) {}
    public record MissingReasons(String storeStats, String salesStats) {}
    public record Stats(NamedCode dong, NamedCode industry, Quarter quarter,
                        StoreStats storeStats, SalesStats salesStats, MissingReasons missingReasons) {}
    public record Error(String code, String message, String field) {}
}
