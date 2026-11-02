package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

/** 합성 전체 경계만 사용해 입력의 무결성과 DB 없는 재현을 검증한다. 실제 DB·파일 I/O는 없다. */
class ScoreSnapshotTests {
  private final ScoreSnapshotCodec codec = new ScoreSnapshotCodec();

  @Test
  void reproducesFiveRegionScoresContributionsAndTiedRanksWithoutSpringOrDatabase() {
    var artifact = capture(fixture(ScoreCalculation.RegionUnit.DISTRICT));
    var restored = codec.decode(codec.encode(artifact));
    var replay = restored.replay();
    assertThat(replay.scores())
        .extracting(ScoreSnapshotArtifact.Result::score)
        .containsExactly(
            fraction(40, 1), fraction(40, 1), fraction(45, 1), fraction(65, 1), fraction(60, 1));
    assertThat(replay.scores())
        .extracting(ScoreSnapshotArtifact.Result::averageRank)
        .containsExactly(
            fraction(9, 2), fraction(9, 2), fraction(3, 1), fraction(1, 1), fraction(2, 1));
    var ra = replay.scores().get(3);
    assertThat(ra.components().values())
        .extracting(ScoreSnapshotArtifact.Component::contribution)
        .containsExactly(fraction(45, 2), fraction(45, 2), fraction(15, 1), fraction(5, 1));
    assertThat(restored.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(codec.encode(restored)).isEqualTo(codec.encode(artifact));
  }

  @Test
  void canonicalizesRegionBatchPartitionAndReasonOrderAndIgnoresRequestTimeInHash() {
    var a = capture(withInvalidRows());
    var p = a.payload();
    var rows = new ArrayList<>(p.input().regions());
    Collections.reverse(rows);
    var batches = new ArrayList<>(p.batches());
    Collections.reverse(batches);
    var boundary = new ArrayList<>(p.boundaryRegionCodes());
    Collections.reverse(boundary);
    var eligible = new ArrayList<>(p.eligibleRegionCodes());
    Collections.reverse(eligible);
    var excluded = new ArrayList<>(p.excludedRegions());
    Collections.reverse(excluded);
    excluded.replaceAll(
        e -> {
          var reasons = new ArrayList<>(e.reasons());
          Collections.reverse(reasons);
          return new InternalScoreResult.ExcludedRegion(e.regionCode(), reasons);
        });
    var changed =
        new ScoreSnapshotArtifact.Payload(
            p.snapshotSchemaVersion(),
            p.algorithmVersion(),
            p.policy(),
            p.coverage(),
            replaceRows(p.input(), rows),
            boundary,
            batches,
            eligible,
            excluded);
    var b =
        ScoreSnapshotArtifact.seal(
            changed, a.expected(), OffsetDateTime.parse("2026-11-03T00:00:00Z"));
    var reordered = ScoreSnapshotArtifact.seal(changed, a.expected(), a.requestedAt());
    assertThat(codec.encode(reordered)).isEqualTo(codec.encode(a));
    assertThat(codec.canonicalPayload(a.payload())).isEqualTo(codec.canonicalPayload(b.payload()));
    assertThat(b.inputSnapshotId()).isEqualTo(a.inputSnapshotId());
    assertThat(b.requestedAt()).isNotEqualTo(a.requestedAt());
    assertThat(codec.decode(codec.encode(b)).replay()).isEqualTo(a.replay());
  }

  @ParameterizedTest
  @ValueSource(strings = {"value", "scale", "source", "boundary", "exclusion", "policy"})
  void inputChangesAlwaysChangeThePayloadHash(String change) {
    var original = capture(withInvalidRows());
    var p = original.payload();
    var rows = new ArrayList<>(p.input().regions());
    var policy = new HashMap<>(p.policy());
    var boundary = p.input().boundary();
    if (change.equals("policy")) policy.put("salesWeight", "0.25");
    else if (change.equals("boundary")) boundary = batch(9, "SEOUL_DONG_BOUNDARY");
    else {
      int index = change.equals("exclusion") ? 5 : 0;
      var r = rows.get(index);
      var raw = change.equals("scale") ? "100.0" : "101";
      var foot =
          change.equals("scale") || change.equals("value")
              ? raw(r.footTraffic(), raw)
              : r.footTraffic();
      var sales = r.sales();
      if (change.equals("exclusion")) sales = value(null, 3, "SEOUL_DISTRICT_SALES_STAT");
      if (change.equals("source"))
        sales =
            new ScoreInputSnapshot.RawValue(
                sales.raw(),
                new ScoreInputSnapshot.RowSource(
                    true, new UUID(0, 8), batch(8, "SEOUL_DISTRICT_SALES_STAT"), true));
      rows.set(
          index,
          new ScoreInputSnapshot.RegionInput(
              r.regionCode(),
              r.regionName(),
              r.districtCode(),
              r.districtName(),
              sales,
              foot,
              r.storeCount(),
              r.closureRate()));
    }
    var input =
        new ScoreInputSnapshot(
            p.input().unit(), "20262", "CS100010", boundary, true, p.input().readiness(), rows);
    var changed = capture(input);
    if (change.equals("policy")) {
      var c = changed.payload();
      changed =
          ScoreSnapshotArtifact.seal(
              new ScoreSnapshotArtifact.Payload(
                  c.snapshotSchemaVersion(),
                  c.algorithmVersion(),
                  policy,
                  c.coverage(),
                  c.input(),
                  c.boundaryRegionCodes(),
                  c.batches(),
                  c.eligibleRegionCodes(),
                  c.excludedRegions()),
              changed.expected(),
              null);
      var unsupported = changed;
      assertThatThrownBy(unsupported::replay).isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(changed.inputSnapshotId()).isNotEqualTo(original.inputSnapshotId());
    if (change.equals("scale")) assertThat(changed.replay()).isEqualTo(original.replay());
  }

  @Test
  void preservesRawScaleNullMissingIneligibleNonfiniteNegativeAndZeroSeparately() {
    var artifact = codec.decode(codec.encode(capture(withInvalidRows())));
    var rows = artifact.payload().input().regions();
    assertThat(rows.getFirst().footTraffic().raw()).isEqualTo("100");
    assertThat(rows.get(5).sales().state())
        .isEqualTo(ScoreInputSnapshot.MeasurementState.ROW_MISSING);
    assertThat(rows.get(6).sales().state()).isEqualTo(ScoreInputSnapshot.MeasurementState.NULL);
    assertThat(rows.get(7).sales().state())
        .isEqualTo(ScoreInputSnapshot.MeasurementState.SOURCE_NOT_ELIGIBLE);
    assertThat(rows.get(8).sales().state())
        .isEqualTo(ScoreInputSnapshot.MeasurementState.NON_FINITE);
    assertThat(artifact.replay().excluded()).hasSize(6);
    assertThat(artifact.replay().scores()).hasSize(6);
    assertThat(rows.get(11).sales().raw()).isEqualTo("0");
    assertThat(artifact.replay().excluded().get(4).reasons())
        .contains(
            new InternalScoreResult.Reason(
                InternalScoreResult.ReasonCode.ZERO_STORE_COUNT, ScoreMetric.STORE_COUNT));
  }

  @Test
  void rejectsTruncationEvenWithRecomputedHashAndRejectsCorruptedReferenceResults() {
    var a = capture(fixture(ScoreCalculation.RegionUnit.DISTRICT));
    var p = a.payload();
    assertThatThrownBy(
            () ->
                new ScoreSnapshotArtifact.Payload(
                    p.snapshotSchemaVersion(),
                    p.algorithmVersion(),
                    p.policy(),
                    new ScoreSnapshotArtifact.Coverage(5, 4, 1),
                    p.input(),
                    p.boundaryRegionCodes(),
                    p.batches(),
                    p.eligibleRegionCodes(),
                    p.excludedRegions()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                capture(
                    replaceRows(p.input(), p.input().regions().subList(0, 4)),
                    p.boundaryRegionCodes()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                ScoreSnapshotArtifact.seal(
                    new ScoreSnapshotArtifact.Payload(
                        p.snapshotSchemaVersion(),
                        p.algorithmVersion(),
                        p.policy(),
                        p.coverage(),
                        replaceRows(p.input(), p.input().regions().subList(0, 4)),
                        p.boundaryRegionCodes(),
                        p.batches(),
                        p.eligibleRegionCodes(),
                        p.excludedRegions()),
                    a.expected(),
                    null))
        .isInstanceOf(IllegalArgumentException.class);
    var bad =
        new ScoreSnapshotArtifact.Reproduction(
            a.expected().eligibleCount(),
            a.expected().excluded(),
            a.expected().reasons(),
            List.of());
    var forged = ScoreSnapshotArtifact.seal(p, bad, null);
    assertThatThrownBy(forged::replay).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> codec.decode(codec.encode(forged)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aChangedExclusionReasonAloneChangesHashAndFailsOfflineValidation() {
    var a = capture(withInvalidRows());
    var p = a.payload();
    var excluded = new ArrayList<>(p.excludedRegions());
    var first = excluded.getFirst();
    excluded.set(
        0,
        new InternalScoreResult.ExcludedRegion(
            first.regionCode(),
            List.of(
                new InternalScoreResult.Reason(
                    InternalScoreResult.ReasonCode.INPUT_NULL, ScoreMetric.SALES))));
    var payload =
        new ScoreSnapshotArtifact.Payload(
            p.snapshotSchemaVersion(),
            p.algorithmVersion(),
            p.policy(),
            p.coverage(),
            p.input(),
            p.boundaryRegionCodes(),
            p.batches(),
            p.eligibleRegionCodes(),
            excluded);
    var changed = ScoreSnapshotArtifact.seal(payload, a.expected(), null);
    assertThat(changed.inputSnapshotId()).isNotEqualTo(a.inputSnapshotId());
    assertThatThrownBy(changed::replay).isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "missing",
        "version",
        "duplicate",
        "trailing",
        "broken",
        "hash",
        "null",
        "unknown",
        "numericCoercion",
        "nullPrimitive",
        "missingRaw",
        "numericRaw",
        "numericFraction",
        "booleanString"
      })
  void rejectsMalformedOrIncompleteArtifacts(String kind) {
    String json =
        new String(
            codec.encode(capture(fixture(ScoreCalculation.RegionUnit.DISTRICT))),
            StandardCharsets.UTF_8);
    json =
        switch (kind) {
          case "missing" -> json.replace("\"boundaryRowsPresent\":true,", "");
          case "version" -> json.replace("score-input-v1", "score-input-v999");
          case "duplicate" -> json.replaceFirst("\\{", "{\"inputSnapshotId\":\"duplicate\",");
          case "trailing" -> json + " {}";
          case "broken" -> json.substring(0, json.length() - 4);
          case "hash" ->
              json.replaceFirst(
                  "\"inputSnapshotId\":\"[a-f0-9]{64}\"",
                  "\"inputSnapshotId\":\"" + "0".repeat(64) + "\"");
          case "null" -> json.replace("\"regions\":[", "\"regions\":null,\"other\":[");
          case "unknown" -> json.replaceFirst("\\{", "{\"sourceReference\":\"forbidden\",");
          case "nullPrimitive" ->
              json.replace("\"boundaryRowsPresent\":true", "\"boundaryRowsPresent\":null");
          case "missingRaw" -> json.replaceFirst("\"raw\":\"1000\",", "");
          case "numericRaw" -> json.replaceFirst("\"raw\":\"1000\"", "\"raw\":1000");
          case "numericFraction" -> json.replaceFirst("\"numerator\":\"40\"", "\"numerator\":40");
          case "booleanString" -> json.replace("\"rowPresent\":true", "\"rowPresent\":\"true\"");
          default -> json.replace("\"eligibleCount\":5", "\"eligibleCount\":\"5\"");
        };
    var bytes = json.getBytes(StandardCharsets.UTF_8);
    assertThatThrownBy(() -> codec.decode(bytes)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void canonicalJsonUsesCodePointOrderRequiredEscapesAndAnIndependentSha256Vector() {
    var tree =
        JsonMapper.builder()
            .build()
            .readTree("{\"😀\":5,\"z\":null,\"a\":\"가\\n\\u0001/\\\"\\\\\",\"\\ue000\":true}");
    var bytes = ScoreSnapshotCodec.canonicalJson(tree);
    assertThat(new String(bytes, StandardCharsets.UTF_8))
        .isEqualTo("{\"a\":\"가\\n\\u0001/\\\"\\\\\",\"z\":null,\"\ue000\":true,\"😀\":5}");
    assertThat(ScoreSnapshotCodec.sha256(bytes))
        .isEqualTo("7dc2a962f4f3029eb99f74c31c1fabff868b19ee6df6f080b95c0c5069ff9407");
  }

  @Test
  void matchesTheIndependentPythonHashOfTheEntireSyntheticFiveRegionPayload() {
    // Python 표준 json/hashlib로 별도 작성한 5지역 payload(14,935바이트)의 고정 기대값이다.
    var a = capture(fixture(ScoreCalculation.RegionUnit.DISTRICT));
    assertThat(codec.canonicalPayload(a.payload())).hasSize(14935);
    assertThat(a.inputSnapshotId())
        .isEqualTo("c671ee9b6263f5ff92334f7cc2a5e522f5f84872fe0cda2d38c1f1db71759f95");
  }

  @ParameterizedTest
  @ValueSource(strings = {"score", "normalized", "contribution", "rank", "tie"})
  void rejectsAlteredExactResultsEvenWhenTheInputHashStillMatches(String field) {
    var a = capture(fixture(ScoreCalculation.RegionUnit.DISTRICT));
    var scores = new ArrayList<>(a.expected().scores());
    var first = scores.getFirst();
    var components =
        new java.util.EnumMap<ScoreMetric, ScoreSnapshotArtifact.Component>(ScoreMetric.class);
    components.putAll(first.components());
    var sales = components.get(ScoreMetric.SALES);
    if (field.equals("normalized"))
      components.put(
          ScoreMetric.SALES,
          new ScoreSnapshotArtifact.Component(fraction(1, 2), sales.contribution()));
    if (field.equals("contribution"))
      components.put(
          ScoreMetric.SALES,
          new ScoreSnapshotArtifact.Component(sales.normalized(), fraction(1, 1)));
    scores.set(
        0,
        new ScoreSnapshotArtifact.Result(
            first.regionCode(),
            components,
            field.equals("score") ? fraction(41, 1) : first.score(),
            field.equals("rank") ? fraction(4, 1) : first.averageRank(),
            field.equals("tie") ? 1 : first.tieCount()));
    var expected =
        new ScoreSnapshotArtifact.Reproduction(
            a.expected().eligibleCount(), a.expected().excluded(), a.expected().reasons(), scores);
    var forged = ScoreSnapshotArtifact.seal(a.payload(), expected, null);
    assertThat(forged.inputSnapshotId()).isEqualTo(a.inputSnapshotId());
    assertThatThrownBy(forged::replay).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> codec.decode(codec.encode(forged)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void rejectsContradictoryProvenanceAndDuplicateOrConflictingFullBoundaryRows() {
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    var rows = new ArrayList<>(input.regions());
    rows.add(rows.getFirst());
    assertThatThrownBy(() -> capture(replaceRows(input, rows)))
        .isInstanceOf(IllegalStateException.class);
    var codes =
        new ArrayList<>(
            input.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList());
    codes.add(codes.getFirst());
    assertThatThrownBy(() -> capture(input, codes)).isInstanceOf(IllegalArgumentException.class);
    rows.removeLast();
    var first = rows.getFirst();
    var inconsistent =
        new ScoreInputSnapshot.RawValue(
            "1000",
            new ScoreInputSnapshot.RowSource(
                true, new UUID(0, 3), batch(3, "SEOUL_DISTRICT_STORE_STAT"), true));
    rows.set(
        0,
        new ScoreInputSnapshot.RegionInput(
            first.regionCode(),
            first.regionName(),
            first.districtCode(),
            first.districtName(),
            inconsistent,
            first.footTraffic(),
            first.storeCount(),
            first.closureRate()));
    assertThatThrownBy(() -> capture(replaceRows(input, rows)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"bothMissing", "idMissing", "metadataMissing", "idMismatch"})
  void rejectsPresentRowsWithoutCompleteMatchingProvenance(String kind) {
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    UUID id = kind.equals("bothMissing") || kind.equals("idMissing") ? null : new UUID(0, 3);
    var metadata =
        kind.equals("bothMissing") || kind.equals("metadataMissing")
            ? null
            : batch(3, "SEOUL_DISTRICT_SALES_STAT");
    if (kind.equals("idMismatch")) id = new UUID(0, 9);
    // 불완전한 출처를 eligible=false로 표시해도 실제 출처 보존 의무를 우회할 수 없다.
    var sales =
        new ScoreInputSnapshot.RawValue(
            "1000", new ScoreInputSnapshot.RowSource(true, id, metadata, false));
    assertThatThrownBy(() -> capture(withFirstSales(input, sales)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"ROW_MISSING", "NULL"})
  void preservesMissingRowsAndPresentNullMeasurementsAsDifferentStates(String state) {
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    boolean present = state.equals("NULL");
    var source =
        present
            ? input.regions().getFirst().sales().source()
            : new ScoreInputSnapshot.RowSource(false, null, null, false);
    var artifact =
        codec.decode(
            codec.encode(
                capture(withFirstSales(input, new ScoreInputSnapshot.RawValue(null, source)))));
    var actual = artifact.payload().input().regions().getFirst().sales();
    assertThat(actual.raw()).isNull();
    assertThat(actual.state()).isEqualTo(ScoreInputSnapshot.MeasurementState.valueOf(state));
    assertThat(actual.source().rowPresent()).isEqualTo(present);
    if (present) {
      assertThat(actual.source().sourceBatchId()).isEqualTo(new UUID(0, 3));
      assertThat(actual.source().batch()).isNotNull();
      assertThat(actual.source().eligible()).isTrue();
    } else {
      assertThat(actual.source().sourceBatchId()).isNull();
      assertThat(actual.source().batch()).isNull();
    }
    assertThat(artifact.replay().excluded())
        .containsExactly(
            new InternalScoreResult.ExcludedRegion(
                "가",
                List.of(
                    new InternalScoreResult.Reason(
                        present
                            ? InternalScoreResult.ReasonCode.INPUT_NULL
                            : InternalScoreResult.ReasonCode.INPUT_ROW_MISSING,
                        ScoreMetric.SALES))));
  }

  @Test
  void preservesActualIneligibleBatchMetadataAndSourceNotEligibleReason() {
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    var sales =
        new ScoreInputSnapshot.RawValue(
            "1000",
            new ScoreInputSnapshot.RowSource(
                true, new UUID(0, 7), batch(7, "SEOUL_DISTRICT_STORE_STAT"), false));
    var original = capture(withFirstSales(input, sales));
    var restored = codec.decode(codec.encode(original));
    var actual = restored.payload().input().regions().getFirst().sales();
    assertThat(actual.source())
        .isEqualTo(original.payload().input().regions().getFirst().sales().source());
    assertThat(actual.raw()).isEqualTo("1000");
    assertThat(actual.source().rowPresent()).isTrue();
    assertThat(actual.source().sourceBatchId()).isEqualTo(new UUID(0, 7));
    assertThat(actual.source().batch().batchId()).isEqualTo(new UUID(0, 7));
    assertThat(actual.source().batch().datasetCode()).isEqualTo("SEOUL_DISTRICT_STORE_STAT");
    assertThat(actual.state()).isEqualTo(ScoreInputSnapshot.MeasurementState.SOURCE_NOT_ELIGIBLE);
    assertThat(restored.replay().excluded())
        .containsExactly(
            new InternalScoreResult.ExcludedRegion(
                "가",
                List.of(
                    new InternalScoreResult.Reason(
                        InternalScoreResult.ReasonCode.SOURCE_NOT_ELIGIBLE, ScoreMetric.SALES))));
  }

  @Test
  void normalizesTimesToUtcWithMinimalFractionAndPreservesLongRawNumbers() {
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    var rows = new ArrayList<>(input.regions());
    var r = rows.getFirst();
    rows.set(
        0,
        new ScoreInputSnapshot.RegionInput(
            r.regionCode(),
            r.regionName(),
            r.districtCode(),
            r.districtName(),
            raw(r.sales(), "9007199254740993"),
            raw(r.footTraffic(), "100.000000000000000000000000000001"),
            r.storeCount(),
            r.closureRate()));
    var a = capture(replaceRows(input, rows));
    var bytes = codec.encode(a);
    assertThat(new String(bytes, StandardCharsets.UTF_8))
        .contains("2026-10-02T00:00:00.1Z")
        .doesNotContain("+09:00", "00:00:00.100Z", "publicationState");
    var restored = codec.decode(bytes);
    assertThat(restored.payload().input()).isEqualTo(a.payload().input());
    assertThat(restored.replay()).isEqualTo(a.replay());
    assertThat(restored.payload().input().regions().getFirst().sales().raw())
        .isEqualTo("9007199254740993");
    assertThat(restored.payload().input().regions().getFirst().footTraffic().raw())
        .isEqualTo("100.000000000000000000000000000001");
  }

  @Test
  void rejectsInvalidUtf8BomAndUnpairedSurrogates() {
    assertThatThrownBy(() -> codec.decode(new byte[] {(byte) 0xc3, 0x28}))
        .isInstanceOf(IllegalArgumentException.class);
    var json =
        new String(
            codec.encode(capture(fixture(ScoreCalculation.RegionUnit.DISTRICT))),
            StandardCharsets.UTF_8);
    assertThatThrownBy(() -> codec.decode(("\ufeff" + json).getBytes(StandardCharsets.UTF_8)))
        .isInstanceOf(IllegalArgumentException.class);
    var tree = JsonMapper.builder().build().readTree("{\"key\":\"\\ud800\"}");
    assertThatThrownBy(() -> ScoreSnapshotCodec.canonicalJson(tree))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void artifactCollectionsCannotBeMutatedAfterHashing() {
    var a = capture(withInvalidRows());
    var before = codec.encode(a);
    assertThatThrownBy(() -> a.payload().input().regions().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> a.payload().batches().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> a.payload().policy().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> a.payload().excludedRegions().getFirst().reasons().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> a.expected().scores().getFirst().components().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    before[0] = 0;
    assertThat(codec.encode(a)[0]).isEqualTo((byte) '{');
  }

  @Test
  void serviceAndOfflineValidationRemainIdenticalForBothUnitsAndHeldCohorts() {
    for (var unit : ScoreCalculation.RegionUnit.values()) {
      var input = fixture(unit);
      var repository = mock(ScoreInputRepository.class);
      if (unit == ScoreCalculation.RegionUnit.DISTRICT)
        when(repository.findDistrictInputs("20262", "CS100010")).thenReturn(input);
      else when(repository.findDongInputs("20262", "CS100010")).thenReturn(input);
      var service = new ScoreService(repository);
      var result =
          unit == ScoreCalculation.RegionUnit.DISTRICT
              ? service.diagnoseDistrict("라", "20262", "CS100010")
              : service.diagnoseDong("라", "20262", "CS100010");
      assertThat(capture(input).replay().scores()).hasSize(5);
      assertThat(result.cohortScores().get(3).score())
          .isEqualTo(new ExactFraction(BigInteger.valueOf(65), BigInteger.ONE));
      assertThat(capture(input).payload().input().unit()).isEqualTo(unit);
    }
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    var one = replaceRows(input, List.of(input.regions().getFirst()));
    assertThat(capture(one).replay().reasons())
        .contains(
            new InternalScoreResult.Reason(
                InternalScoreResult.ReasonCode.INSUFFICIENT_COHORT, null));
    var constant =
        replaceRows(
            input,
            input.regions().stream()
                .map(
                    r ->
                        new ScoreInputSnapshot.RegionInput(
                            r.regionCode(),
                            r.regionName(),
                            r.districtCode(),
                            r.districtName(),
                            r.sales(),
                            r.footTraffic(),
                            r.storeCount(),
                            input.regions().getFirst().closureRate()))
                .toList());
    assertThat(capture(constant).replay().scores()).isEmpty();
    assertThat(capture(constant).replay().reasons())
        .contains(
            new InternalScoreResult.Reason(
                InternalScoreResult.ReasonCode.CONSTANT_INDICATOR, ScoreMetric.CLOSURE_RATE));
  }

  static ScoreInputSnapshot fixture(ScoreCalculation.RegionUnit unit) {
    var rows = new ArrayList<ScoreInputSnapshot.RegionInput>();
    String[] codes = {"가", "나", "다", "라", "마"};
    int[] stores = {10, 30, 40, 20, 50};
    for (int i = 0; i < 5; i++)
      rows.add(
          row(
              unit,
              codes[i],
              "" + ((i + 1) * 1000),
              "" + ((i + 1) * 100),
              "" + stores[i],
              "" + (i + 1)));
    return new ScoreInputSnapshot(
        unit,
        "20262",
        "CS100010",
        batch(1, "SEOUL_DONG_BOUNDARY"),
        true,
        new ScoreInputSnapshot.DatasetReadiness(true, true, true),
        rows);
  }

  private static ScoreInputSnapshot withInvalidRows() {
    var input = fixture(ScoreCalculation.RegionUnit.DISTRICT);
    var rows = new ArrayList<>(input.regions());
    var unit = input.unit();
    var missing = row(unit, "바", "1", "1", "1", "1");
    rows.add(
        new ScoreInputSnapshot.RegionInput(
            "바",
            "바",
            "합성구",
            "합성구",
            new ScoreInputSnapshot.RawValue(
                null, new ScoreInputSnapshot.RowSource(false, null, null, false)),
            missing.footTraffic(),
            missing.storeCount(),
            missing.closureRate()));
    rows.add(row(unit, "사", null, "1", "1", "1"));
    var bad = row(unit, "아", "1", "1", "1", "1");
    rows.add(
        new ScoreInputSnapshot.RegionInput(
            "아",
            "아",
            "합성구",
            "합성구",
            new ScoreInputSnapshot.RawValue(
                "1",
                new ScoreInputSnapshot.RowSource(
                    true, new UUID(0, 7), batch(7, "SEOUL_DISTRICT_STORE_STAT"), false)),
            bad.footTraffic(),
            bad.storeCount(),
            bad.closureRate()));
    rows.add(row(unit, "자", "NaN", "1", "1", "1"));
    rows.add(row(unit, "차", "-1", "1", "0", "1"));
    rows.add(row(unit, "카", "1", "1", "0", "1"));
    rows.add(row(unit, "타", "0", "0", "1", "0"));
    return replaceRows(input, rows);
  }

  private static ScoreInputSnapshot.RegionInput row(
      ScoreCalculation.RegionUnit u,
      String code,
      String sales,
      String foot,
      String stores,
      String closure) {
    return new ScoreInputSnapshot.RegionInput(
        code,
        code,
        "합성구",
        "합성구",
        value(sales, 3, "SEOUL_" + u + "_SALES_STAT"),
        value(foot, 4, "SEOUL_" + u + "_FOOT_TRAFFIC_STAT"),
        value(stores, 2, "SEOUL_" + u + "_STORE_STAT"),
        value(closure, 2, "SEOUL_" + u + "_STORE_STAT"));
  }

  private static ScoreInputSnapshot.RawValue value(String s, long id, String dataset) {
    return new ScoreInputSnapshot.RawValue(
        s, new ScoreInputSnapshot.RowSource(true, new UUID(0, id), batch(id, dataset), true));
  }

  private static ScoreInputSnapshot.RawValue raw(ScoreInputSnapshot.RawValue old, String value) {
    return new ScoreInputSnapshot.RawValue(value, old.source());
  }

  static ScoreInputSnapshot.BatchMetadata batch(long id, String dataset) {
    return new ScoreInputSnapshot.BatchMetadata(
        new UUID(0, id),
        dataset,
        dataset.equals("SEOUL_DONG_BOUNDARY") ? "SHAPEFILE" : "CSV",
        "SEOUL",
        null,
        "20262",
        "20262",
        "a".repeat(64),
        "synthetic-v1",
        "PUBLISHED",
        OffsetDateTime.parse("2026-10-01T09:00:00+09:00"),
        null,
        OffsetDateTime.parse("2026-10-02T09:00:00.100+09:00"));
  }

  private static ScoreSnapshotArtifact.Fraction fraction(long n, long d) {
    return new ScoreSnapshotArtifact.Fraction("" + n, "" + d);
  }

  private static ScoreInputSnapshot replaceRows(
      ScoreInputSnapshot s, List<ScoreInputSnapshot.RegionInput> rows) {
    return new ScoreInputSnapshot(
        s.unit(),
        s.quarterCode(),
        s.industryCode(),
        s.boundary(),
        s.boundaryRowsPresent(),
        s.readiness(),
        rows);
  }

  private static ScoreInputSnapshot withFirstSales(
      ScoreInputSnapshot input, ScoreInputSnapshot.RawValue sales) {
    var rows = new ArrayList<>(input.regions());
    var first = rows.getFirst();
    rows.set(
        0,
        new ScoreInputSnapshot.RegionInput(
            first.regionCode(),
            first.regionName(),
            first.districtCode(),
            first.districtName(),
            sales,
            first.footTraffic(),
            first.storeCount(),
            first.closureRate()));
    return replaceRows(input, rows);
  }

  private static ScoreSnapshotArtifact capture(ScoreInputSnapshot s) {
    return capture(
        s, s.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList());
  }

  private static ScoreSnapshotArtifact capture(ScoreInputSnapshot s, List<String> codes) {
    return ScoreSnapshotArtifact.capture(s, codes, OffsetDateTime.parse("2026-11-02T00:00:00Z"));
  }
}
