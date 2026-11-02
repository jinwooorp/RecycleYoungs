package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 일반 테스트는 합성 5지역만 검증하며 개발 DB 환경변수를 읽거나 DB에 연결하지 않는다. */
class ScoreRegressionTests {
  @Test
  void validatesSyntheticContributionSumsRanksAndPermutationButNeverClaimsFullR03() {
    var result = synthetic();
    var report = ScoreRegressionVerifier.verify(List.of(result), baseline());
    assertThat(report.differences()).isEmpty();
    assertThat(report.checkedRegions()).isEqualTo(5);
    assertThat(report.arithmeticPassed()).isTrue();
    assertThat(report.permutationPassed()).isTrue();
    assertThat(report.lines()).anySatisfy(line -> assertThat(line).contains("65.00", "65/1"));
    assertThat(report.lines()).anySatisfy(line -> assertThat(line).contains("R03_COMPLETE=false"));
  }

  @Test
  void reportsChangedCoverageProvenanceAndRepresentativeValuesInsteadOfAssumingCalculationBug() {
    var baseline =
        new ScoreRegressionVerifier.Baseline(
            new UUID(0, 99),
            Map.of(
                ScoreCalculation.RegionUnit.DISTRICT,
                new ScoreRegressionVerifier.Coverage(25, 25, Set.of())),
            Map.of(),
            List.of(
                new ScoreRegressionVerifier.ExpectedCase(
                    ScoreCalculation.RegionUnit.DISTRICT, "합성구", "라", "66.00", "2")));
    var report = ScoreRegressionVerifier.verify(List.of(synthetic()), baseline);
    assertThat(report.differences()).anyMatch(s -> s.startsWith("COVERAGE:"));
    assertThat(report.differences()).anyMatch(s -> s.startsWith("PROVENANCE:"));
    assertThat(report.differences()).anyMatch(s -> s.startsWith("REPRESENTATIVE:"));
    assertThat(report.arithmeticPassed()).isTrue();
  }

  @Test
  void detectsBrokenContributionAndRankWithoutReimplementingTheScoreAlgorithm() {
    var original = synthetic();
    var regions = new java.util.ArrayList<>(original.cohortScores());
    var first = regions.getFirst();
    regions.set(
        0,
        new ScoreCalculation.RegionScore(
            first.input(),
            first.components(),
            new ExactFraction(java.math.BigInteger.ZERO, java.math.BigInteger.ONE),
            first.rank()));
    var corrupted =
        new InternalScoreResult(
            original.request(),
            original.status(),
            original.snapshot(),
            original.eligibleCount(),
            original.excluded(),
            original.reasons(),
            regions,
            original.selectedScore());
    var report = ScoreRegressionVerifier.verify(List.of(corrupted), baseline());
    assertThat(report.arithmeticPassed()).isFalse();
    assertThat(report.differences()).anyMatch(s -> s.startsWith("CALCULATION:"));
  }

  @Test
  void detectsIncorrectAverageRankEvenWhenAllScoresAndContributionsAreUnchanged() {
    var original = synthetic();
    var regions = new java.util.ArrayList<>(original.cohortScores());
    var first = regions.getFirst();
    regions.set(
        0,
        new ScoreCalculation.RegionScore(
            first.input(),
            first.components(),
            first.score(),
            new ScoreCalculation.Rank(
                new ExactFraction(java.math.BigInteger.ONE, java.math.BigInteger.ONE), 1)));
    var report =
        ScoreRegressionVerifier.verify(
            List.of(
                new InternalScoreResult(
                    original.request(),
                    original.status(),
                    original.snapshot(),
                    original.eligibleCount(),
                    original.excluded(),
                    original.reasons(),
                    regions,
                    original.selectedScore())),
            baseline());
    assertThat(report.arithmeticPassed()).isFalse();
  }

  @Test
  void reportsChecksumDriftAsProvenanceDifferenceEvenWhenRepresentativeScoresStillMatch() {
    var original = baseline();
    var changed = new java.util.HashMap<>(original.sources());
    changed.put(
        "SEOUL_DISTRICT_SALES_STAT",
        new ScoreRegressionVerifier.ExpectedSource(
            new UUID(0, 3), "b".repeat(64), "20262", "20262", "test"));
    var report =
        ScoreRegressionVerifier.verify(
            List.of(synthetic()),
            new ScoreRegressionVerifier.Baseline(
                original.boundaryId(), original.coverage(), changed, original.cases()));
    assertThat(report.differences()).hasSize(1).allMatch(s -> s.startsWith("PROVENANCE:"));
    assertThat(report.arithmeticPassed()).isTrue();
  }

