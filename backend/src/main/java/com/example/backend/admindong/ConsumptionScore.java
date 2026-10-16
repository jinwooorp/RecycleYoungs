package com.example.backend.admindong;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.HashSet;
import java.util.List;

final class ConsumptionScore {
    static final int MIN_COHORT = 30;
    static final String MODEL = "cafe-transactions-percentile-v1";
    record Row(String dongCode, Long transactions) {}
    record Result(String status, Integer score, String transactionCount, String reason, int cohortSize) {}

    static Result evaluate(String code, List<Row> rows) {
        var codes = new HashSet<String>();
        for (var row : rows) if (!codes.add(row.dongCode())) throw new DataIntegrityException();
        var valid = rows.stream().filter(r -> r.transactions() != null && r.transactions() >= 0)
            .map(Row::transactions).toList();
        var row = rows.stream().filter(r -> r.dongCode().equals(code)).findFirst().orElse(null);
        String reason = row == null ? "NO_ROW" : row.transactions() == null ? "NULL_VALUE"
            : row.transactions() < 0 ? "INVALID_VALUE" : valid.size() < MIN_COHORT ? "INSUFFICIENT_COHORT" : null;
        return new Result(reason == null ? "AVAILABLE" : "UNAVAILABLE",
            reason == null ? percentile(row.transactions(), valid) : null,
            row == null || row.transactions() == null ? null : row.transactions().toString(), reason, valid.size());
    }

    static Integer percentile(Long target, List<Long> values) {
        if (target == null || target < 0 || values.size() < 2) return null;
        long lower = values.stream().filter(v -> v < target).count();
        long equal = values.stream().filter(v -> v.equals(target)).count();
        if (equal == 0) return null;
        return BigDecimal.valueOf(100 * (2 * lower + equal - 1))
            .divide(BigDecimal.valueOf(2L * (values.size() - 1)), 0, RoundingMode.HALF_UP).intValueExact();
    }
}
