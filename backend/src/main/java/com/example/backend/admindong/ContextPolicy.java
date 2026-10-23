package com.example.backend.admindong;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.math.BigDecimal;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

final class ContextPolicy {
    private static final JsonNode DOCUMENT = load();
    private ContextPolicy() {}
    private static JsonNode load() {
        try (var stream=ContextPolicy.class.getResourceAsStream("/contracts/admin-dong-context-policy-v1.json")) {
            if (stream==null) throw new IllegalStateException("Context policy missing");
            return JsonMapper.builder().build().readTree(stream);
        } catch (java.io.IOException ex) { throw new IllegalStateException("Context policy unreadable",ex); }
    }
    static JsonNode document() { return DOCUMENT.deepCopy(); }
    static String version() { return DOCUMENT.path("version").asText(); }
    static List<String> keys() {
        return List.of("population","residents","workers","facilities","change","consumption");
    }
    static ContextResponses.Section project(String key, String state, String runId, String period,
            String collectedAt, Map<String,String> raw, Map<String,String> attributes) {
        if (!keys().contains(key)) throw new DataIntegrityException();
        var spec=DOCUMENT.path("policy").path("sections").path(key);
        if (!List.of("REFERENCE","NO_ROW","NO_PERIOD","WITHHELD").contains(state)
            || key.equals("consumption")!=state.equals("WITHHELD")) throw new DataIntegrityException();
        boolean reported=state.equals("REFERENCE");
        if (reported && (raw==null || attributes==null)) throw new DataIntegrityException();
        Map<String,ContextResponses.Metric> metrics=reported?new LinkedHashMap<>():null;
        Map<String,String> projectedAttributes=reported?new LinkedHashMap<>():null;
        if (reported) {
            for (var field:spec.path("fields")) {
                var name=field.asText();
                if (!raw.containsKey(name)) throw new DataIntegrityException();
                String value=raw.get(name);
                if (value!=null && (!value.matches("(0|[1-9][0-9]*)(\\.[0-9]{1,12})?")
                    || new BigDecimal(value).compareTo(new BigDecimal("9223372036854775807"))>0)) throw new DataIntegrityException();
                String unit=name.equals("TOT_HSHLD_CO")?"HOUSEHOLD":key.equals("facilities")?"FACILITY":key.equals("change")?"MONTH":"PERSON";
                metrics.put(name,new ContextResponses.Metric(value,value==null?"SOURCE_NULL":"REPORTED",unit,
                    spec.path("temporal_aggregation").asText()));
            }
            for (var field:spec.path("attributes")) {
                if (!attributes.containsKey(field.asText())) throw new DataIntegrityException();
                projectedAttributes.put(field.asText(),attributes.get(field.asText()));
            }
            if (key.equals("change")) {
                String code=attributes.get("TRDAR_CHNGE_IX"),name=attributes.get("TRDAR_CHNGE_IX_NM");
                if (code==null || name==null || !Map.of("LL","다이나믹","LH","상권확장","HL","상권축소","HH","정체")
                    .getOrDefault(code,"").equals(name)) throw new DataIntegrityException();
            }
        }
        var reasons=new ArrayList<String>(); spec.path("reason_codes").forEach(v->reasons.add(v.asText()));
        return new ContextResponses.Section(state,reasons,metrics,projectedAttributes,
            new ContextResponses.Provenance(spec.path("source_id").asText(),spec.path("dataset_id").asText(),
                spec.path("source_url").asText(),runId,reported?period:null,null,collectedAt,spec.path("refresh_model").asText()),
            "HISTORICAL_UNVERIFIED",false);
    }
}
