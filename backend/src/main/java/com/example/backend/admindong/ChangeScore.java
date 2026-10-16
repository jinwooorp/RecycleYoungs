package com.example.backend.admindong;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class ChangeScore {
    static final String MODEL = "cafe-transactions-change-percentile-v1";
    static final int MIN_COHORT = 30;
    record Ratio(BigInteger numerator, BigInteger denominator) implements Comparable<Ratio> {
        public int compareTo(Ratio other) {
            return numerator.multiply(other.denominator).compareTo(other.numerator.multiply(denominator));
        }
    }
    record Result(Integer score, String currentCount, String previousCount, String changeRate, String direction, String reason, int cohortSize) {}
    static String previousQuarter(String quarter) {
        int year = Integer.parseInt(quarter.substring(0, 4)), q = quarter.charAt(4) - '0';
        return q == 1 ? (year - 1) + "4" : year + String.valueOf(q - 1);
    }
    private static Map<String, Long> index(List<ConsumptionScore.Row> rows) {
        var result = new HashMap<String, Long>();
        for (var row : rows) {
            if (result.containsKey(row.dongCode())) throw new DataIntegrityException();
            result.put(row.dongCode(), row.transactions());
        }
        return result;
    }
    private static String issue(String code, Map<String, Long> rows, String period) {
        if (!rows.containsKey(code)) return "NO_ROW_" + period;
        Long value = rows.get(code);
        if (value == null) return "NULL_" + period;
        if (value < 0) return "INVALID_" + period;
        return period.equals("PREVIOUS") && value == 0 ? "ZERO_PREVIOUS" : null;
    }
    private static Ratio ratio(long current, long previous) {
        return new Ratio(BigInteger.valueOf(current).subtract(BigInteger.valueOf(previous)), BigInteger.valueOf(previous));
    }
    static Result evaluate(String code, List<ConsumptionScore.Row> currentRows, List<ConsumptionScore.Row> previousRows) {
        var current = index(currentRows); var previous = index(previousRows);
        var cohort = current.keySet().stream().filter(k -> issue(k, current, "CURRENT") == null && issue(k, previous, "PREVIOUS") == null)
            .map(k -> ratio(current.get(k), previous.get(k))).toList();
        String reason = issue(code, current, "CURRENT");
        if (reason == null) reason = issue(code, previous, "PREVIOUS");
        Long c = current.get(code), p = previous.get(code);
        Ratio target = reason == null ? ratio(c, p) : null;
        String rate = target == null ? null : new BigDecimal(target.numerator()).multiply(BigDecimal.valueOf(100))
            .divide(new BigDecimal(target.denominator()), 4, RoundingMode.HALF_UP).toPlainString();
        String direction = target == null ? null : target.numerator().signum() > 0 ? "INCREASE" : target.numerator().signum() < 0 ? "DECREASE" : "UNCHANGED";
        if (reason == null && cohort.size() < MIN_COHORT) reason = "INSUFFICIENT_COHORT";
        Integer score = null;
        if (reason == null) {
            long lower = cohort.stream().filter(r -> r.compareTo(target) < 0).count();
            long equal = cohort.stream().filter(r -> r.compareTo(target) == 0).count();
            score = BigDecimal.valueOf(100L * (2 * lower + equal - 1)).divide(BigDecimal.valueOf(2L * (cohort.size() - 1)), 0, RoundingMode.HALF_UP).intValueExact();
        }
        return new Result(score, c == null ? null : c.toString(), p == null ? null : p.toString(), rate, direction, reason, cohort.size());
    }
}
