package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatNullPointerException;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** 승인 전 A 후보의 합성 입력만 사용하며 DB·Spring 컨텍스트를 시작하지 않는다. */
class AScoreCalculatorTests {
  private final AScoreCalculator calculator = new AScoreCalculator();

  @Test
  void reproducesFiveRegionScoresContributionsAndAverageRanks() {
    var calculation = calculator.calculate(ScoreCalculation.RegionUnit.DONG, fiveRegions());

    assertThat(calculation.regions())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(
            fraction(40, 1), fraction(40, 1), fraction(45, 1), fraction(65, 1), fraction(60, 1));
    assertThat(calculation.regions())
        .extracting(r -> r.rank().average())
        .containsExactly(
            fraction(9, 2), fraction(9, 2), fraction(3, 1), fraction(1, 1), fraction(2, 1));
    assertThat(calculation.regions().getFirst().rank().tieCount()).isEqualTo(2);
    var ra = calculation.regions().get(3);
    assertThat(
            List.of(
                ra.components().get(ScoreMetric.SALES).contribution(),
                ra.components().get(ScoreMetric.FOOT_TRAFFIC).contribution(),
                ra.components().get(ScoreMetric.STORE_COUNT).contribution(),
                ra.components().get(ScoreMetric.CLOSURE_RATE).contribution()))
        .containsExactly(fraction(45, 2), fraction(45, 2), fraction(15, 1), fraction(5, 1));
    assertThat(ra.components().get(ScoreMetric.SALES).normalized()).isEqualTo(fraction(3, 4));
    assertThat(ra.components().get(ScoreMetric.CLOSURE_RATE).normalized())
        .isEqualTo(fraction(1, 4));
  }

  @Test
  void averagesTiedInputRanksInBothDirections() {
    var result =
        calculate(
            List.of(
                input("a", "100", "1", "1", "100"),
                input("b", "200", "2", "2", "200"),
                input("c", "200", "3", "3", "200"),
                input("d", "400", "4", "4", "400"),
                input("e", "500", "5", "5", "500")));
    for (int index : List.of(1, 2)) {
      assertThat(result.regions().get(index).components().get(ScoreMetric.SALES).normalized())
          .isEqualTo(fraction(3, 8));
      assertThat(
              result.regions().get(index).components().get(ScoreMetric.CLOSURE_RATE).normalized())
          .isEqualTo(fraction(5, 8));
    }
  }

  @Test
  void treatsDecimalScalesAsNumericalTiesAndPreservesOriginalValues() {
    var result =
        calculate(
            List.of(
                input("a", "1", "1.0", "1", "1.00"),
                input("b", "2", "1.00", "2", "1.0"),
                input("c", "3", "2", "3", "2")));
    assertThat(result.regions().getFirst().input().footTraffic().number().toPlainString())
        .isEqualTo("1.0");
    assertThat(result.regions().get(1).input().footTraffic().number().toPlainString())
        .isEqualTo("1.00");
    assertThat(result.regions().getFirst().components().get(ScoreMetric.FOOT_TRAFFIC).normalized())
        .isEqualTo(fraction(1, 4));
    assertThat(result.regions().get(1).components().get(ScoreMetric.FOOT_TRAFFIC).normalized())
        .isEqualTo(fraction(1, 4));
  }

  @Test
  void decreasesStoreContributionWithoutChangingOtherMetrics() {
    var result = calculate(List.of(input("a", "1", "1", "1", "0"), input("b", "1", "1", "2", "0")));
    assertThat(result.regions())
        .extracting(r -> r.components().get(ScoreMetric.STORE_COUNT).contribution())
        .containsExactly(fraction(20, 1), fraction(0, 1));
    assertThat(result.regions())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(fraction(60, 1), fraction(40, 1));
    assertThat(result.constantMetrics())
        .containsExactlyInAnyOrder(
            ScoreMetric.SALES, ScoreMetric.FOOT_TRAFFIC, ScoreMetric.CLOSURE_RATE);
  }

  @Test
  void distinguishesIntegersBeyondDoublePrecisionAndLongDecimals() {
    var result =
        calculate(
            List.of(
                input("a", "9007199254740992", "1.00000000000000000001", "1", "0"),
                input("b", "9007199254740993", "1.00000000000000000002", "2", "1")));
    assertThat(result.regions())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(fraction(40, 1), fraction(60, 1));
    assertThat(result.regions().getFirst().components().get(ScoreMetric.FOOT_TRAFFIC).normalized())
        .isEqualTo(fraction(0, 1));
    assertThat(result.regions().get(1).components().get(ScoreMetric.FOOT_TRAFFIC).normalized())
        .isEqualTo(fraction(1, 1));
  }

