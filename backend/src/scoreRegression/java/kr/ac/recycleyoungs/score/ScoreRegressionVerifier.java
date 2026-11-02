package kr.ac.recycleyoungs.score;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import java.util.stream.Collectors;

/** 원본을 저장하거나 새 점수 공식을 만들지 않고 기존 계산 결과와 명시된 관찰 기준선만 검증한다. */
public final class ScoreRegressionVerifier {
  private ScoreRegressionVerifier() {}

  public record Coverage(int boundaryCount, int eligibleCount, Set<String> exclusions) {
    public Coverage {
      exclusions = Set.copyOf(exclusions);
    }
  }

  public record ExpectedSource(
      UUID batchId, String checksum, String periodFrom, String periodTo, String etlVersion) {}

  public record ExpectedCase(
      ScoreCalculation.RegionUnit unit,
      String districtName,
      String regionName,
      String display,
      String rank) {}

  public record Baseline(
      UUID boundaryId,
      Map<ScoreCalculation.RegionUnit, Coverage> coverage,
      Map<String, ExpectedSource> sources,
      List<ExpectedCase> cases) {
    public Baseline {
      coverage = Map.copyOf(coverage);
      sources = Map.copyOf(sources);
      cases = List.copyOf(cases);
    }
  }

  public record Report(
      List<String> lines,
      List<String> differences,
      int checkedRegions,
      boolean arithmeticPassed,
      boolean permutationPassed) {
    public Report {
      lines = List.copyOf(lines);
      differences = List.copyOf(differences);
    }
  }

