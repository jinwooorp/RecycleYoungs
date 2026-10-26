package com.example.backend.admindong;

import java.util.LinkedHashMap;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
public class ReferenceService {
    private final AdminDongRepository lookup;
    private final ReferenceRepository repository;
    public ReferenceService(AdminDongRepository lookup,ReferenceRepository repository) { this.lookup=lookup;this.repository=repository; }
    public ReferenceResponses.Catalog catalog(String dataVersion) {
        var metadata=lookup.requireVersion(dataVersion);
        if (metadata==null || !repository.available()) throw new ContextUnavailableException();
        var rows=repository.sources();
        if (rows.isEmpty()) throw new ContextUnavailableException();
        var snapshots=new LinkedHashMap<String,String>();
        for (var row:rows) if (snapshots.put(row.sourceId(),row.snapshotId())!=null) throw new DataIntegrityException();
        var version=ReferencePolicy.version(snapshots);
        return new ReferenceResponses.Catalog(version,"CURRENT_SOURCE_SNAPSHOT",null,false,rows.stream().map(ReferencePolicy::source).toList(),metadata);
    }
    public ReferenceResponses.Records records(ReferenceQuery query) {
        var catalog=catalog(query.dataVersion());
        if (!catalog.referenceVersion().equals(query.referenceVersion())) throw new ReferenceVersionChangedException();
        var source=catalog.sources().stream().filter(s->s.sourceId().equals(query.sourceId())).findFirst().orElseThrow(DataIntegrityException::new);
        int total=repository.count(source.snapshotId(),query.search()),offset=(query.page()-1)*20;
        if (total<0 || total>source.recordCount()) throw new DataIntegrityException();
        var rows=repository.records(source.snapshotId(),query.search(),offset);
        if (rows.size()!=Math.min(20,Math.max(0,total-offset)) || rows.stream().map(ReferenceRepository.RecordRow::recordId).distinct().count()!=rows.size()) throw new DataIntegrityException();
        return new ReferenceResponses.Records(catalog.referenceVersion(),source,query.page(),20,total,
            rows.stream().map(r->ReferencePolicy.record(query.sourceId(),r)).toList(),catalog.metadata());
    }
}
