package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 정규 입력·출처·커버리지의 정확한 일치를 합성 전체 집단으로 검증한다. */
class ScoreInputComparisonTests {
  private final JsonMapper json = JsonMapper.builder().build();
  private final ScoreSnapshotBundle baseline = ScoreSnapshotToolTests.fixture();
  private final ScoreSnapshotReference reference = ScoreSnapshotReference.decode(baseline.encode());

  @Test
  void matchesBothWholeCohortsWithDifferentOrderingAndRequestTime() {
    var a = tree(district());
    var b = tree(dong());
    reverse(a);
    reverse(b);
    assertThat(compare(input(a), input(b))).isEqualTo(ScoreInputComparison.Status.MATCHED);
    var otherTime =
        new ScoreSnapshotBundle(
            ScoreSnapshotArtifact.capture(
                district(),
                baseline.district().payload().boundaryRegionCodes(),
                OffsetDateTime.parse("2026-11-05T00:00:00Z")),
            ScoreSnapshotArtifact.capture(
                dong(),
                baseline.dong().payload().boundaryRegionCodes(),
                OffsetDateTime.parse("2026-11-05T00:00:00Z")));
    assertThat(otherTime.encode()).isNotEqualTo(baseline.encode());
    assertThat(
            ScoreInputComparison.compare(
                ScoreSnapshotReference.decode(otherTime.encode()), district(), dong()))
        .isEqualTo(ScoreInputComparison.Status.MATCHED);
  }

