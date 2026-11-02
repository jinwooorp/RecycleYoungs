package kr.ac.recycleyoungs.score;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;

/** Service와 오프라인 재현에서 공유하는 순수 입력 검증·집단 계산. 게시·커버리지 승인은 수행하지 않는다. */
final class ScoreCohortEvaluator {
  private ScoreCohortEvaluator() {}

  record Evaluation(
      int eligibleCount,
      List<InternalScoreResult.ExcludedRegion> excluded,
      List<InternalScoreResult.Reason> reasons,
      List<ScoreCalculation.RegionScore> scores) {
    Evaluation {
      excluded = List.copyOf(excluded);
      reasons = List.copyOf(reasons);
      scores = List.copyOf(scores);
    }
  }

  static Evaluation evaluate(ScoreInputSnapshot snapshot) {
    var eligible = new ArrayList<ScoreInput>();
    var excluded = new ArrayList<InternalScoreResult.ExcludedRegion>();
    var codes = new HashSet<String>();
    for (var row : snapshot.regions()) {
      if (!codes.add(row.regionCode())) throw new IllegalStateException("스냅샷에 지역 코드가 중복되었습니다.");
      var reasons = validate(row);
      if (reasons.isEmpty()) {
        // 부적격 출처를 NULL·행 없음으로 바꾸지 않는다. 원본·배치 정보는 snapshot에 그대로 남는다.
        eligible.add(row.toScoreInput().orElseThrow());
      } else {
        excluded.add(new InternalScoreResult.ExcludedRegion(row.regionCode(), reasons));
      }
    }
    excluded.sort(Comparator.comparing(InternalScoreResult.ExcludedRegion::regionCode));
    var calculation = new AScoreCalculator().calculate(snapshot.unit(), eligible);
    if (!calculation.excluded().isEmpty()) throw new IllegalStateException("입력 검증과 계산기의 조건이 다릅니다.");
    var reasons = new ArrayList<InternalScoreResult.Reason>();
    if (calculation.eligibleCount() <= 1) {
      reasons.add(
          new InternalScoreResult.Reason(InternalScoreResult.ReasonCode.INSUFFICIENT_COHORT, null));
    }
    for (var metric : ScoreMetric.values()) {
      if (calculation.constantMetrics().contains(metric)) {
        reasons.add(
            new InternalScoreResult.Reason(
                InternalScoreResult.ReasonCode.CONSTANT_INDICATOR, metric));
      }
    }
    // 동일값 보류는 승인 전 내부 진단 후보 규칙이다. 계산기의 수학적 0.5 규칙은 변경하지 않는다.
    var scores =
        reasons.isEmpty() ? calculation.regions() : List.<ScoreCalculation.RegionScore>of();
    return new Evaluation(calculation.eligibleCount(), excluded, reasons, scores);
  }

  /** 정상 출처의 값을 검증하고 같은 지역에서 발견한 여러 제외 사유도 모두 보존한다. */
  private static List<InternalScoreResult.Reason> validate(ScoreInputSnapshot.RegionInput row) {
    var reasons = new ArrayList<InternalScoreResult.Reason>();
    for (var metric : ScoreMetric.values()) {
      var raw =
          switch (metric) {
            case SALES -> row.sales();
            case FOOT_TRAFFIC -> row.footTraffic();
            case STORE_COUNT -> row.storeCount();
            case CLOSURE_RATE -> row.closureRate();
          };
      InternalScoreResult.ReasonCode code =
          switch (raw.state()) {
            case ROW_MISSING -> InternalScoreResult.ReasonCode.INPUT_ROW_MISSING;
            case SOURCE_NOT_ELIGIBLE -> InternalScoreResult.ReasonCode.SOURCE_NOT_ELIGIBLE;
            case NULL -> InternalScoreResult.ReasonCode.INPUT_NULL;
            case NON_FINITE -> InternalScoreResult.ReasonCode.INPUT_NON_FINITE;
            case PRESENT -> {
              int sign =
                  metric == ScoreMetric.SALES || metric == ScoreMetric.STORE_COUNT
                      ? new BigInteger(raw.raw()).signum()
                      : new BigDecimal(raw.raw()).signum();
              if (sign < 0) yield InternalScoreResult.ReasonCode.INPUT_NEGATIVE;
              yield sign == 0 && metric == ScoreMetric.STORE_COUNT
                  ? InternalScoreResult.ReasonCode.ZERO_STORE_COUNT
                  : null;
            }
          };
      if (code != null) reasons.add(new InternalScoreResult.Reason(code, metric));
    }
    reasons.sort(
        Comparator.comparing(InternalScoreResult.Reason::code)
            .thenComparing(InternalScoreResult.Reason::metric));
    return List.copyOf(reasons);
  }
}
