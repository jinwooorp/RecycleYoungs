package com.example.backend.location;

import java.util.List;

public final class LocationResponses {
    private LocationResponses() {}

    public record Coordinate(double lat, double lng) {}
    public record DatasetVersion(String version, String datasetId, String datasetName, String sourceUrl,
        int sourceCrs, String referenceDate, boolean referenceDateVerified,
        String historicalCompatibilityStatus, String validationStatus, String loadedAt) {}
    public record Dong(String code, String name, String datasetVersion, String qualityStatus,
        String qualityDetail, String pointRelation) {}
    public record CommercialArea(String code, String name, String datasetVersion, String qualityStatus,
        String qualityDetail, String pointRelation, String sourceAttributeStatus, String sourceAttributeDetail) {}
    public record AdminDongResult(String status, String reason, Dong resolvedDong, List<Dong> candidates,
        DatasetVersion dataset) {}
    public record CommercialAreaResult(String status, List<CommercialArea> memberships, DatasetVersion dataset) {}
    public record Resolution(Coordinate coordinate, AdminDongResult adminDong, CommercialAreaResult commercialArea) {}
}
