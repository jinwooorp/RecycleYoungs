package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 실제 파일·DB·승인 발급 없이 합성 전체 집단과 승인 주장의 결합 관계만 검증한다. */
class ScoreApprovalManifestTests {
  private final ScoreApprovalManifestCodec codec = new ScoreApprovalManifestCodec();
  private final ScoreApprovalManifestVerifier verifier = new ScoreApprovalManifestVerifier();
  private final JsonMapper json = JsonMapper.builder().build();
  private final ScoreApprovalManifestVerifier.ExpectedReferences references =
      new ScoreApprovalManifestVerifier.ExpectedReferences(
          "synthetic-policy-v1",
          "synthetic-policy-1",
          "synthetic-source-1",
          "synthetic-coverage-1");

  @Test
  void verifiesFullBindingWithoutGrantingApprovalEvenWithAnExternalDigest() {
    var bundle = fixture();
    var manifest = manifest(bundle);
    byte[] bytes = codec.encode(manifest);
    var result = verifier.verify(bytes, bundle.encode(), references, codec.sha256(manifest));
    assertThat(result.status()).isEqualTo(ScoreApprovalManifestVerifier.Status.BINDING_VERIFIED);
    assertThat(result.digestComparison())
        .isEqualTo(ScoreApprovalManifestVerifier.DigestComparison.MATCHED);
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.sourceTrust())
        .isEqualTo(ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED);
    assertThat(codec.decode(bytes)).isEqualTo(manifest);
  }

  @Test
  void claimedApprovedWithoutAnIndependentDigestRemainsUnapprovedIncludingServiceResults() {
    var bundle = fixture();
    var result = verifier.verify(codec.encode(manifest(bundle)), bundle.encode(), references, null);
    assertThat(result.digestComparison())
        .isEqualTo(ScoreApprovalManifestVerifier.DigestComparison.NOT_PROVIDED);
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    var repository = mock(ScoreInputRepository.class);
    when(repository.findDistrictInputs("20262", "CS100010"))
        .thenReturn(bundle.district().payload().input());
    var serviceResult = new ScoreService(repository).diagnoseDistrict("00001", "20262", "CS100010");
    assertThat(serviceResult.status()).isEqualTo(InternalScoreResult.Status.INTERNAL_CALCULATED);
    assertThat(serviceResult.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
  }

  @ParameterizedTest
  @ValueSource(strings = {"policyApproval", "sourceVerification", "coverageApproval"})
  void rejectsMissingOrUnmatchedEvidence(String role) {
    var bundle = fixture();
    var tree = tree(manifest(bundle));
    tree.remove(role);
    assertRejected(tree, bundle);
    tree = tree(manifest(bundle));
    ((ObjectNode) tree.get(role)).put("approvalId", "synthetic-other");
    assertRejected(tree, bundle);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "manifestSchemaVersion",
        "quarterCode",
        "industryCode",
        "algorithmVersion",
        "policyVersion",
        "fileSha256",
        "districtHash",
        "dongHash",
        "swappedUnits",
        "boundaryCodes",
        "eligibleCodes",
        "exclusionReason",
        "batchId",
        "batchChecksum",
        "batchVersion",
        "policy",
        "nullEvidence",
        "nullApprovalId",
        "missingApprovedAt",
        "invalidUrl",
        "numericId",
        "unknownStatus",
        "pendingStatus",
        "duplicateCodes",
        "duplicateBatches",
        "missingReasons",
        "unknownField",
        "missingField",
        "numberAsString",
        "numericStatus",
        "numericUnit",
        "nullPolicy",
        "booleanPolicy",
        "missingBatchField",
        "duplicateReason",
        "numericApprovedAt",
        "numericBatchTime"
      })
  void rejectsContradictoryMalformedOrChangedManifest(String mutation) {
    var bundle = fixture();
    var t = tree(manifest(bundle));
    var district = (ObjectNode) t.get("district");
    var dong = (ObjectNode) t.get("dong");
    var evidence = (ObjectNode) t.get("policyApproval");
    switch (mutation) {
      case "manifestSchemaVersion",
          "quarterCode",
          "industryCode",
          "algorithmVersion",
          "policyVersion" ->
          t.put(mutation, "unsupported");
      case "fileSha256" -> t.put("fileSha256", "0".repeat(64));
      case "districtHash" -> district.put("inputSnapshotId", "0".repeat(64));
      case "dongHash" -> dong.put("inputSnapshotId", "0".repeat(64));
      case "swappedUnits" -> {
        t.set("district", dong);
        t.set("dong", district);
      }
      case "boundaryCodes" -> district.withArray("boundaryRegionCodes").remove(0);
      case "eligibleCodes" -> district.withArray("eligibleRegionCodes").remove(0);
      case "exclusionReason" ->
          ((ObjectNode) dong.get("excludedRegions").get(0).get("reasons").get(0))
              .put("code", "INPUT_NULL");
      case "batchId" ->
          ((ObjectNode) district.get("batches").get(0))
              .put("batchId", "00000000-0000-0000-0000-000000000099");
      case "batchChecksum" ->
          ((ObjectNode) district.get("batches").get(0)).put("sourceChecksum", "b".repeat(64));
      case "batchVersion" ->
          ((ObjectNode) district.get("batches").get(0)).put("etlVersion", "synthetic-other");
      case "policy" -> ((ObjectNode) t.get("policy")).put("salesWeight", "0.25");
      case "nullEvidence" -> t.putNull("sourceVerification");
      case "nullApprovalId" -> evidence.putNull("approvalId");
      case "missingApprovedAt" -> evidence.remove("approvedAt");
      case "invalidUrl" -> evidence.put("evidenceUrl", "file:///forbidden");
      case "numericId" -> evidence.put("approvalId", 1);
      case "unknownStatus" -> evidence.put("status", "FAKE_APPROVED");
      case "pendingStatus" -> {
        evidence.put("status", "PENDING");
        evidence.putNull("approvedAt");
      }
      case "duplicateCodes" -> district.withArray("boundaryRegionCodes").add("00001");
      case "duplicateBatches" -> district.withArray("batches").add(district.get("batches").get(0));
      case "missingReasons" ->
          ((ObjectNode) dong.get("excludedRegions").get(0)).putArray("reasons");
      case "unknownField" -> t.put("trusted", true);
      case "missingField" -> t.remove("policy");
      case "numberAsString" -> t.put("quarterCode", 20262);
      case "numericStatus" -> evidence.put("status", 0);
      case "numericUnit" -> district.put("unit", 0);
      case "nullPolicy" -> t.putNull("policy");
      case "booleanPolicy" -> ((ObjectNode) t.get("policy")).put("salesWeight", true);
      case "missingBatchField" ->
          ((ObjectNode) district.get("batches").get(0)).remove("finishedAt");
      case "duplicateReason" -> {
        var e = (ObjectNode) dong.get("excludedRegions").get(0);
        e.withArray("reasons").add(e.get("reasons").get(0));
      }
      case "numericApprovedAt" -> evidence.put("approvedAt", 1793577600);
      case "numericBatchTime" ->
          ((ObjectNode) district.get("batches").get(0)).put("startedAt", 1790812800);
      default -> throw new AssertionError(mutation);
    }
    assertRejected(t, bundle);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "duplicateKey",
        "truncated",
        "trailing",
        "bom",
        "invalidUtf8",
        "array",
        "selfDeclaredTrust"
      })
  void rejectsDamagedJsonAndSelfDeclaredTrust(String mutation) {
    var bundle = fixture();
    String text = new String(codec.encode(manifest(bundle)), StandardCharsets.UTF_8);
    byte[] bytes =
        switch (mutation) {
          case "duplicateKey" ->
              ("{\"quarterCode\":\"20262\"," + text.substring(1)).getBytes(StandardCharsets.UTF_8);
          case "truncated" -> text.substring(0, text.length() - 2).getBytes(StandardCharsets.UTF_8);
          case "trailing" -> (text + " {}").getBytes(StandardCharsets.UTF_8);
          case "bom" -> ("\ufeff" + text).getBytes(StandardCharsets.UTF_8);
          case "invalidUtf8" -> new byte[] {(byte) 0xc3, (byte) 0x28};
          case "array" -> "[]".getBytes(StandardCharsets.UTF_8);
          case "selfDeclaredTrust" ->
              ("{\"manifestSha256\":\""
                      + codec.sha256(manifest(bundle))
                      + "\","
                      + text.substring(1))
                  .getBytes(StandardCharsets.UTF_8);
          default -> throw new AssertionError(mutation);
        };
    assertThatThrownBy(() -> verifier.verify(bytes, bundle.encode(), references, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("manifest·입력 결합 검증 실패")
        .hasNoCause();
  }

  @Test
  void rejectsAnIncorrectExternalDigestAndMissingIndependentReferences() {
    var bundle = fixture();
    byte[] bytes = codec.encode(manifest(bundle));
    assertThatThrownBy(() -> verifier.verify(bytes, bundle.encode(), references, "0".repeat(64)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> verifier.verify(bytes, bundle.encode(), references, ""))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> verifier.verify(bytes, bundle.encode(), null, null))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(strings = {"value", "scale", "source", "boundary", "extraExcluded"})
  void rejectsNewValidSnapshotsRatherThanFallingBackToOldApprovedInputs(String change) {
    var old = fixture();
    var input = old.dong().payload().input();
    var rows = new ArrayList<>(input.regions());
    var row = rows.get(1);
    var sales = row.sales();
    var foot = row.footTraffic();
    var boundary = input.boundary();
    switch (change) {
      case "value" -> sales = new ScoreInputSnapshot.RawValue("9999", sales.source());
      case "scale" -> foot = new ScoreInputSnapshot.RawValue(foot.raw() + ".0", foot.source());
      case "source" ->
          sales =
              new ScoreInputSnapshot.RawValue(
                  sales.raw(),
                  new ScoreInputSnapshot.RowSource(
                      true,
                      new java.util.UUID(0, 9),
                      ScoreSnapshotTests.batch(9, "SEOUL_DONG_SALES_STAT"),
                      true));
      case "boundary" -> boundary = ScoreSnapshotTests.batch(10, "SEOUL_DONG_BOUNDARY");
      case "extraExcluded" ->
          sales =
              new ScoreInputSnapshot.RawValue(
                  null, new ScoreInputSnapshot.RowSource(false, null, null, false));
      default -> throw new AssertionError(change);
    }
    rows.set(
        1,
        new ScoreInputSnapshot.RegionInput(
            row.regionCode(),
            row.regionName(),
            row.districtCode(),
            row.districtName(),
            sales,
            foot,
            row.storeCount(),
            row.closureRate()));
    var changedInput =
        new ScoreInputSnapshot(
            input.unit(),
            input.quarterCode(),
            input.industryCode(),
            boundary,
            true,
            input.readiness(),
            rows);
    var district = old.district();
    if (change.equals("boundary")) {
      var d = district.payload().input();
      district =
          ScoreSnapshotToolTests.capture(
              new ScoreInputSnapshot(
                  d.unit(),
                  d.quarterCode(),
                  d.industryCode(),
                  boundary,
                  true,
                  d.readiness(),
                  d.regions()));
    }
    var current = new ScoreSnapshotBundle(district, ScoreSnapshotToolTests.capture(changedInput));
    assertThatThrownBy(
            () -> verifier.verify(codec.encode(manifest(old)), current.encode(), references, null))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void canonicalOrderingAndManifestMetadataDoNotChangeInputHashes() {
    var bundle = fixture();
    var manifest = manifest(bundle);
    var tree = tree(manifest);
    ((ObjectNode) tree.get("policyApproval")).put("reviewer", "synthetic-other-reviewer");
    var changed = codec.decode(ScoreSnapshotCodec.canonicalJson(tree));
    assertThat(codec.sha256(changed)).isNotEqualTo(codec.sha256(manifest));
    assertThat(changed.district().inputSnapshotId()).isEqualTo(bundle.district().inputSnapshotId());
    assertThat(changed.dong().inputSnapshotId()).isEqualTo(bundle.dong().inputSnapshotId());
    var reversed = tree(manifest);
    for (String unit : List.of("district", "dong")) {
      var cohort = (ObjectNode) reversed.get(unit);
      for (String field : List.of("boundaryRegionCodes", "eligibleRegionCodes", "batches")) {
        var values = new ArrayList<tools.jackson.databind.JsonNode>();
        cohort.get(field).forEach(values::add);
        Collections.reverse(values);
        var array = cohort.putArray(field);
        values.forEach(array::add);
      }
    }
    assertThat(codec.encode(codec.decode(ScoreSnapshotCodec.canonicalJson(reversed))))
        .isEqualTo(codec.encode(manifest));
    assertThat(new String(codec.encode(manifest), StandardCharsets.UTF_8))
        .contains("\"approvedAt\":\"2026-11-02T00:00:00.1Z\"")
        .doesNotEndWith("\n");
  }

  @Test
  void exposesImmutableCoverageAndPolicyCollections() {
    var m = manifest(fixture());
    assertThatThrownBy(() -> m.policy().put("test", "value"))
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> m.district().boundaryRegionCodes().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> m.dong().excludedRegions().getFirst().reasons().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> m.dong().batches().clear())
        .isInstanceOf(UnsupportedOperationException.class);
  }

  private ObjectNode tree(ScoreApprovalManifest manifest) {
    return (ObjectNode) json.readTree(codec.encode(manifest));
  }

  private void assertRejected(ObjectNode tree, ScoreSnapshotBundle bundle) {
    byte[] bytes = ScoreSnapshotCodec.canonicalJson(tree);
    assertThatThrownBy(() -> verifier.verify(bytes, bundle.encode(), references, null))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("manifest·입력 결합 검증 실패")
        .hasNoCause();
  }

  private static ScoreSnapshotBundle fixture() {
    var d = ScoreSnapshotToolTests.input(ScoreCalculation.RegionUnit.DONG);
    var rows = new ArrayList<>(d.regions());
    var r = rows.getFirst();
    rows.set(
        0,
        new ScoreInputSnapshot.RegionInput(
            r.regionCode(),
            r.regionName(),
            r.districtCode(),
            r.districtName(),
            new ScoreInputSnapshot.RawValue(
                null, new ScoreInputSnapshot.RowSource(false, null, null, false)),
            r.footTraffic(),
            r.storeCount(),
            r.closureRate()));
    return new ScoreSnapshotBundle(
        ScoreSnapshotToolTests.capture(
            ScoreSnapshotToolTests.input(ScoreCalculation.RegionUnit.DISTRICT)),
        ScoreSnapshotToolTests.capture(
            new ScoreInputSnapshot(
                d.unit(),
                d.quarterCode(),
                d.industryCode(),
                d.boundary(),
                true,
                d.readiness(),
                rows)));
  }

  private static ScoreApprovalManifest manifest(ScoreSnapshotBundle bundle) {
    return new ScoreApprovalManifest(
        "score-approval-manifest-v1",
        "20262",
        "CS100010",
        "a-rank-v1-candidate.1",
        "synthetic-policy-v1",
        ScoreSnapshotArtifact.candidatePolicy(),
        binding(bundle.district()),
        binding(bundle.dong()),
        ScoreSnapshotCodec.sha256(bundle.encode()),
        evidence("synthetic-policy-1"),
        evidence("synthetic-source-1"),
        evidence("synthetic-coverage-1"));
  }

  private static ScoreApprovalManifest.CohortBinding binding(ScoreSnapshotArtifact artifact) {
    var p = artifact.payload();
    return new ScoreApprovalManifest.CohortBinding(
        p.input().unit(),
        artifact.inputSnapshotId(),
        p.boundaryRegionCodes(),
        p.eligibleRegionCodes(),
        p.excludedRegions(),
        p.batches());
  }

  private static ScoreApprovalManifest.ApprovalEvidence evidence(String id) {
    return new ScoreApprovalManifest.ApprovalEvidence(
        id,
        ScoreApprovalManifest.ClaimedStatus.APPROVED,
        OffsetDateTime.parse("2026-11-02T09:00:00.100+09:00"),
        "synthetic-reviewer",
        "https://example.invalid/evidence/" + id);
  }
}
