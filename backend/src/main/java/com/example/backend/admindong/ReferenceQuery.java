package com.example.backend.admindong;

import java.util.List;
import org.springframework.util.MultiValueMap;

record ReferenceQuery(String sourceId,String referenceVersion,String dataVersion,String search,int page) {
    private static String single(MultiValueMap<String,String> q,String name,boolean required) {
        var values=q.get(name);
        if (values==null && !required) return null;
        if (values==null || values.size()!=1 || values.getFirst()==null || values.getFirst().isBlank()) throw invalid(name);
        return values.getFirst();
    }
    private static void allowed(MultiValueMap<String,String> q,List<String> fields) {
        q.keySet().stream().filter(k->!fields.contains(k)).sorted().findFirst().ifPresent(k->{throw invalid(k);});
    }
    private static InvalidQueryException invalid(String field) {
        return new InvalidQueryException("INVALID_PARAMETER","요청 파라미터가 올바르지 않습니다.",field);
    }
    static String catalog(MultiValueMap<String,String> q) {
        allowed(q,List.of("dataVersion")); return dataVersion(q);
    }
    private static String dataVersion(MultiValueMap<String,String> q) {
        var value=single(q,"dataVersion",true);
        if (!value.matches("[0-9a-f]{64}|legacy-unversioned")) throw invalid("dataVersion");
        return value;
    }
    static ReferenceQuery records(MultiValueMap<String,String> q) {
        allowed(q,List.of("sourceId","referenceVersion","dataVersion","query","page"));
        String source=single(q,"sourceId",true),version=single(q,"referenceVersion",true);
        if (!ReferencePolicy.sources().contains(source)) throw invalid("sourceId");
        if (!version.matches("[0-9a-f]{64}")) throw invalid("referenceVersion");
        String search=single(q,"query",false),pageText=single(q,"page",false);
        if (search!=null && (search.length()>80 || search.codePoints().anyMatch(Character::isISOControl))) throw invalid("query");
        if (pageText!=null && !pageText.matches("[1-9][0-9]{0,3}")) throw invalid("page");
        int page=pageText==null?1:Integer.parseInt(pageText);
        if (page>2500) throw invalid("page");
        return new ReferenceQuery(source,version,dataVersion(q),search==null?"":search.strip(),page);
    }
}
