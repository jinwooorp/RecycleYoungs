package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 실제 승인·파일·DB 없이 별도 신뢰 기록의 결합과 이력 제약만 검증한다. */
class ScoreTrustRecordTests {
  private final ScoreTrustRecordCodec codec = new ScoreTrustRecordCodec();
  private final ScoreTrustRecordVerifier verifier = new ScoreTrustRecordVerifier();
  private final ScoreApprovalManifestCodec manifestCodec = new ScoreApprovalManifestCodec();
  private final JsonMapper json = JsonMapper.builder().build();

  @Test
  void verifiesBindingButDoesNotGrantApprovalOrClaimHistoryProtectionWithoutABaseline() {
    var bundle = fixture();
    var m = manifest(bundle);
    var record = record(m);
    var result = verify(record, m, bundle, null);
    assertThat(result.status()).isEqualTo(ScoreTrustRecordVerifier.Status.TRUST_BINDING_VERIFIED);
    assertThat(result.revisionCheck())
        .isEqualTo(ScoreTrustRecordVerifier.RevisionCheck.NOT_PROVIDED);
    assertThat(result.revision()).isEqualTo(2);
    assertThat(result.activeReleaseId()).isEqualTo("synthetic-release-2");
    assertThat(result.manifestSha256()).isEqualTo(manifestCodec.sha256(m));
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.sourceTrust())
        .isEqualTo(ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED);
    assertThat(codec.encode(codec.decode(codec.encode(record)))).isEqualTo(codec.encode(record));
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "policyApprovalId",
        "sourceVerificationId",
        "coverageApprovalId",
        "policyVersion",
        "manifestSha256"
      })
  void rejectsPinsThatDoNotMatchTheManifest(String field) {
    var bundle = fixture();
    var m = manifest(bundle);
    var t = tree(record(m));
    t.put(field, field.equals("manifestSha256") ? "0".repeat(64) : "synthetic-other");
    assertRejected(bytes(t), manifestCodec.encode(m), bundle.encode(), null);
  }

  @ParameterizedTest
  @ValueSource(strings = {"RELEASE", "POLICY_APPROVAL", "SOURCE_VERIFICATION", "COVERAGE_APPROVAL"})
  void rejectsARevokedReleaseOrAnyRevokedExpectedApproval(String target) {
    var bundle = fixture();
    var m = manifest(bundle);
    var t = tree(record(m));
    addRevocation(
        t,
        target,
        switch (target) {
          case "RELEASE" -> "synthetic-release-2";
          case "POLICY_APPROVAL" -> "synthetic-policy-1";
          case "SOURCE_VERIFICATION" -> "synthetic-source-1";
          case "COVERAGE_APPROVAL" -> "synthetic-coverage-1";
          default -> throw new AssertionError(target);
        });
    assertRejected(bytes(t), manifestCodec.encode(m), bundle.encode(), null);
  }

  @ParameterizedTest
  @ValueSource(strings = {"INACTIVE", "REVOKED", "missingActiveRelease"})
  void rejectsInactiveRevokedOrMissingActiveRelease(String mutation) {
    var bundle = fixture();
    var m = manifest(bundle);
    var t = tree(record(m));
    if (mutation.equals("missingActiveRelease")) t.putNull("activeReleaseId");
    else {
      t.put("releaseStatus", mutation);
      if (mutation.equals("REVOKED")) addRevocation(t, "RELEASE", "synthetic-release-2");
    }
    assertRejected(bytes(t), manifestCodec.encode(m), bundle.encode(), null);
  }

  @Test
  void rejectsRevisionRegressionOnlyWhenAnIndependentPreviousRecordIsProvided() {
    var bundle = fixture();
    var m = manifest(bundle);
    var current = record(m);
    var later = tree(current).put("revision", 3);
    assertRejected(
        codec.encode(current),
        manifestCodec.encode(m),
        bundle.encode(),
        codec.decode(bytes(later)));
    assertThat(verify(current, m, bundle, null).revisionCheck())
        .isEqualTo(ScoreTrustRecordVerifier.RevisionCheck.NOT_PROVIDED);
    assertThat(verify(current, m, bundle, current).revisionCheck())
        .isEqualTo(ScoreTrustRecordVerifier.RevisionCheck.CHECKED);
  }

  @Test
  void rejectsDifferentContentsAtTheSameRevisionEvenIfTheBindingIsOtherwiseValid() {
    var bundle = fixture();
    var m = manifest(bundle);
    var current = record(m);
    var different = codec.decode(bytes(tree(current).put("activeReleaseId", "synthetic-another")));
    assertRejected(codec.encode(different), manifestCodec.encode(m), bundle.encode(), current);
  }

  @ParameterizedTest
  @ValueSource(strings = {"deleted", "changedReason", "changedTime"})
  void rejectsRemovalOrRewritingOfIndependentlyKnownRevocations(String mutation) {
    var bundle = fixture();
    var m = manifest(bundle);
    var old = tree(record(m)).put("revision", 1);
    addRevocation(old, "RELEASE", "synthetic-old-release");
    var current = old.deepCopy().put("revision", 2);
    switch (mutation) {
      case "deleted" -> current.putArray("revocations");
      case "changedReason" ->
          ((ObjectNode) current.get("revocations").get(0)).put("reason", "changed");
      case "changedTime" ->
          ((ObjectNode) current.get("revocations").get(0)).put("revokedAt", "2026-11-03T00:00:00Z");
      default -> throw new AssertionError(mutation);
    }
    assertRejected(
        bytes(current), manifestCodec.encode(m), bundle.encode(), codec.decode(bytes(old)));
  }

  @Test
  void rejectsReusingARevokedReleaseAfterRemovingItFromTheNewRecord() {
    var bundle = fixture();
    var m = manifest(bundle);
    var old = tree(record(m)).put("revision", 1).put("releaseStatus", "REVOKED");
    addRevocation(old, "RELEASE", "synthetic-release-2");
    assertRejected(
        codec.encode(record(m)),
        manifestCodec.encode(m),
        bundle.encode(),
        codec.decode(bytes(old)));
  }

  @Test
  void permitsANewReleaseOnlyWithRetainedRevocationsAndANewerRevision() {
    var bundle = fixture();
    var m = manifest(bundle);
    var old =
        tree(record(m))
            .put("revision", 1)
            .put("activeReleaseId", "synthetic-old-release")
            .put("releaseStatus", "REVOKED");
    addRevocation(old, "RELEASE", "synthetic-old-release");
    var current =
        old.deepCopy()
            .put("revision", 2)
            .put("activeReleaseId", "synthetic-release-2")
            .put("releaseStatus", "ACTIVE");
    assertThat(
            verify(codec.decode(bytes(current)), m, bundle, codec.decode(bytes(old)))
                .revisionCheck())
        .isEqualTo(ScoreTrustRecordVerifier.RevisionCheck.CHECKED);
  }

  @Test
  void rejectsRebindingTheSameReleaseIdToAnotherManifestEvenAtANewerRevision() {
    var bundle = fixture();
    var m = manifest(bundle);
    var previous = record(m);
    var changedTree = (ObjectNode) json.readTree(manifestCodec.encode(m));
    ((ObjectNode) changedTree.get("policyApproval")).put("reviewer", "synthetic-other-reviewer");
    var changed = manifestCodec.decode(bytes(changedTree));
    var rebound = record(changed);
    assertRejected(
        codec.encode(codec.decode(bytes(tree(rebound).put("revision", 3)))),
        manifestCodec.encode(changed),
        bundle.encode(),
        previous);
  }

  @Test
  void doesNotBuildTrustFromClaimedApprovedManifestOrInputBytes() {
    var bundle = fixture();
    var m = manifest(bundle);
    byte[] manifestBytes = manifestCodec.encode(m);
    assertRejected(null, manifestBytes, bundle.encode(), null);
    assertRejected(manifestBytes, manifestBytes, bundle.encode(), null);
    assertRejected(bundle.encode(), manifestBytes, bundle.encode(), null);
    // 동시에 위조한 기대값의 유래는 메모리 검증만으로 판별할 수 없지만 공개 승인은 항상 차단한다.
    assertThat(verify(record(m), m, bundle, null).publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
  }

  @ParameterizedTest
  @ValueSource(strings = {"policyApproval", "sourceVerification", "coverageApproval"})
  void rejectsPendingEvidenceEvenWhenTheTrustRecordPinsThatExactManifest(String role) {
    var bundle = fixture();
    var t = (ObjectNode) json.readTree(manifestCodec.encode(manifest(bundle)));
    ((ObjectNode) t.get(role)).put("status", "PENDING").putNull("approvedAt");
    var pending = manifestCodec.decode(bytes(t));
    assertRejected(
        codec.encode(record(pending)), manifestCodec.encode(pending), bundle.encode(), null);
  }

  @Test
  void rejectsInputEditionAndRawValueChangesWithoutFallingBackToTheOldBundle() {
    var bundle = fixture();
    var m = manifest(bundle);
    var d = bundle.district().payload().input();
    var rows = new ArrayList<>(d.regions());
    var r = rows.getFirst();
    rows.set(
        0,
        new ScoreInputSnapshot.RegionInput(
            r.regionCode(),
            r.regionName(),
            r.districtCode(),
            r.districtName(),
            new ScoreInputSnapshot.RawValue("999", r.sales().source()),
            r.footTraffic(),
            r.storeCount(),
            r.closureRate()));
    var changed =
        new ScoreSnapshotBundle(
            ScoreSnapshotToolTests.capture(
                new ScoreInputSnapshot(
                    d.unit(),
                    d.quarterCode(),
                    d.industryCode(),
                    d.boundary(),
                    d.boundaryRowsPresent(),
                    d.readiness(),
                    rows)),
            bundle.dong());
    assertRejected(codec.encode(record(m)), manifestCodec.encode(m), changed.encode(), null);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "schema",
        "missingId",
        "nullId",
        "numericId",
        "missingHash",
        "upperHash",
        "zeroRevision",
        "negativeRevision",
        "stringRevision",
        "decimalRevision",
        "nullRevision",
        "overflowRevision",
        "unknownField",
        "numericStatus",
        "badStatus",
        "quarter",
        "industry",
        "algorithm",
        "missingRevocations",
        "nullRevocations",
        "nullRevocation",
        "missingReason",
        "blankReason",
        "numericTime",
        "missingTime",
        "invalidTime",
        "numericTarget",
        "duplicateRevocation"
      })
  void rejectsMalformedOrContradictoryTrustRecords(String mutation) {
    var t = tree(record(manifest(fixture())));
    addRevocation(t, "RELEASE", "synthetic-retired");
    var revocation = (ObjectNode) t.get("revocations").get(0);
    switch (mutation) {
      case "schema" -> t.put("trustRecordSchemaVersion", "unsupported");
      case "missingId" -> t.remove("policyApprovalId");
      case "nullId" -> t.putNull("policyApprovalId");
      case "numericId" -> t.put("policyApprovalId", 1);
      case "missingHash" -> t.remove("manifestSha256");
      case "upperHash" -> t.put("manifestSha256", "A".repeat(64));
      case "zeroRevision" -> t.put("revision", 0);
      case "negativeRevision" -> t.put("revision", -1);
      case "stringRevision" -> t.put("revision", "2");
      case "decimalRevision" -> t.put("revision", 2.5);
      case "nullRevision" -> t.putNull("revision");
      case "overflowRevision" -> t.put("revision", new java.math.BigInteger("9223372036854775808"));
      case "unknownField" -> t.put("approved", true);
      case "numericStatus" -> t.put("releaseStatus", 0);
      case "badStatus" -> t.put("releaseStatus", "APPROVED");
      case "quarter" -> t.put("quarterCode", "20261");
      case "industry" -> t.put("industryCode", "CS100001");
      case "algorithm" -> t.put("algorithmVersion", "other");
      case "missingRevocations" -> t.remove("revocations");
      case "nullRevocations" -> t.putNull("revocations");
      case "nullRevocation" -> t.withArray("revocations").addNull();
      case "missingReason" -> revocation.remove("reason");
      case "blankReason" -> revocation.put("reason", " ");
      case "numericTime" -> revocation.put("revokedAt", 1793577600);
      case "missingTime" -> revocation.remove("revokedAt");
      case "invalidTime" -> revocation.put("revokedAt", "not-a-time");
      case "numericTarget" -> revocation.put("target", 0);
      case "duplicateRevocation" -> t.withArray("revocations").add(revocation.deepCopy());
      default -> throw new AssertionError(mutation);
    }
    assertThatThrownBy(() -> codec.decode(bytes(t)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasNoCause();
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
        "null",
        "unpairedSurrogate"
      })
  void rejectsDamagedJsonWithoutLeakingItsContents(String mutation) {
    String text = new String(codec.encode(record(manifest(fixture()))), StandardCharsets.UTF_8);
    byte[] damaged =
        switch (mutation) {
          case "duplicateKey" ->
              ("{\"revision\":2," + text.substring(1)).getBytes(StandardCharsets.UTF_8);
          case "truncated" -> text.substring(0, text.length() - 1).getBytes(StandardCharsets.UTF_8);
          case "trailing" -> (text + " {}").getBytes(StandardCharsets.UTF_8);
          case "bom" -> ("\ufeff" + text).getBytes(StandardCharsets.UTF_8);
          case "invalidUtf8" -> new byte[] {(byte) 0xc3, (byte) 0x28};
          case "array" -> "[]".getBytes(StandardCharsets.UTF_8);
          case "null" -> "null".getBytes(StandardCharsets.UTF_8);
          case "unpairedSurrogate" ->
              text.replace("synthetic-release-2", "\\ud800").getBytes(StandardCharsets.UTF_8);
          default -> throw new AssertionError(mutation);
        };
    assertThatThrownBy(() -> codec.decode(damaged))
        .isInstanceOf(IllegalArgumentException.class)
        .hasNoCause();
  }

  @Test
  void canonicalizesRevocationOrderAndUtcTimesAndDefensivelyCopiesCollections() {
    var t = tree(record(manifest(fixture())));
    addRevocation(t, "RELEASE", "synthetic-old-b");
    addRevocation(t, "RELEASE", "synthetic-old-a");
    ((ObjectNode) t.get("revocations").get(0)).put("revokedAt", "2026-11-02T09:00:00.100+09:00");
    var r = codec.decode(bytes(t));
    String canonical = new String(codec.encode(r), StandardCharsets.UTF_8);
    assertThat(canonical).contains("\"revokedAt\":\"2026-11-02T00:00:00.1Z\"").doesNotEndWith("\n");
    assertThat(canonical.indexOf("synthetic-old-a"))
        .isLessThan(canonical.indexOf("synthetic-old-b"));
    var list = new ArrayList<>(r.revocations());
    var copy =
        new ScoreTrustRecord(
            r.trustRecordSchemaVersion(),
            r.revision(),
            r.activeReleaseId(),
            r.releaseStatus(),
            r.quarterCode(),
            r.industryCode(),
            r.algorithmVersion(),
            r.policyVersion(),
            r.manifestSha256(),
            r.policyApprovalId(),
            r.sourceVerificationId(),
            r.coverageApprovalId(),
            list);
    list.clear();
    assertThat(copy.revocations()).hasSize(2);
    assertThatThrownBy(() -> copy.revocations().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThat(codec.encode(codec.decode(codec.encode(copy)))).isEqualTo(codec.encode(copy));
  }

  @Test
  void matchesAnIndependentlyHashedCanonicalFixture() {
    // Python 표준 json(sort_keys, separators)와 hashlib로 별도 검산한 합성 기록이다.
    String canonical =
        "{\"activeReleaseId\":\"synthetic-release-1\",\"algorithmVersion\":\"a-rank-v1-candidate.1\",\"coverageApprovalId\":\"synthetic-coverage-1\",\"industryCode\":\"CS100010\",\"manifestSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"policyApprovalId\":\"synthetic-policy-1\",\"policyVersion\":\"synthetic-policy-v1\",\"quarterCode\":\"20262\",\"releaseStatus\":\"ACTIVE\",\"revision\":1,\"revocations\":[],\"sourceVerificationId\":\"synthetic-source-1\",\"trustRecordSchemaVersion\":\"score-trust-record-v1\"}";
    var record = codec.decode(canonical.getBytes(StandardCharsets.UTF_8));
    assertThat(codec.encode(record)).isEqualTo(canonical.getBytes(StandardCharsets.UTF_8));
    assertThat(codec.sha256(record))
        .isEqualTo("45c9c929a665a98282f951dcb4a516c0cd8f6dbd7fb48a88b45284d00bd84288");
  }

  @Test
  void canonicalizesDifferentObjectAndRevocationOrdersToTheSameBytesAndHash() {
    var t = tree(record(manifest(fixture())));
    addRevocation(t, "SOURCE_VERIFICATION", "synthetic-old-source");
    addRevocation(t, "RELEASE", "synthetic-old-release");
    var first = codec.decode(bytes(t));
    var reordered = json.createObjectNode();
    var keys = new ArrayList<String>(t.propertyNames());
    java.util.Collections.reverse(keys);
    for (var key : keys) reordered.set(key, t.get(key));
    reordered
        .putArray("revocations")
        .add(t.get("revocations").get(1))
        .add(t.get("revocations").get(0));
    var second = codec.decode(bytes(reordered));
    assertThat(codec.encode(second)).isEqualTo(codec.encode(first));
    assertThat(codec.sha256(second)).isEqualTo(codec.sha256(first));
  }

  @ParameterizedTest
  @ValueSource(strings = {"trust", "manifest", "bundle"})
  void rejectsMissingComponents(String missing) {
    var bundle = fixture();
    var m = manifest(bundle);
    assertRejected(
        missing.equals("trust") ? null : codec.encode(record(m)),
        missing.equals("manifest") ? null : manifestCodec.encode(m),
        missing.equals("bundle") ? null : bundle.encode(),
        null);
  }

  private ScoreTrustRecordVerifier.Result verify(
      ScoreTrustRecord r,
      ScoreApprovalManifest m,
      ScoreSnapshotBundle b,
      ScoreTrustRecord previous) {
    return verifier.verify(codec.encode(r), manifestCodec.encode(m), b.encode(), previous);
  }

  private void assertRejected(
      byte[] trust, byte[] manifest, byte[] bundle, ScoreTrustRecord previous) {
    assertThatThrownBy(() -> verifier.verify(trust, manifest, bundle, previous))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("신뢰 기록·입력 결합 검증 실패")
        .hasNoCause();
  }

  private ObjectNode tree(ScoreTrustRecord r) {
    return (ObjectNode) json.readTree(codec.encode(r));
  }

  private byte[] bytes(ObjectNode t) {
    return json.writeValueAsBytes(t);
  }

  private static void addRevocation(ObjectNode t, String target, String id) {
    t.withArray("revocations")
        .addObject()
        .put("target", target)
        .put("targetId", id)
        .put("reason", "synthetic-withdrawal")
        .put("revokedAt", "2026-11-02T00:00:00Z");
  }

  private ScoreTrustRecord record(ScoreApprovalManifest m) {
    return new ScoreTrustRecord(
        "score-trust-record-v1",
        2,
        "synthetic-release-2",
        ScoreTrustRecord.ReleaseStatus.ACTIVE,
        "20262",
        "CS100010",
        "a-rank-v1-candidate.1",
        "synthetic-policy-v1",
        manifestCodec.sha256(m),
        "synthetic-policy-1",
        "synthetic-source-1",
        "synthetic-coverage-1",
        List.of());
  }

  private static ScoreSnapshotBundle fixture() {
    return new ScoreSnapshotBundle(
        ScoreSnapshotToolTests.capture(
            ScoreSnapshotToolTests.input(ScoreCalculation.RegionUnit.DISTRICT)),
        ScoreSnapshotToolTests.capture(
            ScoreSnapshotToolTests.input(ScoreCalculation.RegionUnit.DONG)));
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

  private static ScoreApprovalManifest.CohortBinding binding(ScoreSnapshotArtifact a) {
    var p = a.payload();
    return new ScoreApprovalManifest.CohortBinding(
        p.input().unit(),
        a.inputSnapshotId(),
        p.boundaryRegionCodes(),
        p.eligibleRegionCodes(),
        p.excludedRegions(),
        p.batches());
  }

  private static ScoreApprovalManifest.ApprovalEvidence evidence(String id) {
    return new ScoreApprovalManifest.ApprovalEvidence(
        id,
        ScoreApprovalManifest.ClaimedStatus.APPROVED,
        OffsetDateTime.parse("2026-11-02T00:00:00Z"),
        "synthetic-reviewer",
        "https://example.invalid/evidence/" + id);
  }
}