  @Test
  void ranksExactScoresBeforeIndependentDisplayRounding() {
    var higher = fraction(50004, 1000);
    var lower = fraction(50003, 1000);
    var ranks = AScoreCalculator.rankScores(Map.of("a", higher, "b", lower));
    assertThat(higher.toDecimal(2, RoundingMode.HALF_UP)).isEqualByComparingTo("50.00");
    assertThat(lower.toDecimal(2, RoundingMode.HALF_UP)).isEqualByComparingTo("50.00");
    assertThat(ranks.get("a").average()).isEqualTo(fraction(1, 1));
    assertThat(ranks.get("b").average()).isEqualTo(fraction(2, 1));
    assertThat(fraction(50005, 1000).toDecimal(2, RoundingMode.HALF_UP))
        .isEqualByComparingTo("50.01");
  }

  @Test
  void keepsExactContributionSumInsteadOfAddingRoundedDisplays() {
    var inputs = new ArrayList<ScoreInput>();
    inputs.add(input("a", "0", "0", "100", "100"));
    inputs.add(input("b", "0", "0", "100", "100"));
    for (int i = 1; i <= 29; i++) {
      String value = Integer.toString(i);
      inputs.add(input("c" + i, value, value, value, value));
    }
    var result = calculate(inputs);
    var first = result.regions().getFirst();
    assertThat(first.score()).isEqualTo(fraction(5, 3));
    assertThat(first.score().toDecimal(2, RoundingMode.HALF_UP)).isEqualByComparingTo("1.67");
    assertThat(
            first.components().values().stream()
                .map(c -> c.contribution().toDecimal(2, RoundingMode.HALF_UP))
                .reduce(BigDecimal.ZERO, BigDecimal::add))
        .isEqualByComparingTo("1.66");
    for (var region : result.regions()) {
      assertThat(
              region.components().values().stream()
                  .map(ScoreCalculation.Component::contribution)
                  .reduce(fraction(0, 1), ExactFraction::add))
          .isEqualTo(region.score());
      assertThat(region.score()).isBetween(fraction(0, 1), fraction(100, 1));
      for (var component : region.components().values()) {
        assertThat(component.normalized()).isBetween(fraction(0, 1), fraction(1, 1));
      }
    }
  }

  @Test
  void preservesScoresUnderPositiveRescalingOfAnEntireMetric() {
    var scaled =
        fiveRegions().stream()
            .map(
                i ->
                    new ScoreInput(
                        i.regionCode(),
                        ScoreInput.Value.present(i.sales().number().multiply(BigInteger.TEN)),
                        i.footTraffic(),
                        i.storeCount(),
                        i.closureRate()))
            .toList();
    assertThat(calculate(scaled).regions())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactlyElementsOf(
            calculate(fiveRegions()).regions().stream()
                .map(ScoreCalculation.RegionScore::score)
                .toList());
  }

  @Test
  void calculatesRealZeroAndHundredRatherThanTreatingZeroAsMissing() {
    var result = calculate(List.of(input("a", "0", "0", "2", "2"), input("b", "1", "1", "1", "1")));
    assertThat(result.excluded()).isEmpty();
    assertThat(result.issues()).isEmpty();
    assertThat(result.regions())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(fraction(0, 1), fraction(100, 1));
  }

  @Test
  void producesIdenticalResultsWhenInputOrderChanges() {
    var inputs = new ArrayList<>(fiveRegions());
    Collections.reverse(inputs);
    assertThat(calculate(inputs)).isEqualTo(calculate(fiveRegions()));
  }