  public static Report verify(List<InternalScoreResult> results, Baseline baseline) {
    var lines = new ArrayList<String>();
    var differences = new ArrayList<String>();
    var indexed =
        new EnumMap<ScoreCalculation.RegionUnit, InternalScoreResult>(
            ScoreCalculation.RegionUnit.class);
    var sources = new TreeMap<String, ScoreInputSnapshot.BatchMetadata>();
    boolean arithmetic = true;
    boolean permutation = true;
    int checked = 0;
    for (var result : results) {
      if (indexed.put(result.request().unit(), result) != null)
        differences.add("COVERAGE: duplicate unit");
    }
    if (!indexed.keySet().equals(baseline.coverage().keySet()))
      differences.add("COVERAGE: unit set changed");
    for (var unit : ScoreCalculation.RegionUnit.values()) {
      var result = indexed.get(unit);
      if (result == null) continue;
      var snapshot = result.snapshot();
      if (snapshot == null) {
        differences.add("CALCULATION: " + unit + " status=" + result.status());
        arithmetic = false;
        permutation = false;
        continue;
      }
      addSource(sources, snapshot.boundary());
      if (snapshot.boundary() == null
          || !snapshot.boundaryRowsPresent()
          || !Objects.equals(snapshot.boundary().batchId(), baseline.boundaryId())) {
        differences.add("PROVENANCE: " + unit + " boundary differs or is not ready");
      }
      if (snapshot.boundary() != null
          && !qualified(snapshot.boundary(), "SEOUL_DONG_BOUNDARY", "SHAPEFILE")) {
        differences.add("PROVENANCE: " + unit + " boundary not qualified");
      }
      var exclusionKeys =
          result.excluded().stream()
              .flatMap(
                  e ->
                      e.reasons().stream()
                          .map(r -> e.regionCode() + "|" + r.metric() + "|" + r.code()))
              .collect(Collectors.toSet());
      lines.add(
          "COVERAGE "
              + unit
              + " boundary="
              + snapshot.regions().size()
              + " eligible="
              + result.eligibleCount()
              + " excluded="
              + result.excluded().size()
              + " status="
              + result.status()
              + " publication="
              + result.publicationState());
      var expected = baseline.coverage().get(unit);
      if (expected == null
          || expected.boundaryCount() != snapshot.regions().size()
          || !Objects.equals(expected.eligibleCount(), result.eligibleCount())
          || !expected.exclusions().equals(exclusionKeys)) {
        differences.add(
            "COVERAGE: " + unit + " observed counts/exclusions differ from historical baseline");
      }
      for (var excluded : result.excluded()) {
        String name =
            snapshot.regions().stream()
                .filter(r -> r.regionCode().equals(excluded.regionCode()))
                .map(ScoreInputSnapshot.RegionInput::regionName)
                .findFirst()
                .orElse("unknown");
        lines.add(
            "EXCLUDED "
                + unit
                + " "
                + excluded.regionCode()
                + " "
                + name
                + " "
                + excluded.reasons());
      }
      for (var metric : ScoreMetric.values()) {
        var counts =
            new EnumMap<ScoreInputSnapshot.MeasurementState, Integer>(
                ScoreInputSnapshot.MeasurementState.class);
        int zero = 0;
        int negative = 0;
        for (var row : snapshot.regions()) {
          var raw = value(row, metric);
          counts.merge(raw.state(), 1, Integer::sum);
          if (raw.state() == ScoreInputSnapshot.MeasurementState.PRESENT) {
            int sign = new BigDecimal(raw.raw()).signum();
            if (sign == 0) zero++;
            if (sign < 0) negative++;
          }
          addSource(sources, raw.source().batch());
          String kind =
              switch (metric) {
                case SALES -> "SALES";
                case FOOT_TRAFFIC -> "FOOT_TRAFFIC";
                default -> "STORE";
              };
          String dataset = "SEOUL_" + unit + "_" + kind + "_STAT";
          boolean eligible =
              raw.source().rowPresent()
                  && raw.source().batch() != null
                  && Objects.equals(raw.source().sourceBatchId(), raw.source().batch().batchId())
                  && qualified(raw.source().batch(), dataset, "CSV");
          if (eligible != raw.source().eligible())
            differences.add(
                "PROVENANCE: row eligibility disagreement "
                    + unit
                    + "/"
                    + row.regionCode()
                    + "/"
                    + metric);
        }
        lines.add(
            "METRIC_ALL_BOUNDARIES "
                + unit
                + " "
                + metric
                + " "
                + counts
                + " actualZero="
                + zero
                + " negative="
                + negative);
      }
      if (result.eligibleCount() == null) {
        differences.add("CALCULATION: " + unit + " inputs were not evaluated: " + result.status());
        arithmetic = false;
        permutation = false;
        continue;
      }
      // 기존 입력 변환과 계산기를 재사용하며 A 점수 계산 자체를 복제하지 않는다.
      var inputs = snapshot.regions().stream().flatMap(r -> r.toScoreInput().stream()).toList();
      var calculator = new AScoreCalculator();
      var reference = calculator.calculate(unit, inputs);
      boolean consistent =
          reference.regions().equals(result.cohortScores())
              && reference.eligibleCount() == result.eligibleCount()
              && checkArithmetic(result.cohortScores())
              && !result.cohortScores().isEmpty();
      if (!consistent)
        differences.add(
            "CALCULATION: "
                + unit
                + " service parity, contribution/rank identity or cohort calculation failed");
      arithmetic &= consistent;
      var reversed = new ArrayList<>(inputs);
      Collections.reverse(reversed);
      boolean unchanged = calculator.calculate(unit, reversed).equals(reference);
      if (!unchanged) differences.add("PERMUTATION: " + unit + " input order changed the result");
      permutation &= unchanged;
      checked += result.cohortScores().size();
      for (var metric : ScoreMetric.values()) {
        long zeros =
            reference.regions().stream()
                .filter(r -> r.input().numericValue(metric).signum() == 0)
                .count();
        lines.add("ELIGIBLE_ZERO " + unit + " " + metric + "=" + zeros);
      }
      lines.add(
          "CHECK " + unit + " arithmetic=" + consistent + " inputOrderInvariant=" + unchanged);
    }
    for (var source : sources.values()) {
      lines.add(
          "SOURCE "
              + source.datasetCode()
              + " id="
              + source.batchId()
              + " checksum="
              + source.sourceChecksum()
              + " period="
              + source.periodFrom()
              + "~"
              + source.periodTo()
              + " etl="
              + source.etlVersion()
              + " status="
              + source.status()
              + " started="
              + source.startedAt()
              + " published="
              + source.publishedAt());
    }
    for (var expected : new TreeMap<>(baseline.sources()).entrySet()) {
      var actual =
          sources.values().stream().filter(s -> s.datasetCode().equals(expected.getKey())).toList();
      var wanted = expected.getValue();
      if (actual.size() != 1
          || !actual.getFirst().batchId().equals(wanted.batchId())
          || !Objects.equals(actual.getFirst().sourceChecksum(), wanted.checksum())
          || !Objects.equals(actual.getFirst().periodFrom(), wanted.periodFrom())
          || !Objects.equals(actual.getFirst().periodTo(), wanted.periodTo())
          || !Objects.equals(actual.getFirst().etlVersion(), wanted.etlVersion())) {
        differences.add("PROVENANCE: " + expected.getKey() + " batch/checksum/period/etl differs");
      }
    }
    for (var expected : baseline.cases()) {
      var result = indexed.get(expected.unit());
      var row =
          result == null || result.snapshot() == null
              ? null
              : result.snapshot().regions().stream()
                  .filter(
                      r ->
                          r.districtName().equals(expected.districtName())
                              && r.regionName().equals(expected.regionName()))
                  .findFirst()
                  .orElse(null);
      var score =
          row == null
              ? null
              : result.cohortScores().stream()
                  .filter(r -> r.input().regionCode().equals(row.regionCode()))
                  .findFirst()
                  .orElse(null);
      if (score == null) {
        differences.add(
            "REPRESENTATIVE: "
                + expected.unit()
                + "/"
                + expected.districtName()
                + "/"
                + expected.regionName()
                + " unavailable");
        continue;
      }
      String display = score.score().toDecimal(2, RoundingMode.HALF_UP).toPlainString();
      String rank =
          score
              .rank()
              .average()
              .toDecimal(1, RoundingMode.UNNECESSARY)
              .stripTrailingZeros()
              .toPlainString();
      lines.add(
          "CASE "
              + expected.unit()
              + " "
              + row.districtName()
              + " "
              + row.regionName()
              + " "
              + row.regionCode()
              + " display="
              + display
              + " exact="
              + fraction(score.score())
              + " rank="
              + rank
              + " rankExact="
              + fraction(score.rank().average())
              + " tieCount="
              + score.rank().tieCount());
      lines.add(
          "CONTRIBUTIONS "
              + row.regionCode()
              + " "
              + java.util.Arrays.stream(ScoreMetric.values())
                  .map(m -> m + "=" + fraction(score.components().get(m).contribution()))
                  .collect(Collectors.joining(" ")));
      if (!display.equals(expected.display())
          || score
                  .rank()
                  .average()
                  .toDecimal(1, RoundingMode.UNNECESSARY)
                  .compareTo(new BigDecimal(expected.rank()))
              != 0) {
        differences.add(
            "REPRESENTATIVE: "
                + row.regionCode()
                + " expected="
                + expected.display()
                + "/"
                + expected.rank()
                + " actual="
                + display
                + "/"
                + rank);
      }
    }
    lines.add(
        "R03_COMPLETE=false historicalFullInputFixture=UNAVAILABLE inputSnapshotSaved=false publication=NOT_APPROVED");
    return new Report(lines, differences, checked, arithmetic, permutation);
  }

