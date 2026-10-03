package com.example.backend.admindong;

import java.util.List;
import java.util.regex.Pattern;
import org.springframework.util.MultiValueMap;

final class QueryValidator {
    private static final List<String> FIELDS = List.of("dongCode", "industryCode", "quarterCode");
    private static final List<Pattern> FORMATS = List.of(Pattern.compile("[0-9]{8}"),
        Pattern.compile("[A-Z][A-Z0-9_]{0,29}"), Pattern.compile("[1-9][0-9]{3}[1-4]"));
    private static final List<String> CODES = List.of("INVALID_DONG_CODE", "INVALID_INDUSTRY_CODE", "INVALID_QUARTER");
    private QueryValidator() {}

    record StatsQuery(String dongCode, String industryCode, String quarterCode) {}

    static void noQuery(MultiValueMap<String, String> query) { rejectUnknown(query, List.of()); }

    static StatsQuery stats(MultiValueMap<String, String> query) {
        for (var field : FIELDS) {
            if (query.containsKey(field) && query.get(field).size() != 1) {
                throw invalid("요청 파라미터는 정확히 한 번 전달해야 합니다.", field);
            }
        }
        rejectUnknown(query, FIELDS);
        for (var field : FIELDS) {
            if (query.getFirst(field) == null || query.getFirst(field).isEmpty()) {
                throw invalid("필수 요청 파라미터가 없거나 비어 있습니다.", field);
            }
        }
        for (int i = 0; i < FIELDS.size(); i++) {
            if (!FORMATS.get(i).matcher(query.getFirst(FIELDS.get(i))).matches()) {
                throw new InvalidQueryException(CODES.get(i), "요청 파라미터 형식이 올바르지 않습니다.", FIELDS.get(i));
            }
        }
        return new StatsQuery(query.getFirst("dongCode"), query.getFirst("industryCode"), query.getFirst("quarterCode"));
    }

    private static void rejectUnknown(MultiValueMap<String, String> query, List<String> allowed) {
        query.keySet().stream().filter(field -> !allowed.contains(field)).sorted().findFirst().ifPresent(field -> {
            throw invalid("정의되지 않은 요청 파라미터입니다.", field);
        });
    }

    private static InvalidQueryException invalid(String message, String field) {
        return new InvalidQueryException("INVALID_PARAMETER", message, field);
    }
}