  @Test
  void reportsMissingRowsNullNegativeNonFiniteAndZeroStoresSeparately() {
    var valid = input("ok", "1", "1", "1", "1");
    var inputs =
        List.of(
            new ScoreInput(
                "missing",
                ScoreInput.Value.rowMissing(),
                valid.footTraffic(),
                valid.storeCount(),
                valid.closureRate()),
            new ScoreInput(
                "null",
                ScoreInput.Value.nullValue(),
                valid.footTraffic(),
                valid.storeCount(),
                valid.closureRate()),
            input("negative", "-1", "-2", "-3", "-4"),
            new ScoreInput(
                "nonfinite",
                valid.sales(),
                ScoreInput.Value.nonFinite(),
                valid.storeCount(),
                valid.closureRate()),
            input("zero", "0", "0", "0", "0"),
            valid,
            input("ok2", "2", "2", "2", "2"));
    var result = calculate(inputs);
    assertThat(result.eligibleCount()).isEqualTo(2);
    assertThat(result.excluded())
        .extracting(e -> e.input().regionCode())
        .containsExactly("missing", "negative", "nonfinite", "null", "zero");
    assertThat(result.excluded().getFirst().reasons())
        .containsExactly(
            new ScoreCalculation.InputIssue(
                ScoreCalculation.InputIssueCode.INPUT_ROW_MISSING, ScoreMetric.SALES));
    assertThat(result.excluded().get(1).reasons())
        .hasSize(4)
        .allSatisfy(
            r -> assertThat(r.code()).isEqualTo(ScoreCalculation.InputIssueCode.INPUT_NEGATIVE));
    assertThat(result.excluded().get(2).reasons())
        .containsExactly(
            new ScoreCalculation.InputIssue(
                ScoreCalculation.InputIssueCode.INPUT_NON_FINITE, ScoreMetric.FOOT_TRAFFIC));
    assertThat(result.excluded().get(3).reasons())
        .containsExactly(
            new ScoreCalculation.InputIssue(
                ScoreCalculation.InputIssueCode.INPUT_NULL, ScoreMetric.SALES));
    assertThat(result.excluded().get(4).reasons())
        .containsExactly(
            new ScoreCalculation.InputIssue(
                ScoreCalculation.InputIssueCode.ZERO_STORE_COUNT, ScoreMetric.STORE_COUNT));
    var reversed = new ArrayList<>(inputs);
    Collections.reverse(reversed);
    assertThat(calculate(reversed)).isEqualTo(result);
  }

  @Test
  void doesNotNormalizeAnEmptyOrSingleEligibleRegion() {
    for (var inputs :
        List.of(
            List.<ScoreInput>of(),
            List.of(input("a", "1", "1", "1", "1")),
            List.of(input("a", "1", "1", "1", "1"), input("b", "1", "1", "0", "1")))) {
      var result = calculate(inputs);
      assertThat(result.regions()).isEmpty();
      assertThat(result.issues())
          .containsExactly(ScoreCalculation.CalculationIssue.INSUFFICIENT_COHORT);
    }
  }

  @Test
  void reportsConstantIndicatorsButLeavesServicePublicationPolicyToCaller() {
    var result =
        calculate(List.of(input("a", "1", "1.0", "1", "0"), input("b", "1", "1.00", "1", "0.0")));
    assertThat(result.constantMetrics()).isEqualTo(Set.of(ScoreMetric.values()));
    assertThat(result.issues()).isEmpty();
    assertThat(result.regions())
        .hasSize(2)
        .allSatisfy(
            r -> {
              assertThat(r.score()).isEqualTo(fraction(50, 1));
              assertThat(r.rank()).isEqualTo(new ScoreCalculation.Rank(fraction(3, 2), 2));
              assertThat(r.components().values())
                  .allSatisfy(c -> assertThat(c.normalized()).isEqualTo(fraction(1, 2)));
            });
  }

  @Test
  void acceptsZeroTrafficClosureAndClosureRatesAboveHundred() {
    var result =
        calculate(List.of(input("a", "1", "0", "1", "0"), input("b", "2", "1", "2", "200")));
    assertThat(result.excluded()).isEmpty();
    assertThat(result.regions())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(fraction(40, 1), fraction(60, 1));
  }

  @Test
  void requiresExplicitUnitAndCalculatesDistrictAndDongCohortsIndependently() {
    var district = calculator.calculate(ScoreCalculation.RegionUnit.DISTRICT, fiveRegions());
    var dong = calculate(List.of(input("a", "0", "0", "2", "2"), input("b", "1", "1", "1", "1")));
    assertThat(district.unit()).isEqualTo(ScoreCalculation.RegionUnit.DISTRICT);
    assertThat(district.eligibleCount()).isEqualTo(5);
    assertThat(dong.unit()).isEqualTo(ScoreCalculation.RegionUnit.DONG);
    assertThat(dong.eligibleCount()).isEqualTo(2);
    assertThat(calculator.calculate(ScoreCalculation.RegionUnit.DISTRICT, fiveRegions()))
        .isEqualTo(district);
    assertThatNullPointerException().isThrownBy(() -> calculator.calculate(null, fiveRegions()));
  }

