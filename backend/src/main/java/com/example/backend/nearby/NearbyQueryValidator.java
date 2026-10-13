package com.example.backend.nearby;

import com.example.backend.admindong.InvalidQueryException;
import java.math.BigDecimal;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.util.MultiValueMap;

final class NearbyQueryValidator {
    private static final List<String> FIELDS = List.of("lat", "lng", "radius", "industryCode");
    private static final Pattern DECIMAL = Pattern.compile("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?");
    private NearbyQueryValidator() {}

    static NearbyResponses.Query validate(MultiValueMap<String, String> query) {
        for (var field : FIELDS) {
            if (query.containsKey(field) && query.get(field).size() != 1)
                throw invalid("INVALID_PARAMETER", "요청 파라미터는 정확히 한 번 전달해야 합니다.", field);
        }
        query.keySet().stream().filter(field -> !FIELDS.contains(field)).sorted().findFirst().ifPresent(field -> {
            throw invalid("INVALID_PARAMETER", "정의되지 않은 요청 파라미터입니다.", field);
        });
        for (var field : FIELDS) {
            if (query.getFirst(field) == null || query.getFirst(field).isEmpty())
                throw invalid("INVALID_PARAMETER", "필수 요청 파라미터가 없거나 비어 있습니다.", field);
        }
        var coordinate = new NearbyResponses.Coordinate(parse(query.getFirst("lat"), "lat", 90),
            parse(query.getFirst("lng"), "lng", 180));
        if (!"500".equals(query.getFirst("radius")))
            throw invalid("UNSUPPORTED_RADIUS", "현재 반경 500m만 지원합니다.", "radius");
        if (!"CAFE".equals(query.getFirst("industryCode")))
            throw invalid("UNSUPPORTED_INDUSTRY", "현재 경쟁 점포 분석은 카페(CAFE)만 지원합니다.", "industryCode");
        return new NearbyResponses.Query(coordinate, 500, "CAFE");
    }

    private static double parse(String raw, String field, int limit) {
        if (raw.length() <= 64 && DECIMAL.matcher(raw).matches()) {
            try {
                var decimal = new BigDecimal(raw);
                double value = decimal.doubleValue();
                if (decimal.abs().compareTo(BigDecimal.valueOf(limit)) <= 0 && Double.isFinite(value)
                    && (value != 0 || decimal.signum() == 0)) return value;
            } catch (NumberFormatException ignored) { /* One public format/range error. */ }
        }
        throw invalid("INVALID_COORDINATE", "위도·경도 형식 또는 범위가 올바르지 않습니다.", field);
    }

    private static InvalidQueryException invalid(String code, String message, String field) {
        return new InvalidQueryException(code, message, field);
    }
}
