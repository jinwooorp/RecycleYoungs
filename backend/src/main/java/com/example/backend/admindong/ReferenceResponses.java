package com.example.backend.admindong;

import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

public final class ReferenceResponses {
    private ReferenceResponses() {}
    @io.swagger.v3.oas.annotations.media.Schema(name="CurrentReferenceSource")
    public record Source(String sourceId,String snapshotId,String collectedAt,int recordCount,int rawRowCount,
        String sourceUrl,String policyVersion,JsonNode policy) {}
    @io.swagger.v3.oas.annotations.media.Schema(name="CurrentReferenceCatalog")
    public record Catalog(String referenceVersion,String temporalUnit,String observedAt,boolean scoreReady,
        List<Source> sources,DataPublication.Metadata metadata) {}
    @io.swagger.v3.oas.annotations.media.Schema(name="CurrentReferenceMetric")
    public record Metric(@io.swagger.v3.oas.annotations.media.Schema(types={"string","null"},description="정밀 십진 문자열. NULL은 원천 미제공 또는 보류") String value,String valueState,String unit) {}
    @io.swagger.v3.oas.annotations.media.Schema(name="CurrentReferenceRecord")
    public record Record(String recordId,Map<String,String> attributes,Map<String,String> attributeStates,
        Map<String,Metric> metrics,int sourceRowCount) {}
    @io.swagger.v3.oas.annotations.media.Schema(name="CurrentReferenceRecords")
    public record Records(String referenceVersion,Source source,int page,int pageSize,int total,
        List<Record> records,DataPublication.Metadata metadata) {}
}
