package com.example.backend.admindong;

import java.util.List;
import org.springframework.util.MultiValueMap;
import org.springframework.util.LinkedMultiValueMap;

record DecisionQuery(List<String> codes,String quarterCode,String dataVersion) {
    static DecisionQuery parse(MultiValueMap<String,String> query) {
        if (!query.keySet().equals(java.util.Set.of("dongCodes","quarterCode","dataVersion")) || query.values().stream().anyMatch(v->v.size()!=1)) throw invalid();
        String raw=query.getFirst("dongCodes");
        if (raw==null || !raw.matches("[0-9]{8}(,[0-9]{8}){0,2}")) throw invalid();
        var codes=List.of(raw.split(","));
        if (codes.stream().distinct().count()!=codes.size()) throw invalid();
        var params=new LinkedMultiValueMap<String,String>(query);params.remove("dongCodes");params.set("dongCode",codes.getFirst());
        var validated=QueryValidator.context(params);
        return new DecisionQuery(codes,validated.quarterCode(),validated.dataVersion());
    }
    private static InvalidQueryException invalid() {
        return new InvalidQueryException("INVALID_PARAMETER","공통 분기·자료 버전과 중복 없는 행정동 1~3개를 전달해 주세요.","dongCodes");
    }
}
