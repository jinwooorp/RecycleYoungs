package com.example.backend.admindong;

final class ContextSelection {
    private ContextSelection() {}
    record Selected(ApiResponses.NamedCode dong,ApiResponses.Quarter quarter,AdminDongRepository.Industry industry) {}
    static Selected select(AdminDongRepository.Lookup lookup, QueryValidator.StatsQuery query,boolean needsCafe) {
        var dong=lookup.dongs().stream().filter(d->d.code().equals(query.dongCode())).findFirst()
            .orElseThrow(()->new InvalidQueryException("UNKNOWN_DONG","조회 가능한 행정동이 아닙니다.","dongCode"));
        var period=lookup.quarters().stream().filter(q->q.code().equals(query.quarterCode())).findFirst()
            .orElseThrow(()->new InvalidQueryException("UNSUPPORTED_QUARTER","지원하지 않는 분기입니다.","quarterCode"));
        AdminDongRepository.Industry industry=null;
        if (needsCafe) {
            industry=lookup.industries().stream().filter(i->i.code().equals(query.industryCode())).findFirst()
                .orElseThrow(()->new InvalidQueryException("UNKNOWN_INDUSTRY","등록되지 않은 내부 업종입니다.","industryCode"));
            if (!industry.available() || !industry.code().equals("CAFE"))
                throw new InvalidQueryException("UNSUPPORTED_INDUSTRY","카페 세부 매출만 지원합니다.","industryCode");
        }
        return new Selected(dong,new ApiResponses.Quarter(period.code(),period.label()),industry);
    }
}