  @Test
  void rejectsAmbiguousIdentityAndMalformedInputModels() {
    assertThatIllegalArgumentException()
        .isThrownBy(() -> calculate(List.of(fiveRegions().getFirst(), fiveRegions().getFirst())));
    assertThatIllegalArgumentException().isThrownBy(() -> input(" ", "1", "1", "1", "1"));
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new ScoreInput.Value<>(ScoreInput.ValueState.NULL, BigInteger.ZERO));
    assertThatIllegalArgumentException()
        .isThrownBy(() -> new ScoreInput.Value<BigInteger>(ScoreInput.ValueState.PRESENT, null));
    assertThatNullPointerException().isThrownBy(() -> calculate(null));
    assertThatNullPointerException()
        .isThrownBy(() -> calculate(java.util.Arrays.asList((ScoreInput) null)));
  }

  @Test
  void returnsImmutableCollectionsWithoutRetainingMutableInputList() {
    var inputs = new ArrayList<>(fiveRegions());
    var result = calculate(inputs);
    inputs.clear();
    assertThat(result.regions()).hasSize(5);
    org.assertj.core.api.Assertions.assertThatExceptionOfType(UnsupportedOperationException.class)
        .isThrownBy(() -> result.regions().clear());
    org.assertj.core.api.Assertions.assertThatExceptionOfType(UnsupportedOperationException.class)
        .isThrownBy(() -> result.regions().getFirst().components().clear());
  }

  @Test
  void exposesStableRegionMetricAndDiagnosticOrder() {
    var inputs = new ArrayList<>(fiveRegions());
    Collections.reverse(inputs);
    var result = calculate(inputs);
    assertThat(result.regions())
        .extracting(r -> r.input().regionCode())
        .containsExactly("가", "나", "다", "라", "마");
    assertThat(result.regions().getFirst().components().keySet())
        .containsExactly(ScoreMetric.values());
    var constant =
        calculate(List.of(input("b", "1", "1", "1", "1"), input("a", "1", "1", "1", "1")));
    assertThat(constant.constantMetrics()).containsExactly(ScoreMetric.values());
  }

  @Test
  void defensivelyCopiesAllNestedCollections() {
    var result = calculate(fiveRegions());
    var components = new EnumMap<ScoreMetric, ScoreCalculation.Component>(ScoreMetric.class);
    components.putAll(result.regions().getFirst().components());
    var region =
        new ScoreCalculation.RegionScore(
            result.regions().getFirst().input(),
            components,
            fraction(40, 1),
            result.regions().getFirst().rank());
    var reasons =
        new ArrayList<>(
            List.of(
                new ScoreCalculation.InputIssue(
                    ScoreCalculation.InputIssueCode.INPUT_NULL, ScoreMetric.SALES)));
    var excluded = new ScoreCalculation.ExcludedInput(fiveRegions().getFirst(), reasons);
    var regions = new ArrayList<>(List.of(region));
    var exclusions = new ArrayList<>(List.of(excluded));
    var constants = EnumSet.allOf(ScoreMetric.class);
    var issues = EnumSet.of(ScoreCalculation.CalculationIssue.INSUFFICIENT_COHORT);
    var copy =
        new ScoreCalculation(
            ScoreCalculation.RegionUnit.DONG, 1, regions, exclusions, constants, issues);
    components.clear();
    reasons.clear();
    regions.clear();
    exclusions.clear();
    constants.clear();
    issues.clear();
    assertThat(copy.regions()).hasSize(1);
    assertThat(copy.regions().getFirst().components()).hasSize(4);
    assertThat(copy.excluded()).hasSize(1);
    assertThat(copy.excluded().getFirst().reasons()).hasSize(1);
    assertThat(copy.constantMetrics()).hasSize(4);
    assertThat(copy.issues())
        .containsExactly(ScoreCalculation.CalculationIssue.INSUFFICIENT_COHORT);
    for (Runnable mutation :
        List.<Runnable>of(
            () -> copy.excluded().clear(),
            () -> copy.excluded().getFirst().reasons().clear(),
            () -> copy.constantMetrics().clear(),
            () -> copy.issues().clear())) {
      org.assertj.core.api.Assertions.assertThatExceptionOfType(UnsupportedOperationException.class)
          .isThrownBy(mutation::run);
    }
  }

  private ScoreCalculation calculate(List<ScoreInput> inputs) {
    return calculator.calculate(ScoreCalculation.RegionUnit.DONG, inputs);
  }

  private static List<ScoreInput> fiveRegions() {
    return List.of(
        input("가", "1000", "100", "10", "1"),
        input("나", "2000", "200", "30", "2"),
        input("다", "3000", "300", "40", "3"),
        input("라", "4000", "400", "20", "4"),
        input("마", "5000", "500", "50", "5"));
  }

  private static ScoreInput input(
      String code, String sales, String foot, String stores, String closure) {
    return new ScoreInput(
        code,
        ScoreInput.Value.present(new BigInteger(sales)),
        ScoreInput.Value.present(new BigDecimal(foot)),
        ScoreInput.Value.present(new BigInteger(stores)),
        ScoreInput.Value.present(new BigDecimal(closure)));
  }

  private static ExactFraction fraction(long numerator, long denominator) {
    return new ExactFraction(BigInteger.valueOf(numerator), BigInteger.valueOf(denominator));
  }
}