  /** 계산을 새로 수행하지 않고 정규화×비중·기여 합계·동점 순위의 정확한 관계를 확인한다. */
  private static boolean checkArithmetic(List<ScoreCalculation.RegionScore> scores) {
    var zero = new ExactFraction(BigInteger.ZERO, BigInteger.ONE);
    var one = new ExactFraction(BigInteger.ONE, BigInteger.ONE);
    var hundred = new ExactFraction(BigInteger.valueOf(100), BigInteger.ONE);
    for (var row : scores) {
      var sum = zero;
      if (row.components().size() != ScoreMetric.values().length
          || row.score().compareTo(zero) < 0
          || row.score().compareTo(hundred) > 0) return false;
      for (var metric : ScoreMetric.values()) {
        var component = row.components().get(metric);
        if (component == null
            || component.normalized().compareTo(zero) < 0
            || component.normalized().compareTo(one) > 0) return false;
        var weight = metric.weight();
        var expected =
            new ExactFraction(
                component
                    .normalized()
                    .numerator()
                    .multiply(weight.numerator())
                    .multiply(BigInteger.valueOf(100)),
                component.normalized().denominator().multiply(weight.denominator()));
        if (!expected.equals(component.contribution())) return false;
        sum = sum.add(component.contribution());
      }
      if (!sum.equals(row.score())) return false;
      long higher = scores.stream().filter(r -> r.score().compareTo(row.score()) > 0).count();
      long equal = scores.stream().filter(r -> r.score().equals(row.score())).count();
      var averageRank =
          new ExactFraction(
              BigInteger.valueOf(higher)
                  .multiply(BigInteger.TWO)
                  .add(BigInteger.valueOf(equal))
                  .add(BigInteger.ONE),
              BigInteger.TWO);
      if (!averageRank.equals(row.rank().average()) || row.rank().tieCount() != equal) return false;
    }
    return true;
  }

  private static boolean qualified(
      ScoreInputSnapshot.BatchMetadata batch, String dataset, String type) {
    return dataset.equals(batch.datasetCode())
        && type.equals(batch.sourceType())
        && "SEOUL".equals(batch.scopeType())
        && batch.scopeCode() == null
        && "PUBLISHED".equals(batch.status())
        && batch.publishedAt() != null;
  }

