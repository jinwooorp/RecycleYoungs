package com.example.backend.admindong;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

final class ReferencePolicy {
    private static final JsonNode DOCUMENT=load();
    private ReferencePolicy() {}
    private static JsonNode load() {
        try (var stream=ReferencePolicy.class.getResourceAsStream("/contracts/current-reference-policy-v1.json")) {
            if (stream==null) throw new IllegalStateException("Reference policy missing");
            return JsonMapper.builder().build().readTree(stream);
        } catch (java.io.IOException ex) { throw new IllegalStateException("Reference policy unreadable",ex); }
    }
    static Set<String> sources() { return Set.of("seoul-bus-stops","seoul-public-parking","seoul-metro-leases"); }
    static String version(Map<String,String> snapshots) {
        if (!snapshots.keySet().equals(sources()) || snapshots.values().stream().anyMatch(v->v==null || !v.matches("[0-9a-f]{64}"))) throw new DataIntegrityException();
        String canonical="SEOUL_CURRENT_REFERENCE_V1\n"+snapshots.keySet().stream().sorted().map(s->s+":"+snapshots.get(s)).collect(java.util.stream.Collectors.joining("\n"));
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException ex) { throw new IllegalStateException(ex); }
    }
    static ReferenceResponses.Source source(ReferenceRepository.SourceRow row) {
        if (!sources().contains(row.sourceId()) || !row.snapshotId().matches("[0-9a-f]{64}") || !"READY".equals(row.status())
            || row.recordCount()<1 || row.recordCount()>50000 || row.rawRowCount()<row.recordCount() || row.rawRowCount()>50000) throw new DataIntegrityException();
        var doc=AdminDongContextRepository.parse(row.descriptor()); var spec=DOCUMENT.path("sources").path(row.sourceId());
        if (!doc.path("source").asText().equals(row.sourceId()) || !doc.path("snapshot_id").asText().equals(row.snapshotId())
            || !doc.path("policy").equals(spec.path("policy")) || !doc.path("policy_version").equals(spec.path("version"))
            || !doc.path("complete").isBoolean() || !doc.path("complete").asBoolean() || !doc.path("published").isBoolean() || doc.path("published").asBoolean()
            || !doc.path("status").asText().equals("COLLECTED_UNPUBLISHED") || doc.path("received_count").asInt()!=row.rawRowCount()
            || doc.path("declared_count").asInt()!=row.rawRowCount() || doc.path("record_count").asInt(row.rawRowCount())!=row.recordCount()) throw new DataIntegrityException();
        String stamp=doc.path("collected_at").asText();
        try { java.time.OffsetDateTime.parse(stamp); } catch (RuntimeException ex) { throw new DataIntegrityException(); }
        return new ReferenceResponses.Source(row.sourceId(),row.snapshotId(),stamp,row.recordCount(),row.rawRowCount(),
            "https://data.seoul.go.kr/dataList/"+spec.path("policy").path("datasetId").asText()+"/A/1/datasetView.do",
            spec.path("version").asText(),spec.path("policy").deepCopy());
    }
    private static Set<String> fields(JsonNode node) {
        if (!node.isObject()) throw new DataIntegrityException();
        var result=new HashSet<String>(); node.properties().forEach(e->result.add(e.getKey()));return result;
    }
    private static Set<String> names(JsonNode node) {
        var result=new HashSet<String>();node.forEach(v->result.add(v.asText()));return result;
    }
    static ReferenceResponses.Record record(String source,ReferenceRepository.RecordRow row) {
        if (!sources().contains(source) || row.recordId()==null || row.recordId().isBlank() || row.recordId().length()>200
            || row.sourceRowCount()<1 || (!source.equals("seoul-public-parking") && row.sourceRowCount()!=1)) throw new DataIntegrityException();
        var policy=DOCUMENT.path("sources").path(source).path("policy");
        var attributes=AdminDongContextRepository.parse(row.attributes());var states=AdminDongContextRepository.parse(row.attributeStates());
        var metrics=AdminDongContextRepository.parse(row.metrics());
        if (!fields(attributes).equals(names(policy.path("publishedAttributes"))) || !fields(states).equals(fields(attributes))
            || !fields(metrics).equals(names(policy.path("publishedMetrics")))) throw new DataIntegrityException();
        var out=new LinkedHashMap<String,String>();var stateOut=new LinkedHashMap<String,String>();
        attributes.properties().forEach(e->{
            var value=e.getValue();String state=states.path(e.getKey()).asText();
            if (state.equals("REPORTED") ? !value.isString() || value.asText().length()>2000 :
                !value.isNull() || !(state.equals("SOURCE_NULL") || state.equals("WITHHELD_FORMAT") && List.of("CTRT_STRT_DD","CTRT_END_DD").contains(e.getKey()))) throw new DataIntegrityException();
            out.put(e.getKey(),value.isNull()?null:value.asText());stateOut.put(e.getKey(),state);
        });
        var metricOut=new LinkedHashMap<String,ReferenceResponses.Metric>();
        metrics.properties().forEach(e->{
            var metric=e.getValue();
            if (!fields(metric).equals(Set.of("value","valueState","unit"))) throw new DataIntegrityException();
            var value=metric.path("value");String state=metric.path("valueState").asText();
            String unit=source.equals("seoul-public-parking")?"PARKING_SPACE":"SQUARE_METRE_SOURCE_REPORTED";
            if (!metric.path("unit").asText().equals(unit)) throw new DataIntegrityException();
            if (state.equals("REPORTED")) {
                if (!value.isString() || !value.asText().matches("(0|[1-9][0-9]*)(\\.[0-9]{1,12})?")
                    || new BigDecimal(value.asText()).compareTo(new BigDecimal("9223372036854775807"))>0
                    || unit.equals("PARKING_SPACE") && new BigDecimal(value.asText()).stripTrailingZeros().scale()>0) throw new DataIntegrityException();
            } else if (!value.isNull() || !Set.of("SOURCE_NULL","WITHHELD_INVALID").contains(state)) throw new DataIntegrityException();
            metricOut.put(e.getKey(),new ReferenceResponses.Metric(value.isNull()?null:value.asText(),state,unit));
        });
        return new ReferenceResponses.Record(row.recordId(),out,stateOut,metricOut,row.sourceRowCount());
    }
}
