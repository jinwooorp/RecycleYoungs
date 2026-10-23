package com.example.backend.admindong;

import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.annotation.JsonInclude;

public final class ContextResponses {
    private ContextResponses() {}
    public record Metric(String value, String valueState, String unit, String temporalAggregation) {}
    public record Provenance(String sourceId, String datasetId, String sourceUrl, String runId,
        String sourceQuarter, String observedAt, String collectedAt, String refreshModel) {}
    public record Section(String state, List<String> reasonCodes, Map<String,Metric> metrics,
        Map<String,String> attributes, Provenance provenance, String spatialCompatibility, boolean scoreReady) {}
    public record Context(ApiResponses.NamedCode dong, ApiResponses.Quarter quarter, String spatialUnit,
        String contextPolicyVersion, Map<String,Section> sections,
        @JsonInclude(JsonInclude.Include.NON_NULL) DataPublication.Metadata metadata) {}
    public record Totals(String estimatedSalesAmount, String transactionCount) {}
    public record SalesItem(String code, String estimatedSalesAmount, String transactionCount) {}
    public record Sales(Totals totals, List<SalesItem> dayTypes, List<SalesItem> weekdays,
        List<SalesItem> timeSlots, List<SalesItem> sexes, List<SalesItem> ages) {}
    public record Breakdown(ApiResponses.NamedCode dong, ApiResponses.NamedCode industry, ApiResponses.Quarter quarter,
        Sales sales, String missingReason,
        @JsonInclude(JsonInclude.Include.NON_NULL) DataPublication.Metadata metadata) {}
}
