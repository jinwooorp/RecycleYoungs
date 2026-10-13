package com.example.backend.nearby;

import java.util.List;

public final class NearbyResponses {
    private NearbyResponses() {}
    public record Coordinate(double lat, double lng) {}
    public record Query(Coordinate coordinate, int radius, String industryCode) {}
    public record Store(String sourceStoreId, String name, Coordinate coordinate, double distanceMeters) {}
    public record Quality(String totalStoreCount, String cafeSourceCount, String usableCafeCount,
        String unclassifiedCafeCount, String missingLocationCafeCount, String invalidLocationCafeCount,
        String incompleteSourceCoordinateCafeCount) {}
    public record Data(String source, String sourceCategoryCode, String availability, String snapshotStatus,
        String referenceDate, String loadedAt, Quality quality) {}
    public record Result(Coordinate coordinate, String industryCode, int radiusMeters, String totalCount,
        int listedCount, int listLimit, boolean listComplete, List<Store> stores, Data data) {}
}