  @Test
  void disabledOrUnsafeConfigurationFailsBeforeAnyDatabaseConnectionAndDoesNotEchoSecrets() {
    var buffer = new ByteArrayOutputStream();
    var out = new PrintStream(buffer);
    assertThat(ScoreRegressionMain.execute(Map.of(), out)).isEqualTo(2);
    for (String query :
        List.of(
            "options=-c%20default_transaction_read_only%3Doff",
            "readOnly=false", "readOnlyMode=ignore", "password=sentinel-secret")) {
      assertThat(
              ScoreRegressionMain.execute(
                  Map.of(
                      "SCORE_REGRESSION_ENABLED",
                      "1",
                      "DB_JDBC_URL",
                      "jdbc:postgresql://invalid.invalid/test?" + query,
                      "DB_USER",
                      "sentinel-user",
                      "DB_PASSWORD",
                      "sentinel-secret"),
                  out))
          .isEqualTo(2);
    }
    assertThat(buffer.toString())
        .doesNotContain("sentinel", "invalid.invalid", "jdbc:", "password=");
  }

  static InternalScoreResult synthetic() {
    var rows =
        List.of(
            row("가", "1000", "100", "10", "1"),
            row("나", "2000", "200", "30", "2"),
            row("다", "3000", "300", "40", "3"),
            row("라", "4000", "400", "20", "4"),
            row("마", "5000", "500", "50", "5"));
    var snapshot =
        new ScoreInputSnapshot(
            ScoreCalculation.RegionUnit.DISTRICT,
            "20262",
            "CS100010",
            batch(1, "SEOUL_DONG_BOUNDARY"),
            true,
            new ScoreInputSnapshot.DatasetReadiness(true, true, true),
            rows);
    var calculation =
        new AScoreCalculator()
            .calculate(
                ScoreCalculation.RegionUnit.DISTRICT,
                rows.stream().map(r -> r.toScoreInput().orElseThrow()).toList());
    return new InternalScoreResult(
        new InternalScoreResult.Request(
            ScoreCalculation.RegionUnit.DISTRICT, "라", "20262", "CS100010"),
        InternalScoreResult.Status.INTERNAL_CALCULATED,
        snapshot,
        5,
        List.of(),
        List.of(),
        calculation.regions(),
        calculation.regions().get(3));
  }

  private static ScoreRegressionVerifier.Baseline baseline() {
    return new ScoreRegressionVerifier.Baseline(
        new UUID(0, 1),
        Map.of(
            ScoreCalculation.RegionUnit.DISTRICT,
            new ScoreRegressionVerifier.Coverage(5, 5, Set.of())),
        Map.of(
            "SEOUL_DISTRICT_STORE_STAT",
                new ScoreRegressionVerifier.ExpectedSource(
                    new UUID(0, 2), "a".repeat(64), "20262", "20262", "test"),
            "SEOUL_DISTRICT_SALES_STAT",
                new ScoreRegressionVerifier.ExpectedSource(
                    new UUID(0, 3), "a".repeat(64), "20262", "20262", "test"),
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
                new ScoreRegressionVerifier.ExpectedSource(
                    new UUID(0, 4), "a".repeat(64), "20262", "20262", "test")),
        List.of(
            new ScoreRegressionVerifier.ExpectedCase(
                ScoreCalculation.RegionUnit.DISTRICT, "합성구", "라", "65.00", "1")));
  }

  private static ScoreInputSnapshot.RegionInput row(
      String code, String sales, String foot, String stores, String closure) {
    return new ScoreInputSnapshot.RegionInput(
        code,
        code,
        "합성구",
        "합성구",
        value(sales, 3, "SEOUL_DISTRICT_SALES_STAT"),
        value(foot, 4, "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT"),
        value(stores, 2, "SEOUL_DISTRICT_STORE_STAT"),
        value(closure, 2, "SEOUL_DISTRICT_STORE_STAT"));
  }

  private static ScoreInputSnapshot.RawValue value(String raw, long id, String dataset) {
    return new ScoreInputSnapshot.RawValue(
        raw, new ScoreInputSnapshot.RowSource(true, new UUID(0, id), batch(id, dataset), true));
  }

  private static ScoreInputSnapshot.BatchMetadata batch(long id, String dataset) {
    return new ScoreInputSnapshot.BatchMetadata(
        new UUID(0, id),
        dataset,
        dataset.equals("SEOUL_DONG_BOUNDARY") ? "SHAPEFILE" : "CSV",
        "SEOUL",
        null,
        "20262",
        "20262",
        "a".repeat(64),
        "test",
        "PUBLISHED",
        java.time.OffsetDateTime.parse("2026-10-01T00:00:00Z"),
        null,
        java.time.OffsetDateTime.parse("2026-10-02T00:00:00Z"));
  }
}
