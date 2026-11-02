package kr.ac.recycleyoungs.score;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** DB·HTTP·Spring에 의존하지 않는 승인 전 A 후보의 계산기. */
public final class AScoreCalculator {
  /**
   * 호출자가 분리한 한 단위의 입력을 계산한다. 잘못된 값은 사유와 함께 제외하되 커버리지 승인으로 해석하지 않는다. 전체 동일 지표는 평균 순위로 계산하고 진단에 남긴다.
   * 서비스가 산출 보류 여부를 판단한다.
   */
  public ScoreCalculation calculate(ScoreCalculation.RegionUnit unit, List<ScoreInput> inputs) {
    Objects.requireNonNull(unit, "unit");
    var ordered = new ArrayList<>(List.copyOf(inputs));
    ordered.sort(Comparator.comparing(ScoreInput::regionCode));
    var codes = new HashSet<String>();
    var eligible = new ArrayList<ScoreInput>();
    var excluded = new ArrayList<ScoreCalculation.ExcludedInput>();
    for (var input : ordered) {
      if (!codes.add(input.regionCode())) {
        throw new IllegalArgumentException("지역 코드가 중복되었습니다.");
      }
      var reasons = validate(input);
      if (reasons.isEmpty()) {
        eligible.add(input);
      } else {
        excluded.add(new ScoreCalculation.ExcludedInput(input, reasons));
      }
    }
    int size = eligible.size();
    if (size <= 1) {
      return new ScoreCalculation(
          unit,
          size,
          List.of(),
          excluded,
          Set.of(),
          Set.of(ScoreCalculation.CalculationIssue.INSUFFICIENT_COHORT));
    }

    BigInteger n = BigInteger.valueOf(size);
    BigInteger nMinusOne = n.subtract(BigInteger.ONE);
    BigInteger denominator = nMinusOne.multiply(BigInteger.TWO);
    var constants = EnumSet.noneOf(ScoreMetric.class);
    var components = new HashMap<String, Map<ScoreMetric, ScoreCalculation.Component>>();
    var weightedNumerators = new HashMap<String, BigInteger>();
    for (var input : eligible) {
      components.put(input.regionCode(), new EnumMap<>(ScoreMetric.class));
      weightedNumerators.put(input.regionCode(), BigInteger.ZERO);
    }

    for (var metric : ScoreMetric.values()) {
      var sorted = new ArrayList<>(eligible);
      sorted.sort(Comparator.comparing(input -> input.numericValue(metric)));
      if (sorted.getFirst().numericValue(metric).compareTo(sorted.getLast().numericValue(metric))
          == 0) {
        constants.add(metric);
      }
      int start = 0;
      while (start < size) {
        int end = start + 1;
        while (end < size
            && sorted
                    .get(start)
                    .numericValue(metric)
                    .compareTo(sorted.get(end).numericValue(metric))
                == 0) {
          end++;
        }
        // 같은 값이 차지한 구간 [start,end)의 평균 순위 두 배는 start+end+1이다.
        BigInteger twiceRank =
            BigInteger.valueOf(start).add(BigInteger.valueOf(end)).add(BigInteger.ONE);
        BigInteger v =
            metric.increasing()
                ? twiceRank.subtract(BigInteger.TWO)
                : n.multiply(BigInteger.TWO).subtract(twiceRank);
        BigInteger weighted = metric.weightNumerator().multiply(v);
        var component =
            new ScoreCalculation.Component(
                new ExactFraction(v, denominator),
                new ExactFraction(BigInteger.valueOf(5).multiply(weighted), nMinusOne));
        for (int i = start; i < end; i++) {
          String code = sorted.get(i).regionCode();
          components.get(code).put(metric, component);
          weightedNumerators.merge(code, weighted, BigInteger::add);
        }
        start = end;
      }
    }
    var scores = new HashMap<String, ExactFraction>();
    weightedNumerators.forEach(
        (code, k) ->
            scores.put(code, new ExactFraction(BigInteger.valueOf(5).multiply(k), nMinusOne)));
    var ranks = rankScores(scores);
    var regions =
        eligible.stream()
            .map(
                input ->
                    new ScoreCalculation.RegionScore(
                        input,
                        components.get(input.regionCode()),
                        scores.get(input.regionCode()),
                        ranks.get(input.regionCode())))
            .toList();
    return new ScoreCalculation(unit, size, regions, excluded, constants, Set.of());
  }

  /** 표시 전의 정확한 점수를 내림차순 비교하고 같은 점수에는 평균 순위를 부여한다. */
  static Map<String, ScoreCalculation.Rank> rankScores(Map<String, ExactFraction> scores) {
    var sorted = new ArrayList<>(scores.entrySet());
    sorted.sort(
        Map.Entry.<String, ExactFraction>comparingByValue()
            .reversed()
            .thenComparing(Map.Entry.comparingByKey()));
    var ranks = new HashMap<String, ScoreCalculation.Rank>();
    int start = 0;
    while (start < sorted.size()) {
      int end = start + 1;
      while (end < sorted.size()
          && sorted.get(start).getValue().compareTo(sorted.get(end).getValue()) == 0) {
        end++;
      }
      var rank =
          new ScoreCalculation.Rank(
              new ExactFraction(
                  BigInteger.valueOf(start).add(BigInteger.valueOf(end)).add(BigInteger.ONE),
                  BigInteger.TWO),
              end - start);
      for (int i = start; i < end; i++) {
        ranks.put(sorted.get(i).getKey(), rank);
      }
      start = end;
    }
    return Map.copyOf(ranks);
  }

  private static List<ScoreCalculation.InputIssue> validate(ScoreInput input) {
    var reasons = new ArrayList<ScoreCalculation.InputIssue>();
    for (var metric : ScoreMetric.values()) {
      ScoreCalculation.InputIssueCode code =
          switch (input.value(metric).state()) {
            case ROW_MISSING -> ScoreCalculation.InputIssueCode.INPUT_ROW_MISSING;
            case NULL -> ScoreCalculation.InputIssueCode.INPUT_NULL;
            case NON_FINITE -> ScoreCalculation.InputIssueCode.INPUT_NON_FINITE;
            case PRESENT -> {
              int sign = input.numericValue(metric).signum();
              if (sign < 0) {
                yield ScoreCalculation.InputIssueCode.INPUT_NEGATIVE;
              }
              yield sign == 0 && metric == ScoreMetric.STORE_COUNT
                  ? ScoreCalculation.InputIssueCode.ZERO_STORE_COUNT
                  : null;
            }
          };
      if (code != null) {
        reasons.add(new ScoreCalculation.InputIssue(code, metric));
      }
    }
    reasons.sort(
        Comparator.comparing(ScoreCalculation.InputIssue::code)
            .thenComparing(ScoreCalculation.InputIssue::metric));
    return List.copyOf(reasons);
  }
}