  private static ScoreInputSnapshot.RawValue value(
      ScoreInputSnapshot.RegionInput row, ScoreMetric metric) {
    return switch (metric) {
      case SALES -> row.sales();
      case FOOT_TRAFFIC -> row.footTraffic();
      case STORE_COUNT -> row.storeCount();
      case CLOSURE_RATE -> row.closureRate();
    };
  }

  private static void addSource(
      Map<String, ScoreInputSnapshot.BatchMetadata> sources,
      ScoreInputSnapshot.BatchMetadata batch) {
    if (batch != null) sources.put(batch.datasetCode() + "/" + batch.batchId(), batch);
  }

  private static String fraction(ExactFraction value) {
    return value.numerator() + "/" + value.denominator();
  }

  /** 2026-11-02 기존 조사 기록의 관찰값이며 승인 정책이나 미래의 고정 커버리지가 아니다. */
  public static Baseline historical() {
    var sources =
        Map.of(
            "SEOUL_DISTRICT_STORE_STAT",
                expected(
                    "d3fbcf90-18e3-4c20-bd30-cf29abdbe748",
                    "84702068872a5ab8c6c824f11294a16f8b306afb6c19a25689af4c135bf377fd",
                    "20211",
                    "district-store-stat-v1"),
            "SEOUL_DISTRICT_SALES_STAT",
                expected(
                    "19bcbf8b-9ef4-41fe-8a31-e3e2f861a349",
                    "d78b04e3367195f3bee78db3fb4c1cb95091b4e30ed2943b1f235c6abca85daa",
                    "20211",
                    "district-sales-stat-v1"),
            "SEOUL_DISTRICT_FOOT_TRAFFIC_STAT",
                expected(
                    "7d40f4b8-2eba-4b98-af54-477608c51856",
                    "b29fbba82196f94eff890782e904d55b50fb1de6e0a5907fffa432a9e042a4fb",
                    "20211",
                    "district-foot-traffic-stat-v1"),
            "SEOUL_DONG_STORE_STAT",
                expected(
                    "8ec56d06-0751-43c2-acf8-8ddbe2805c24",
                    "174b5e47f1874209b2f4246b2888a63ccc8a4a04819a5f18b675932c8adc632c",
                    "20251",
                    "store-stat-v1"),
            "SEOUL_DONG_SALES_STAT",
                expected(
                    "cf227b7c-e89b-40c6-8aee-7ab79ab203e4",
                    "57ce0737c3fc3c6a3f7ac63dd7cf3b7b40c2fff1bf2175d48f4d6509add9884a",
                    "20251",
                    "sales-stat-v1"),
            "SEOUL_DONG_FOOT_TRAFFIC_STAT",
                expected(
                    "7c0fa332-07a4-49c2-b0d6-d663034c1ccd",
                    "2524e3a8383978353b869bcc2f9eae402fa55655fe60c43f0cfe8c588ff7f9f1",
                    "20211",
                    "foot-traffic-stat-v1"));
    return new Baseline(
        UUID.fromString("e8653cde-14bd-42e1-b539-d6ac6e355fd5"),
        Map.of(
            ScoreCalculation.RegionUnit.DISTRICT, new Coverage(25, 25, Set.of()),
            ScoreCalculation.RegionUnit.DONG,
                new Coverage(
                    425,
                    421,
                    Set.of(
                        "11260550|SALES|INPUT_ROW_MISSING",
                        "11350612|SALES|INPUT_ROW_MISSING",
                        "11410710|SALES|INPUT_ROW_MISSING",
                        "11680660|SALES|INPUT_ROW_MISSING"))),
        sources,
        List.of(
            new ExpectedCase(ScoreCalculation.RegionUnit.DISTRICT, "강남구", "강남구", "72.50", "2"),
            new ExpectedCase(ScoreCalculation.RegionUnit.DONG, "마포구", "서교동", "67.76", "23"),
            new ExpectedCase(ScoreCalculation.RegionUnit.DONG, "서대문구", "신촌동", "73.31", "3"),
            new ExpectedCase(ScoreCalculation.RegionUnit.DONG, "관악구", "삼성동", "60.36", "83"),
            new ExpectedCase(ScoreCalculation.RegionUnit.DONG, "성북구", "돈암1동", "41.36", "322.5"),
            new ExpectedCase(ScoreCalculation.RegionUnit.DONG, "서대문구", "북아현동", "64.50", "45")));
  }

  private static ExpectedSource expected(String id, String checksum, String from, String version) {
    return new ExpectedSource(UUID.fromString(id), checksum, from, "20262", version);
  }
}
