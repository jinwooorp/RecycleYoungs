package com.example.backend.admindong;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ,noRollbackFor=ContextUnavailableException.class)
public class AdminDongContextService {
    private final AdminDongRepository lookup;
    private final AdminDongContextRepository repository;
    public AdminDongContextService(AdminDongRepository lookup,AdminDongContextRepository repository) {
        this.lookup=lookup; this.repository=repository;
    }
    public ContextResponses.Context context(QueryValidator.StatsQuery query) {
        return context(lookup.lookup(),query);
    }
    /** The caller has already validated the official dong through the score services. */
    public ContextResponses.Context contextIfPresent(QueryValidator.StatsQuery query) {
        var known=lookup.lookup();
        if (known.dongs().stream().noneMatch(d->d.code().equals(query.dongCode()))) return null;
        return context(known,query);
    }
    private ContextResponses.Context context(AdminDongRepository.Lookup known,QueryValidator.StatsQuery query) {
        var selected=ContextSelection.select(known,query,false);
        var metadata=lookup.requireVersion(query.dataVersion());
        if (metadata==null) throw new ContextUnavailableException();
        var release=repository.release(metadata.dataVersion());
        if (release.path("contract_version").asInt()==1) throw new ContextUnavailableException();
        if (release.path("contract_version").asInt()!=2
            || !release.path("context_policy_version").asText().equals(ContextPolicy.version())
            || !release.path("context_policy").equals(ContextPolicy.document().path("policy"))) throw new DataIntegrityException();
        var rows=repository.rows(metadata.dataVersion(),query.dongCode(),query.quarterCode());
        if (rows.size()!=6) throw new DataIntegrityException();
        var sections=new LinkedHashMap<String,ContextResponses.Section>();
        for (var row:rows) {
            if (!row.sourceId().startsWith("seoul-")) throw new DataIntegrityException();
            String key=row.sourceId().substring(6);
            var binding=release.path("context_sources").path(key);
            if (!ContextPolicy.keys().contains(key) || sections.containsKey(key)
                || !ContextPolicy.version().equals(row.policyVersion()) || !row.state().equals(binding.path("state").asText()))
                throw new DataIntegrityException();
            String state=row.state(); String stamp=null;
            if (key.equals("consumption")) {
                if (!state.equals("WITHHELD") || row.runId()!=null || !binding.path("run").isNull()
                    || row.metrics()!=null || row.attributes()!=null) throw new DataIntegrityException();
            } else {
                if (!state.equals("REFERENCE") || row.runId()==null || row.descriptor()==null) throw new DataIntegrityException();
                var run=AdminDongContextRepository.parse(row.descriptor());
                if (!run.equals(binding.path("run")) || !row.runId().equals(run.path("run_id").asText())
                    || !run.path("observed_at").isNull()) throw new DataIntegrityException();
                stamp=run.path("collected_at").asText();
                try { java.time.OffsetDateTime.parse(stamp); } catch (RuntimeException ex) { throw new DataIntegrityException(); }
                state=row.metrics()!=null?"REFERENCE":row.hasPeriod()?"NO_ROW":"NO_PERIOD";
                if (row.metrics()!=null && !row.hasPeriod()) throw new DataIntegrityException();
            }
            sections.put(key,ContextPolicy.project(key,state,row.runId(),query.quarterCode(),stamp,
                row.metrics()==null?null:strings(AdminDongContextRepository.parse(row.metrics())),
                row.attributes()==null?null:strings(AdminDongContextRepository.parse(row.attributes()))));
        }
        return new ContextResponses.Context(selected.dong(),selected.quarter(),"ADMINISTRATIVE_DONG",ContextPolicy.version(),sections,metadata);
    }
    static Map<String,String> strings(JsonNode node) {
        if (!node.isObject()) throw new DataIntegrityException();
        var result=new LinkedHashMap<String,String>();
        node.properties().forEach(e->{
            if (!e.getValue().isNull() && !e.getValue().isString()) throw new DataIntegrityException();
            result.put(e.getKey(),e.getValue().isNull()?null:e.getValue().asText());
        });
        return result;
    }
}