  @ParameterizedTest
  @ValueSource(strings = {"sales", "footTraffic", "storeCount", "closureRate"})
  void detectsEveryRawMetricInEitherCohort(String metric) {
    for (boolean district : List.of(true, false)) {
      var current = tree(district ? district() : dong());
      ((ObjectNode) current.get("regions").get(0).get(metric))
          .put("raw", "999999999999999999999999999999999999");
      assertThat(
              compare(district ? input(current) : district(), district ? dong() : input(current)))
          .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"footTraffic", "closureRate"})
  void preservesScaleAndLongDecimalDigitsRatherThanComparingMathematicalValues(String metric) {
    var expected = tree(dong());
    ((ObjectNode) expected.get("regions").get(0).get(metric)).put("raw", "1.0");
    var reference = reference(district(), input(expected));
    var actual = expected.deepCopy();
    ((ObjectNode) actual.get("regions").get(0).get(metric)).put("raw", "1.00");
    assertThat(ScoreInputComparison.compare(reference, district(), input(actual)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
    ((ObjectNode) expected.get("regions").get(0).get(metric))
        .put("raw", "1.000000000000000000000000000001");
    ((ObjectNode) actual.get("regions").get(0).get(metric))
        .put("raw", "1.000000000000000000000000000002");
    assertThat(
            ScoreInputComparison.compare(
                reference(district(), input(expected)), district(), input(actual)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @ParameterizedTest
  @ValueSource(strings = {"null", "zero", "missing", "ineligible"})
  void keepsNullActualZeroMissingRowsAndIneligibleSourcesDistinct(String mutation) {
    var changed = tree(dong());
    var value = (ObjectNode) changed.get("regions").get(0).get("sales");
    switch (mutation) {
      case "null" -> value.putNull("raw");
      case "zero" -> value.put("raw", "0");
      case "missing" -> missing(value);
      default -> ineligible(changed);
    }
    var actual = input(changed);
    assertThat(compare(district(), actual)).isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
    assertThat(ScoreInputComparison.compare(reference(district(), actual), district(), actual))
        .isEqualTo(ScoreInputComparison.Status.MATCHED);
  }

  @Test
  void detectsChangedExclusionReasonsEvenWhenTheExcludedRegionSetIsTheSame() {
    var original = tree(dong());
    ((ObjectNode) original.get("regions").get(0).get("sales")).putNull("raw");
    var actual = original.deepCopy();
    missing((ObjectNode) actual.get("regions").get(0).get("sales"));
    assertThat(
            ScoreInputComparison.compare(
                reference(district(), input(original)), district(), input(actual)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "sourceChecksum",
        "etlVersion",
        "publishedAt",
        "startedAt",
        "finishedAt",
        "periodFrom",
        "periodTo"
      })
  void detectsSourceEditionMetadataChanges(String field) {
    var changed = tree(dong());
    changeBatches(
        changed,
        field,
        switch (field) {
          case "publishedAt", "startedAt", "finishedAt" -> "2026-11-05T00:00:00Z";
          case "sourceChecksum" -> "b".repeat(64);
          case "periodFrom", "periodTo" -> "20261";
          default -> "synthetic-other";
        });
    assertThat(compare(district(), input(changed)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @Test
  void detectsActualRowBatchIdAndBoundaryEditionChanges() {
    var changed = tree(dong());
    var source = (ObjectNode) changed.get("regions").get(0).get("sales").get("source");
    source.put("sourceBatchId", "00000000-0000-0000-0000-000000000099");
    ((ObjectNode) source.get("batch")).put("batchId", "00000000-0000-0000-0000-000000000099");
    assertThat(compare(district(), input(changed)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
    changed = tree(dong());
    ((ObjectNode) changed.get("boundary")).put("batchId", "00000000-0000-0000-0000-000000000099");
    assertThat(compare(district(), input(changed)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @ParameterizedTest
  @ValueSource(strings = {"added", "deleted", "name", "parent", "quarter", "industry", "unit"})
  void detectsRegionCoverageNamesParentsAndScopeChanges(String mutation) {
    var changed = tree(dong());
    var row = (ObjectNode) changed.get("regions").get(0);
    switch (mutation) {
      case "added" -> {
        var added = row.deepCopy().put("regionCode", "00001002");
        changed.withArray("regions").add(added);
      }
      case "deleted" -> changed.withArray("regions").remove(0);
      case "name" -> row.put("regionName", "변경된 합성동");
      case "parent" -> row.put("districtCode", "00002").put("districtName", "합성구2");
      case "quarter" -> changed.put("quarterCode", "20261");
      case "industry" -> changed.put("industryCode", "CS100001");
      default -> changed.put("unit", "DISTRICT");
    }
    assertThat(compare(district(), input(changed)))
        .isEqualTo(ScoreInputComparison.Status.INPUT_MISMATCH);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"boundary", "emptyBoundary", "emptyCohort", "stores", "sales", "footTraffic"})
  void reportsGlobalReadinessSeparatelyFromIndividualExcludedRows(String mutation) {
    var changed = tree(district());
    switch (mutation) {
      case "boundary" -> changed.putNull("boundary");
      case "emptyBoundary" -> changed.put("boundaryRowsPresent", false);
      case "emptyCohort" -> changed.putArray("regions");
      default -> ((ObjectNode) changed.get("readiness")).put(mutation, false);
    }
    assertThat(compare(input(changed), dong()))
        .isEqualTo(ScoreInputComparison.Status.DATA_NOT_READY);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "broken",
        "hash",
        "replay",
        "quarter",
        "industry",
        "policy",
        "schema",
        "algorithm"
      })
  void invalidReferenceIsRejectedBeforeDatabaseAccess(String mutation) {
    var source = mock(DataSource.class);
    var verifier = new ScoreCurrentInputVerification(source);
    var tree = (ObjectNode) json.readTree(baseline.encode());
    var a = (ObjectNode) tree.get("district");
    var p = (ObjectNode) a.get("payload");
    switch (mutation) {
      case "hash" -> a.put("inputSnapshotId", "0".repeat(64));
      case "replay" -> ((ObjectNode) a.get("expected")).put("eligibleCount", 999);
      case "quarter" -> ((ObjectNode) p.get("input")).put("quarterCode", "20261");
      case "industry" -> ((ObjectNode) p.get("input")).put("industryCode", "CS100001");
      case "policy" -> ((ObjectNode) p.get("policy")).put("salesWeight", "0.99");
      case "schema" -> p.put("snapshotSchemaVersion", "unsupported");
      case "algorithm" -> p.put("algorithmVersion", "unsupported");
      default -> {}
    }
    byte[] bytes = mutation.equals("broken") ? new byte[] {1, 2, 3} : json.writeValueAsBytes(tree);
    assertThat(verifier.verify(bytes).status())
        .isEqualTo(ScoreInputComparison.Status.REFERENCE_INVALID);
    verifyNoInteractions(source);
  }

  @Test
  void immutableReferenceRetainsTheValidatedBytesAndNeverPrintsThePayload() {
    byte[] bytes = baseline.encode();
    var reference = ScoreSnapshotReference.decode(bytes);
    String expectedHash = ScoreSnapshotCodec.sha256(bytes);
    java.util.Arrays.fill(bytes, (byte) 0);
    assertThat(ScoreInputComparison.compare(reference, district(), dong()))
        .isEqualTo(ScoreInputComparison.Status.MATCHED);
    assertThat(reference.fileSha256()).isEqualTo(expectedHash);
    assertThat(reference.toString()).doesNotContain("합성", "raw", "sourceChecksum");
  }

  private ScoreInputComparison.Status compare(
      ScoreInputSnapshot district, ScoreInputSnapshot dong) {
    return ScoreInputComparison.compare(reference, district, dong);
  }

  private ScoreInputSnapshot district() {
    return baseline.district().payload().input();
  }

  private ScoreInputSnapshot dong() {
    return baseline.dong().payload().input();
  }

  private ObjectNode tree(ScoreInputSnapshot input) {
    return (ObjectNode) json.valueToTree(input);
  }

  private ScoreInputSnapshot input(ObjectNode tree) {
    return json.treeToValue(tree, ScoreInputSnapshot.class);
  }

  private static ScoreSnapshotReference reference(ScoreInputSnapshot a, ScoreInputSnapshot b) {
    return ScoreSnapshotReference.decode(
        new ScoreSnapshotBundle(
                ScoreSnapshotToolTests.capture(a), ScoreSnapshotToolTests.capture(b))
            .encode());
  }

  private static void reverse(ObjectNode tree) {
    var rows = new ArrayList<JsonNode>();
    tree.get("regions").forEach(rows::add);
    Collections.reverse(rows);
    tree.putArray("regions").addAll(rows);
  }

  private static void missing(ObjectNode value) {
    value.putNull("raw");
    ((ObjectNode) value.get("source"))
        .put("rowPresent", false)
        .putNull("sourceBatchId")
        .putNull("batch")
        .put("eligible", false);
  }

  private static void changeBatches(JsonNode node, String field, String value) {
    if (node.isObject() && node.has("datasetCode")) ((ObjectNode) node).put(field, value);
    for (JsonNode child : node)
      if ((child.isObject() || child.isArray())) changeBatches(child, field, value);
  }

  private static void ineligible(ObjectNode input) {
    for (var r : input.get("regions")) {
      var source = (ObjectNode) r.get("sales").get("source");
      source.put("eligible", false);
      ((ObjectNode) source.get("batch")).put("status", "FAILED");
    }
  }
}
