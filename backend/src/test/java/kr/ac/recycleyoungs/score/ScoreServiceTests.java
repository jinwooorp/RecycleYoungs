package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.BadSqlGrammarException;

/** Repository만 mock으로 바꾸고 실제 A 계산기로 승인 전 진단 결과를 검증한다. */
class ScoreServiceTests {
  private final ScoreInputRepository repository = mock(ScoreInputRepository.class);
  private final ScoreService service = new ScoreService(repository);

  @Test
  void reproducesFiveRegionScoresAndExactContributionsWithoutApproval() {
    var snapshot = snapshot(ScoreCalculation.RegionUnit.DISTRICT, fiveRegions());
    when(repository.findDistrictInputs("20262", "CS100010")).thenReturn(snapshot);
    var result = service.diagnoseDistrict("라", "20262", "CS100010");
    assertThat(result.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_CALCULATED);
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.snapshot()).isSameAs(snapshot);
    assertThat(result.eligibleCount()).isEqualTo(5);
    assertThat(result.selectedScore().score()).isEqualTo(fraction(65, 1));
    assertThat(result.cohortScores())
        .isEqualTo(
            new AScoreCalculator()
                .calculate(
                    ScoreCalculation.RegionUnit.DISTRICT,
                    fiveRegions().stream().map(r -> r.toScoreInput().orElseThrow()).toList())
                .regions());
    assertThat(
            List.of(
                result.selectedScore().components().get(ScoreMetric.SALES).contribution(),
                result.selectedScore().components().get(ScoreMetric.FOOT_TRAFFIC).contribution(),
                result.selectedScore().components().get(ScoreMetric.STORE_COUNT).contribution(),
                result.selectedScore().components().get(ScoreMetric.CLOSURE_RATE).contribution()))
        .containsExactly(fraction(45, 2), fraction(45, 2), fraction(15, 1), fraction(5, 1));
    verify(repository).findDistrictInputs("20262", "CS100010");
    verifyNoMoreInteractions(repository);
  }

  @Test
  void selectionAndInputOrderDoNotChangeWholeCohortScoresOrRanks() {
    var rows = new ArrayList<>(fiveRegions());
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DONG, rows));
    var first = service.diagnoseDong("가", "20262", "CS100010");
    Collections.reverse(rows);
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DONG, rows));
    var other = service.diagnoseDong("라", "20262", "CS100010");
    assertThat(other.cohortScores()).isEqualTo(first.cohortScores());
    assertThat(first.selectedScore().rank())
        .isEqualTo(new ScoreCalculation.Rank(fraction(9, 2), 2));
    assertThat(other.selectedScore().rank().average()).isEqualTo(fraction(1, 1));
  }

  @Test
  void keepsDistrictAndDongCohortsSeparate() {
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DISTRICT, fiveRegions()));
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(
            snapshot(
                ScoreCalculation.RegionUnit.DONG,
                List.of(row("a", "0", "0", "2", "2"), row("b", "1", "1", "1", "0"))));
    assertThat(service.diagnoseDistrict("라", "20262", "CS100010").eligibleCount()).isEqualTo(5);
    var dong = service.diagnoseDong("a", "20262", "CS100010");
    assertThat(dong.request().unit()).isEqualTo(ScoreCalculation.RegionUnit.DONG);
    assertThat(dong.eligibleCount()).isEqualTo(2);
    assertThat(dong.selectedScore().score()).isEqualTo(fraction(0, 1));
    assertThat(dong.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_CALCULATED);
    assertThat(dong.cohortScores().get(1).input().closureRate().number()).isZero();
  }

  @Test
  void preservesLargeOriginalValuesAndDoesNotRoundDuringServiceValidation() {
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(
            snapshot(
                ScoreCalculation.RegionUnit.DONG,
                List.of(
                    row("a", "9007199254740992", "1.00000000000000000001", "1", "0"),
                    row("b", "9007199254740993", "1.00000000000000000002", "2", "200.00"))));
    var result = service.diagnoseDong("b", "20262", "CS100010");
    assertThat(result.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_CALCULATED);
    assertThat(result.selectedScore().score()).isEqualTo(fraction(60, 1));
    assertThat(result.selectedScore().input().sales().number())
        .isEqualTo(new BigInteger("9007199254740993"));
    assertThat(result.selectedScore().input().footTraffic().number().toPlainString())
        .isEqualTo("1.00000000000000000002");
    assertThat(result.snapshot().regions().get(1).closureRate().raw()).isEqualTo("200.00");
  }

  @ParameterizedTest
  @MethodSource("incompleteDatasets")
  void requiresEachOfTheThreeDatasetsIndependently(ScoreInputSnapshot.DatasetReadiness readiness) {
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(
            new ScoreInputSnapshot(
                ScoreCalculation.RegionUnit.DISTRICT,
                "20262",
                "CS100010",
                batch(),
                true,
                readiness,
                fiveRegions()));
    var result = service.diagnoseDistrict("라", "20262", "CS100010");
    assertStatus(result, InternalScoreResult.Status.DATASET_NOT_READY);
    assertThat(result.eligibleCount()).isNull();
  }

  static Stream<ScoreInputSnapshot.DatasetReadiness> incompleteDatasets() {
    return Stream.of(
        new ScoreInputSnapshot.DatasetReadiness(false, true, true),
        new ScoreInputSnapshot.DatasetReadiness(true, false, true),
        new ScoreInputSnapshot.DatasetReadiness(true, true, false));
  }

  @Test
  void validatesBoundaryThenRegionThenDatasetBeforeParsingInputs() {
    var bad = row("a", "not-a-number", "1", "1", "1");
    var notReady = new ScoreInputSnapshot.DatasetReadiness(false, false, false);
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(
            new ScoreInputSnapshot(
                ScoreCalculation.RegionUnit.DISTRICT,
                "20262",
                "CS100010",
                null,
                false,
                notReady,
                List.of(bad)));
    assertStatus(
        service.diagnoseDistrict("missing", "20262", "CS100010"),
        InternalScoreResult.Status.BOUNDARY_NOT_READY);
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(
            new ScoreInputSnapshot(
                ScoreCalculation.RegionUnit.DISTRICT,
                "20262",
                "CS100010",
                batch(),
                true,
                notReady,
                List.of(bad)));
    assertStatus(
        service.diagnoseDistrict("missing", "20262", "CS100010"),
        InternalScoreResult.Status.REGION_NOT_FOUND);
    assertStatus(
        service.diagnoseDistrict("a", "20262", "CS100010"),
        InternalScoreResult.Status.DATASET_NOT_READY);
  }

  @Test
  void rejectsEmptyLatestBoundaryDespiteOlderRegionInputs() {
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(
            new ScoreInputSnapshot(
                ScoreCalculation.RegionUnit.DONG,
                "20262",
                "CS100010",
                batch(),
                false,
                new ScoreInputSnapshot.DatasetReadiness(true, true, true),
                fiveRegions()));
    assertStatus(
        service.diagnoseDong("라", "20262", "CS100010"),
        InternalScoreResult.Status.BOUNDARY_NOT_READY);
  }

  @Test
  void preservesAllExcludedRegionReasonsIncludingUnqualifiedSourceAndNullInSameRow() {
    var source = new ScoreInputSnapshot.RowSource(true, new UUID(0, 99), batch(), false);
    var mixed =
        new ScoreInputSnapshot.RegionInput(
            "source",
            "출처",
            "구",
            "구",
            new ScoreInputSnapshot.RawValue("999", source),
            value(null),
            value("1"),
            value("0"));
    var missing =
        new ScoreInputSnapshot.RegionInput(
            "missing",
            "누락",
            "구",
            "구",
            new ScoreInputSnapshot.RawValue(
                null, new ScoreInputSnapshot.RowSource(false, null, null, false)),
            value("1"),
            value("1"),
            value("0"));
    var rows = new ArrayList<>(fiveRegions());
    rows.addAll(
        List.of(
            mixed,
            missing,
            row("null", null, "1", "1", "0"),
            row("negative", "-1", "-2", "-3", "-4"),
            row("nonfinite", "1", "NaN", "1", "Infinity"),
            row("zeroStores", "1", "1", "0", "0")));
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DISTRICT, rows));
    var result = service.diagnoseDistrict("source", "20262", "CS100010");
    assertThat(result.status()).isEqualTo(InternalScoreResult.Status.NOT_CALCULABLE);
    assertThat(result.selectedScore()).isNull();
    assertThat(result.eligibleCount()).isEqualTo(5);
    assertThat(result.excluded())
        .extracting(InternalScoreResult.ExcludedRegion::regionCode)
        .containsExactly("missing", "negative", "nonfinite", "null", "source", "zeroStores");
    assertThat(result.excluded().get(4).reasons())
        .containsExactly(
            reason(InternalScoreResult.ReasonCode.INPUT_NULL, ScoreMetric.FOOT_TRAFFIC),
            reason(InternalScoreResult.ReasonCode.SOURCE_NOT_ELIGIBLE, ScoreMetric.SALES));
    assertThat(result.excluded().getFirst().reasons())
        .containsExactly(
            reason(InternalScoreResult.ReasonCode.INPUT_ROW_MISSING, ScoreMetric.SALES));
    assertThat(result.excluded().get(1).reasons())
        .hasSize(4)
        .allSatisfy(
            r -> assertThat(r.code()).isEqualTo(InternalScoreResult.ReasonCode.INPUT_NEGATIVE));
    assertThat(result.excluded().get(2).reasons())
        .containsExactly(
            reason(InternalScoreResult.ReasonCode.INPUT_NON_FINITE, ScoreMetric.FOOT_TRAFFIC),
            reason(InternalScoreResult.ReasonCode.INPUT_NON_FINITE, ScoreMetric.CLOSURE_RATE));
    assertThat(result.excluded().get(5).reasons())
        .containsExactly(
            reason(InternalScoreResult.ReasonCode.ZERO_STORE_COUNT, ScoreMetric.STORE_COUNT));
    assertThat(result.cohortScores())
        .extracting(ScoreCalculation.RegionScore::score)
        .containsExactly(
            fraction(40, 1), fraction(40, 1), fraction(45, 1), fraction(65, 1), fraction(60, 1));
    Collections.reverse(rows);
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DISTRICT, rows));
    var reordered = service.diagnoseDistrict("source", "20262", "CS100010");
    assertThat(reordered.excluded()).isEqualTo(result.excluded());
    assertThat(reordered.cohortScores()).isEqualTo(result.cohortScores());
  }

  @Test
  void reportsInsufficientCohortWithoutManufacturingScores() {
    for (var rows :
        List.of(List.of(row("a", "1", "1", "1", "1")), List.of(row("a", null, "1", "1", "1")))) {
      when(repository.findDongInputs("20262", "CS100010"))
          .thenReturn(snapshot(ScoreCalculation.RegionUnit.DONG, rows));
      var result = service.diagnoseDong("a", "20262", "CS100010");
      assertThat(result.status()).isEqualTo(InternalScoreResult.Status.NOT_CALCULABLE);
      assertThat(result.reasons().getFirst().code())
          .isEqualTo(InternalScoreResult.ReasonCode.INSUFFICIENT_COHORT);
      assertThat(result.cohortScores()).isEmpty();
      assertThat(result.selectedScore()).isNull();
    }
  }

  @Test
  void withholdsWholeCohortWhenAnyRequiredMetricIsConstant() {
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(
            snapshot(
                ScoreCalculation.RegionUnit.DONG,
                List.of(row("a", "1", "1", "1", "0.0"), row("b", "2", "2", "2", "0.00"))));
    var result = service.diagnoseDong("a", "20262", "CS100010");
    assertThat(result.status()).isEqualTo(InternalScoreResult.Status.NOT_CALCULABLE);
    assertThat(result.reasons())
        .containsExactly(
            reason(InternalScoreResult.ReasonCode.CONSTANT_INDICATOR, ScoreMetric.CLOSURE_RATE));
    assertThat(result.cohortScores()).isEmpty();
    assertThat(result.selectedScore()).isNull();
  }

  @Test
  void reportsAllConstantMetricsInStableOrderWithoutAssigningAFixedPublicScore() {
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(
            snapshot(
                ScoreCalculation.RegionUnit.DONG,
                List.of(row("a", "1", "1.0", "1", "0"), row("b", "1", "1.00", "1", "0.00"))));
    var result = service.diagnoseDong("a", "20262", "CS100010");
    assertStatus(result, InternalScoreResult.Status.NOT_CALCULABLE);
    assertThat(result.reasons())
        .extracting(InternalScoreResult.Reason::metric)
        .containsExactly(ScoreMetric.values());
    assertThat(result.reasons())
        .allSatisfy(
            r -> assertThat(r.code()).isEqualTo(InternalScoreResult.ReasonCode.CONSTANT_INDICATOR));
  }

  @Test
  void returnsImmutableInternalResultCollections() {
    var rows = new ArrayList<>(fiveRegions());
    rows.add(row("invalid", null, "1", "1", "0"));
    when(repository.findDongInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DONG, rows));
    var result = service.diagnoseDong("invalid", "20262", "CS100010");
    for (Runnable mutation :
        List.<Runnable>of(
            () -> result.excluded().clear(),
            () -> result.excluded().getFirst().reasons().clear(),
            () -> result.reasons().clear(),
            () -> result.cohortScores().clear())) {
      assertThatExceptionOfType(UnsupportedOperationException.class).isThrownBy(mutation::run);
    }
  }

  @ParameterizedTest
  @MethodSource("unsupportedInputs")
  void rejectsUnsupportedScopeWithoutQuery(String code, String quarter, String industry) {
    assertStatus(
        service.diagnoseDistrict(code, quarter, industry),
        InternalScoreResult.Status.UNSUPPORTED_INPUT);
    verifyNoInteractions(repository);
  }

  static Stream<Arguments> unsupportedInputs() {
    return Stream.of(
        Arguments.of("a", "20261", "CS100010"),
        Arguments.of("a", "20262", "CS100001"),
        Arguments.of(null, "20262", "CS100010"),
        Arguments.of(" ", "20262", "CS100010"),
        Arguments.of("a", null, "CS100010"));
  }

  @ParameterizedTest
  @MethodSource("databaseErrors")
  void separatesDatabaseResourceErrorsFromInternalFailures(
      RuntimeException error, InternalScoreResult.Status status) {
    when(repository.findDistrictInputs("20262", "CS100010")).thenThrow(error);
    var result = service.diagnoseDistrict("a", "20262", "CS100010");
    assertStatus(result, status);
    assertThat(result.toString()).doesNotContain("sensitive-sql");
  }

  static Stream<Arguments> databaseErrors() {
    return Stream.of(
        Arguments.of(
            new DataAccessResourceFailureException("sensitive-sql"),
            InternalScoreResult.Status.DATABASE_UNAVAILABLE),
        Arguments.of(
            new TransientDataAccessResourceException("sensitive-sql"),
            InternalScoreResult.Status.DATABASE_UNAVAILABLE),
        Arguments.of(
            new QueryTimeoutException("sensitive-sql"),
            InternalScoreResult.Status.DATABASE_UNAVAILABLE),
        Arguments.of(
            new BadSqlGrammarException("query", "sensitive-sql", new java.sql.SQLException()),
            InternalScoreResult.Status.INTERNAL_ERROR),
        Arguments.of(
            new IllegalStateException("sensitive-sql"), InternalScoreResult.Status.INTERNAL_ERROR));
  }

  @Test
  void treatsMalformedNumericOrMismatchedSnapshotAsInternalError() {
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(
            snapshot(
                ScoreCalculation.RegionUnit.DISTRICT, List.of(row("a", "invalid", "1", "1", "1"))));
    assertStatus(
        service.diagnoseDistrict("a", "20262", "CS100010"),
        InternalScoreResult.Status.INTERNAL_ERROR);
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(snapshot(ScoreCalculation.RegionUnit.DONG, fiveRegions()));
    assertStatus(
        service.diagnoseDistrict("라", "20262", "CS100010"),
        InternalScoreResult.Status.INTERNAL_ERROR);
  }

  private static void assertStatus(InternalScoreResult result, InternalScoreResult.Status status) {
    assertThat(result.status()).isEqualTo(status);
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.selectedScore()).isNull();
    assertThat(result.cohortScores()).isEmpty();
  }

  private static InternalScoreResult.Reason reason(
      InternalScoreResult.ReasonCode code, ScoreMetric metric) {
    return new InternalScoreResult.Reason(code, metric);
  }

  private static ExactFraction fraction(long numerator, long denominator) {
    return new ExactFraction(BigInteger.valueOf(numerator), BigInteger.valueOf(denominator));
  }

  private static ScoreInputSnapshot snapshot(
      ScoreCalculation.RegionUnit unit, List<ScoreInputSnapshot.RegionInput> rows) {
    return new ScoreInputSnapshot(
        unit,
        "20262",
        "CS100010",
        batch(),
        true,
        new ScoreInputSnapshot.DatasetReadiness(true, true, true),
        rows);
  }

  private static ScoreInputSnapshot.BatchMetadata batch() {
    return new ScoreInputSnapshot.BatchMetadata(
        new UUID(0, 1),
        "SYNTHETIC",
        "CSV",
        "SEOUL",
        null,
        "20262",
        "20262",
        null,
        "test",
        "PUBLISHED",
        null,
        null,
        null);
  }

  private static ScoreInputSnapshot.RawValue value(String raw) {
    return new ScoreInputSnapshot.RawValue(
        raw, new ScoreInputSnapshot.RowSource(true, new UUID(0, 1), batch(), true));
  }

  private static ScoreInputSnapshot.RegionInput row(
      String code, String sales, String foot, String stores, String closure) {
    return new ScoreInputSnapshot.RegionInput(
        code, code, "구", "구", value(sales), value(foot), value(stores), value(closure));
  }

  private static List<ScoreInputSnapshot.RegionInput> fiveRegions() {
    return List.of(
        row("가", "1000", "100", "10", "1"),
        row("나", "2000", "200", "30", "2"),
        row("다", "3000", "300", "40", "3"),
        row("라", "4000", "400", "20", "4"),
        row("마", "5000", "500", "50", "5"));
  }
}
