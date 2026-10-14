package com.example.backend.location;

import java.util.List;
import io.swagger.v3.oas.annotations.media.Schema;

public final class LocationResponses {
    private LocationResponses() {}

    @Schema(name = "LocationCoordinate", description = "EPSG:4326 좌표. lat 위도/lng 경도. 표시를 위한 반올림과 API 입력은 구분.")
    public record Coordinate(double lat, double lng) {}
    @Schema(description = "공간 dataset version과 원천/검증 metadata. version은 DB BIGINT의 문자열이며 역사적 호환성은 현재 UNRESOLVED.")
    public record DatasetVersion(String version, String datasetId, String datasetName, String sourceUrl,
        int sourceCrs, @Schema(types = {"string", "null"}, format = "date") String referenceDate, boolean referenceDateVerified,
        String historicalCompatibilityStatus, String validationStatus, String loadedAt) {}
    public record Dong(String code, String name, String datasetVersion, String qualityStatus,
        @Schema(types = {"string", "null"}) String qualityDetail,
        @Schema(allowableValues = {"INTERIOR", "BOUNDARY"}) String pointRelation) {}
    public record CommercialArea(String code, String name, String datasetVersion, String qualityStatus,
        @Schema(types = {"string", "null"}) String qualityDetail,
        @Schema(allowableValues = {"INTERIOR", "BOUNDARY"}) String pointRelation,
        @Schema(allowableValues = {"UNVERIFIED", "CONFLICT_OBSERVED"}) String sourceAttributeStatus,
        @Schema(types = {"string", "null"}, description = "홍지문 H5 등 source 속성 충돌을 숨기지 않음.") String sourceAttributeDetail) {}
    @Schema(description = "RESOLVED=1개, AMBIGUOUS_BOUNDARY=복수 후보 전부 반환, OUTSIDE_OR_UNSUPPORTED=0개/투영 미지원. 모호성도 HTTP 200.")
    public record AdminDongResult(
        @Schema(allowableValues = {"RESOLVED", "AMBIGUOUS_BOUNDARY", "OUTSIDE_OR_UNSUPPORTED"}) String status,
        @Schema(types = {"string", "null"}, description = "0개 match/투영 미지원은 NO_COVERING_OPERATIONAL_BOUNDARY, 그 외 null") String reason,
        @Schema(types = {"object", "null"}, description = "RESOLVED일 때만 객체, 그 외 null") Dong resolvedDong, List<Dong> candidates,
        DatasetVersion dataset) {}
    public record CommercialAreaResult(@Schema(allowableValues = {"MEMBERSHIP", "NO_MEMBERSHIP"}) String status,
        List<CommercialArea> memberships, DatasetVersion dataset) {}
    public record Resolution(Coordinate coordinate, AdminDongResult adminDong, CommercialAreaResult commercialArea) {}
}
