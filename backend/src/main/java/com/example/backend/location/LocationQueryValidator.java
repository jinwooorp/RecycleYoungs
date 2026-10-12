package com.example.backend.location;

import com.example.backend.admindong.InvalidQueryException;
import java.math.BigDecimal;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.util.MultiValueMap;

final class LocationQueryValidator {
    private static final List<String> FIELDS = List.of("lat", "lng");
    private static final Pattern DECIMAL = Pattern.compile("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?");
    private LocationQueryValidator() {}

    static LocationResponses.Coordinate coordinate(MultiValueMap<String, String> query) {
        for (var field : FIELDS) {
            if (query.containsKey(field) && query.get(field).size() != 1) {
                throw invalid("INVALID_PARAMETER", "요청 파라미터는 정확히 한 번 전달해야 합니다.", field);
            }
        }
        query.keySet().stream().filter(field -> !FIELDS.contains(field)).sorted().findFirst().ifPresent(field -> {
            throw invalid("INVALID_PARAMETER", "정의되지 않은 요청 파라미터입니다.", field);
        });
        for (var field : FIELDS) {
            if (query.getFirst(field) == null || query.getFirst(field).isEmpty()) {
                throw invalid("INVALID_PARAMETER", "필수 요청 파라미터가 없거나 비어 있습니다.", field);
            }
        }
        return new LocationResponses.Coordinate(parse(query.getFirst("lat"), "lat", 90),
            parse(query.getFirst("lng"), "lng", 180));
    }

    private static double parse(String raw, String field, int limit) {
        if (raw.length() <= 64 && DECIMAL.matcher(raw).matches()) {
            try {
                var decimal = new BigDecimal(raw);
                double value = decimal.doubleValue();
                if (decimal.abs().compareTo(BigDecimal.valueOf(limit)) <= 0 && Double.isFinite(value)
                    && (value != 0 || decimal.signum() == 0)) return value;
            } catch (NumberFormatException ignored) {
                // The same public error covers format and range failures.
            }
        }
        throw invalid("INVALID_COORDINATE", "위도·경도 형식 또는 범위가 올바르지 않습니다.", field);
    }

    private static InvalidQueryException invalid(String code, String message, String field) {
        return new InvalidQueryException(code, message, field);
    }
}
