package kr.ac.recycleyoungs.score;

import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** 계산 결과와 진단을 반환한다. 공개 가능 여부·커버리지 승인은 포함하지 않는다. */
public record ScoreCalculation(
    RegionUnit unit,
    int eligibleCount,
    List<RegionScore> regions,
    List<ExcludedInput> excluded,
    Set<ScoreMetric> constantMetrics,
    Set<CalculationIssue> issues) {
  public ScoreCalculation {
    regions = List.copyOf(regions);
    excluded = List.copyOf(excluded);
    // copyOf의 비지정 순회 순서 대신 enum 선언 순서를 유지하고 원본 컬렉션과도 분리한다.
    var orderedConstants = EnumSet.noneOf(ScoreMetric.class);
    orderedConstants.addAll(constantMetrics);
    constantMetrics = Collections.unmodifiableSet(orderedConstants);
    var orderedIssues = EnumSet.noneOf(CalculationIssue.class);
    orderedIssues.addAll(issues);
    issues = Collections.unmodifiableSet(orderedIssues);
  }

  /** 호출자가 구와 동의 목록을 나눠 전달한다. 지역 코드로 단위를 추정하지 않는다. */
  public enum RegionUnit {
    DISTRICT,
    DONG
  }

  public enum CalculationIssue {
    INSUFFICIENT_COHORT
  }

  public enum InputIssueCode {
    INPUT_ROW_MISSING,
    INPUT_NULL,
    INPUT_NEGATIVE,
    INPUT_NON_FINITE,
    ZERO_STORE_COUNT
  }

  public record InputIssue(InputIssueCode code, ScoreMetric metric) {}

  public record ExcludedInput(ScoreInput input, List<InputIssue> reasons) {
    public ExcludedInput {
      reasons = List.copyOf(reasons);
    }
  }

  public record Component(ExactFraction normalized, ExactFraction contribution) {}

  public record Rank(ExactFraction average, int tieCount) {}

  /** 원본 입력·정규화·기여·점수·순위를 각각 보존한다. */
  public record RegionScore(
      ScoreInput input, Map<ScoreMetric, Component> components, ExactFraction score, Rank rank) {
    public RegionScore {
      var ordered = new EnumMap<ScoreMetric, Component>(ScoreMetric.class);
      components.forEach(
          (metric, component) -> ordered.put(metric, Objects.requireNonNull(component)));
      components = Collections.unmodifiableMap(ordered);
    }
  }
}
