package kr.ac.recycleyoungs.score;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/** 전체 입력과 별도 기대 결과를 담는 메모리 아티팩트. 파일 저장·승인 manifest·공개 기능은 없다. */
public record ScoreSnapshotArtifact(
    Payload payload, String inputSnapshotId, Reproduction expected, OffsetDateTime requestedAt) {
  public static final String SCHEMA_VERSION = "score-input-v1";
  public static final String ALGORITHM_VERSION = "a-rank-v1-candidate.1";

  public ScoreSnapshotArtifact {
    Objects.requireNonNull(payload);
    Objects.requireNonNull(expected);
    if (inputSnapshotId == null
        || !inputSnapshotId.matches("[a-f0-9]{64}")
        || !inputSnapshotId.equals(
            ScoreSnapshotCodec.sha256(new ScoreSnapshotCodec().canonicalPayload(payload))))
      throw new IllegalArgumentException("입력 스냅샷 해시 불일치");
    requestedAt = utc(requestedAt);
  }

  /** 호출자는 요청 지역이 아니라 같은 조회 스냅샷의 전체 경계 코드 목록을 명시해야 한다. */
  public static ScoreSnapshotArtifact capture(
      ScoreInputSnapshot input, List<String> fullBoundaryCodes, OffsetDateTime requestedAt) {
    var normalized = normalize(input);
    requireReady(normalized);
    var evaluation = ScoreCohortEvaluator.evaluate(normalized);
    var excludedCodes =
        evaluation.excluded().stream().map(InternalScoreResult.ExcludedRegion::regionCode).toList();
    var eligible =
        normalized.regions().stream()
            .map(ScoreInputSnapshot.RegionInput::regionCode)
            .filter(c -> !excludedCodes.contains(c))
            .toList();
    var payload =
        new Payload(
            SCHEMA_VERSION,
            ALGORITHM_VERSION,
            candidatePolicy(),
            new Coverage(
                normalized.regions().size(), eligible.size(), evaluation.excluded().size()),
            normalized,
            fullBoundaryCodes,
            batches(normalized),
            eligible,
            evaluation.excluded());
    return seal(payload, project(evaluation), requestedAt);
  }

  /** 해시 생성은 무결성 봉인일 뿐 정책 승인이나 기대 결과 검증이 아니다. 재현은 replay가 수행한다. */
  public static ScoreSnapshotArtifact seal(
      Payload payload, Reproduction expected, OffsetDateTime requestedAt) {
    return new ScoreSnapshotArtifact(
        payload,
        ScoreSnapshotCodec.sha256(new ScoreSnapshotCodec().canonicalPayload(payload)),
        expected,
        requestedAt);
  }

  /** DB·Spring 없이 기존 계산기를 다시 실행하고 보존된 집단·제외·정확한 모든 결과를 대조한다. */
  public Reproduction replay() {
    if (!ALGORITHM_VERSION.equals(payload.algorithmVersion())
        || !candidatePolicy().equals(payload.policy()))
      throw new IllegalArgumentException("지원하지 않는 계산 정책");
    var evaluation = ScoreCohortEvaluator.evaluate(payload.input());
    var result = project(evaluation);
    var excludedCodes =
        result.excluded().stream().map(InternalScoreResult.ExcludedRegion::regionCode).toList();
    var eligible =
        payload.boundaryRegionCodes().stream().filter(c -> !excludedCodes.contains(c)).toList();
    if (!payload.eligibleRegionCodes().equals(eligible)
        || !payload.excludedRegions().equals(result.excluded())
        || !expected.equals(result)) throw new IllegalArgumentException("스냅샷 집단·제외·정확한 계산 결과 불일치");
    return result;
  }

  public InternalScoreResult.PublicationState publicationState() {
    return InternalScoreResult.PublicationState.NOT_APPROVED;
  }

  /** 해시 대상. 요청 시각·해시 자신·승인 메타데이터·기대 점수는 이 안에 넣지 않는다. */
  public record Payload(
      String snapshotSchemaVersion,
      String algorithmVersion,
      Map<String, String> policy,
      Coverage coverage,
      ScoreInputSnapshot input,
      List<String> boundaryRegionCodes,
      List<ScoreInputSnapshot.BatchMetadata> batches,
      List<String> eligibleRegionCodes,
      List<InternalScoreResult.ExcludedRegion> excludedRegions) {
    public Payload {
      if (!SCHEMA_VERSION.equals(snapshotSchemaVersion))
        throw new IllegalArgumentException("지원하지 않는 스키마");
      if (algorithmVersion == null || algorithmVersion.isBlank())
        throw new IllegalArgumentException("알고리즘 버전 필요");
      policy = Map.copyOf(policy);
      input = normalize(input);
      requireReady(input);
      boundaryRegionCodes = codes(boundaryRegionCodes);
      eligibleRegionCodes = codes(eligibleRegionCodes);
      var sortedBatches =
          new ArrayList<>(batches.stream().map(ScoreSnapshotArtifact::normalizeBatch).toList());
      sortedBatches.sort(Comparator.comparing(b -> b.batchId().toString()));
      batches = List.copyOf(sortedBatches);
      excludedRegions = exclusions(excludedRegions);
      var rowCodes =
          input.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList();
      if (!boundaryRegionCodes.equals(rowCodes))
        throw new IllegalArgumentException("전체 경계와 입력 행 불일치");
      var partition = new ArrayList<>(eligibleRegionCodes);
      excludedRegions.forEach(e -> partition.add(e.regionCode()));
      if (!codes(partition).equals(boundaryRegionCodes))
        throw new IllegalArgumentException("완비·제외 집단 불일치");
      if (coverage == null
          || coverage.boundaryRegionCount() != boundaryRegionCodes.size()
          || coverage.eligibleRegionCount() != eligibleRegionCodes.size()
          || coverage.excludedRegionCount() != excludedRegions.size())
        throw new IllegalArgumentException("집단 수와 실제 목록 불일치");
      if (!batches.equals(ScoreSnapshotArtifact.batches(input)))
        throw new IllegalArgumentException("출처 배치 목록 불일치");
      validateSources(input);
    }
  }

  public record Coverage(
      int boundaryRegionCount, int eligibleRegionCount, int excludedRegionCount) {
    public Coverage {
      if (boundaryRegionCount < 1
          || eligibleRegionCount < 0
          || excludedRegionCount < 0
          || (long) eligibleRegionCount + excludedRegionCount != boundaryRegionCount)
        throw new IllegalArgumentException("잘못된 집단 수");
    }
  }

  /** 입력 해시와 분리한 재현 기대 결과. 소수 표시가 아니라 약분된 분수만 보존한다. */
  public record Reproduction(
      int eligibleCount,
      List<InternalScoreResult.ExcludedRegion> excluded,
      List<InternalScoreResult.Reason> reasons,
      List<Result> scores) {
    public Reproduction {
      if (eligibleCount < 0) throw new IllegalArgumentException("잘못된 집단 크기");
      excluded = exclusions(excluded);
      reasons = ScoreSnapshotArtifact.reasons(reasons);
      scores =
          scores.stream()
              .sorted(
                  Comparator.comparing(Result::regionCode, ScoreSnapshotCodec::compareCodePoints))
              .toList();
      codes(scores.stream().map(Result::regionCode).toList());
    }
  }

  public record Result(
      String regionCode,
      Map<ScoreMetric, Component> components,
      Fraction score,
      Fraction averageRank,
      int tieCount) {
    public Result {
      if (regionCode == null || regionCode.isBlank() || tieCount < 1)
        throw new IllegalArgumentException("잘못된 지역 결과");
      var ordered = new EnumMap<ScoreMetric, Component>(ScoreMetric.class);
      ordered.putAll(components);
      if (ordered.size() != ScoreMetric.values().length
          || ordered.values().stream().anyMatch(Objects::isNull))
        throw new IllegalArgumentException("네 지표 결과 필요");
      components = Collections.unmodifiableMap(ordered);
      Objects.requireNonNull(score);
      Objects.requireNonNull(averageRank);
    }
  }

  public record Component(Fraction normalized, Fraction contribution) {
    public Component {
      Objects.requireNonNull(normalized);
      Objects.requireNonNull(contribution);
    }
  }

  public record Fraction(String numerator, String denominator) {
    public Fraction {
      var value = new ExactFraction(new BigInteger(numerator), new BigInteger(denominator));
      if (!value.numerator().toString().equals(numerator)
          || !value.denominator().toString().equals(denominator))
        throw new IllegalArgumentException("약분된 양의 분모 분수 필요");
    }

    static Fraction of(ExactFraction value) {
      return new Fraction(value.numerator().toString(), value.denominator().toString());
    }
  }

  /** 현재 Service가 사용 중인 후보 규칙의 식별자. 이 목록을 공개 정책 승인으로 해석하지 않는다. */
  public static Map<String, String> candidatePolicy() {
    return Map.ofEntries(
        Map.entry("model", "A"), Map.entry("normalization", "AVERAGE_RANK"),
        Map.entry("salesColumn", "monthly_sales_amount"),
            Map.entry("footTrafficColumn", "total_foot_traffic"),
        Map.entry("storeColumn", "store_count"), Map.entry("closureColumn", "closure_rate"),
        Map.entry("salesWeight", "0.30"), Map.entry("footTrafficWeight", "0.30"),
        Map.entry("storeWeight", "0.20"), Map.entry("closureWeight", "0.20"),
        Map.entry("salesDirection", "INCREASING"), Map.entry("footTrafficDirection", "INCREASING"),
        Map.entry("storeDirection", "DECREASING"), Map.entry("closureDirection", "DECREASING"),
        Map.entry("inputValidation", "SERVICE_CANDIDATE_1"),
            Map.entry("missing", "EXCLUDE_NO_IMPUTATION"),
        Map.entry("zeroStore", "EXCLUDE"), Map.entry("zeroSalesFootClosure", "KEEP"),
        Map.entry("negativeNonFinite", "EXCLUDE"), Map.entry("minimumCohort", "2"),
        Map.entry("constantIndicator", "HOLD_ENTIRE_COHORT"),
            Map.entry("finalTie", "EXACT_AVERAGE_RANK"),
        Map.entry("precision", "BIG_INTEGER_REDUCED_FRACTION"), Map.entry("rounding", "HALF_UP"),
        Map.entry("scoreContributionScale", "2"), Map.entry("normalizedScale", "12"),
        Map.entry("quarter", "20262"), Map.entry("industry", "CS100010"),
        Map.entry("cohort", "SEOUL_SEPARATE_DISTRICT_DONG"),
            Map.entry("compensation", "WEIGHTED_SUM_NO_SALES_FLOOR"));
  }

  private static Reproduction project(ScoreCohortEvaluator.Evaluation e) {
    var results =
        e.scores().stream()
            .map(
                r -> {
                  var components = new EnumMap<ScoreMetric, Component>(ScoreMetric.class);
                  r.components()
                      .forEach(
                          (m, c) ->
                              components.put(
                                  m,
                                  new Component(
                                      Fraction.of(c.normalized()), Fraction.of(c.contribution()))));
                  return new Result(
                      r.input().regionCode(),
                      components,
                      Fraction.of(r.score()),
                      Fraction.of(r.rank().average()),
                      r.rank().tieCount());
                })
            .toList();
    return new Reproduction(e.eligibleCount(), e.excluded(), e.reasons(), results);
  }

  private static List<String> codes(List<String> codes) {
    if (codes.stream().anyMatch(c -> c == null || c.isBlank())
        || new HashSet<>(codes).size() != codes.size())
      throw new IllegalArgumentException("지역 목록의 빈 코드·중복 금지");
    return codes.stream().sorted(ScoreSnapshotCodec::compareCodePoints).toList();
  }

  private static List<InternalScoreResult.Reason> reasons(
      List<InternalScoreResult.Reason> reasons) {
    if (reasons.stream().anyMatch(r -> r == null || r.code() == null)
        || new HashSet<>(reasons).size() != reasons.size())
      throw new IllegalArgumentException("잘못된 사유 목록");
    return reasons.stream()
        .sorted(
            Comparator.comparing(InternalScoreResult.Reason::code)
                .thenComparing(
                    InternalScoreResult.Reason::metric,
                    Comparator.nullsFirst(Comparator.naturalOrder())))
        .toList();
  }

  private static List<InternalScoreResult.ExcludedRegion> exclusions(
      List<InternalScoreResult.ExcludedRegion> excluded) {
    var result =
        excluded.stream()
            .map(
                e -> {
                  var ordered = reasons(e.reasons());
                  if (ordered.isEmpty() || ordered.stream().anyMatch(r -> r.metric() == null))
                    throw new IllegalArgumentException("지표별 제외 사유 필요");
                  return new InternalScoreResult.ExcludedRegion(e.regionCode(), ordered);
                })
            .sorted(
                Comparator.comparing(
                    InternalScoreResult.ExcludedRegion::regionCode,
                    ScoreSnapshotCodec::compareCodePoints))
            .toList();
    codes(result.stream().map(InternalScoreResult.ExcludedRegion::regionCode).toList());
    return result;
  }

  private static ScoreInputSnapshot normalize(ScoreInputSnapshot input) {
    var rows =
        input.regions().stream()
            .map(
                r ->
                    new ScoreInputSnapshot.RegionInput(
                        r.regionCode(),
                        r.regionName(),
                        r.districtCode(),
                        r.districtName(),
                        normalizeValue(r.sales()),
                        normalizeValue(r.footTraffic()),
                        normalizeValue(r.storeCount()),
                        normalizeValue(r.closureRate())))
            .sorted(
                Comparator.comparing(
                    ScoreInputSnapshot.RegionInput::regionCode,
                    ScoreSnapshotCodec::compareCodePoints))
            .toList();
    return new ScoreInputSnapshot(
        input.unit(),
        input.quarterCode(),
        input.industryCode(),
        normalizeBatch(input.boundary()),
        input.boundaryRowsPresent(),
        input.readiness(),
        rows);
  }

  private static ScoreInputSnapshot.RawValue normalizeValue(ScoreInputSnapshot.RawValue v) {
    var s = v.source();
    return new ScoreInputSnapshot.RawValue(
        v.raw(),
        new ScoreInputSnapshot.RowSource(
            s.rowPresent(), s.sourceBatchId(), normalizeBatch(s.batch()), s.eligible()));
  }

  private static ScoreInputSnapshot.BatchMetadata normalizeBatch(
      ScoreInputSnapshot.BatchMetadata b) {
    if (b == null) return null;
    Objects.requireNonNull(b.batchId());
    Objects.requireNonNull(b.datasetCode());
    Objects.requireNonNull(b.sourceType());
    Objects.requireNonNull(b.scopeType());
    Objects.requireNonNull(b.status());
    return new ScoreInputSnapshot.BatchMetadata(
        b.batchId(),
        b.datasetCode(),
        b.sourceType(),
        b.scopeType(),
        b.scopeCode(),
        b.periodFrom(),
        b.periodTo(),
        b.sourceChecksum(),
        b.etlVersion(),
        b.status(),
        utc(b.startedAt()),
        utc(b.finishedAt()),
        utc(b.publishedAt()));
  }

  private static OffsetDateTime utc(OffsetDateTime t) {
    return t == null ? null : t.withOffsetSameInstant(ZoneOffset.UTC);
  }

  private static List<ScoreInputSnapshot.BatchMetadata> batches(ScoreInputSnapshot input) {
    var indexed = new TreeMap<String, ScoreInputSnapshot.BatchMetadata>();
    var all = new ArrayList<ScoreInputSnapshot.BatchMetadata>();
    all.add(input.boundary());
    input
        .regions()
        .forEach(
            r ->
                values(r)
                    .forEach(
                        v -> {
                          if (v.source().batch() != null) all.add(v.source().batch());
                        }));
    for (var b : all) {
      var previous = indexed.put(b.batchId().toString(), b);
      if (previous != null && !previous.equals(b))
        throw new IllegalArgumentException("같은 배치 ID의 메타데이터 충돌");
    }
    return List.copyOf(indexed.values());
  }

  private static List<ScoreInputSnapshot.RawValue> values(ScoreInputSnapshot.RegionInput r) {
    return List.of(r.sales(), r.footTraffic(), r.storeCount(), r.closureRate());
  }

  static void requireReady(ScoreInputSnapshot input) {
    var ready = input.readiness();
    if (!"20262".equals(input.quarterCode())
        || !"CS100010".equals(input.industryCode())
        || input.boundary() == null
        || !input.boundaryRowsPresent()
        || input.regions().isEmpty()
        || !ready.stores()
        || !ready.sales()
        || !ready.footTraffic()) throw new IllegalArgumentException("전체 경계·데이터셋이 준비된 지원 대상만 보존 가능");
  }

  private static void validateSources(ScoreInputSnapshot input) {
    if (!qualified(input.boundary(), "SEOUL_DONG_BOUNDARY", "SHAPEFILE"))
      throw new IllegalArgumentException("경계 출처 부적격");
    for (var r : input.regions()) {
      if (!r.storeCount().source().equals(r.closureRate().source()))
        throw new IllegalArgumentException("점포·폐업률 행 출처 불일치");
      var values = values(r);
      String[] kinds = {"SALES", "FOOT_TRAFFIC", "STORE", "STORE"};
      for (int i = 0; i < values.size(); i++) {
        var v = values.get(i);
        var s = v.source();
        if (!s.rowPresent()
            && (v.raw() != null || s.sourceBatchId() != null || s.batch() != null || s.eligible()))
          throw new IllegalArgumentException("행 없음과 원본·출처 상태 모순");
        // 부적격 행도 실제 출처를 보존해야 하므로 적격성 판정과 별도로 완전성을 확인한다.
        if (s.rowPresent() && (s.sourceBatchId() == null || s.batch() == null))
          throw new IllegalArgumentException("존재하는 행의 출처 ID·배치 메타데이터 필요");
        if (s.batch() != null && !s.batch().batchId().equals(s.sourceBatchId()))
          throw new IllegalArgumentException("실제 행 출처 ID 불일치");
        boolean eligible =
            s.rowPresent()
                && s.batch() != null
                && qualified(s.batch(), "SEOUL_" + input.unit() + "_" + kinds[i] + "_STAT", "CSV");
        if (eligible != s.eligible()) throw new IllegalArgumentException("행 출처 적격성 불일치");
      }
    }
  }

  private static boolean qualified(
      ScoreInputSnapshot.BatchMetadata b, String dataset, String type) {
    return dataset.equals(b.datasetCode())
        && type.equals(b.sourceType())
        && "SEOUL".equals(b.scopeType())
        && b.scopeCode() == null
        && "PUBLISHED".equals(b.status())
        && b.publishedAt() != null;
  }
}
