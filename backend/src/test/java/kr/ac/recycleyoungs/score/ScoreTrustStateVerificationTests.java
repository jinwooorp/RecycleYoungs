package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 공급자는 합성 불변 기준만 제공한다. 운영 승인 파일·환경변수·DB는 사용하지 않는다. */
class ScoreTrustStateVerificationTests {
  @TempDir Path temporary;
  private final ScoreTrustRecordCodec codec = new ScoreTrustRecordCodec();
  private final ScoreApprovalManifestCodec manifestCodec = new ScoreApprovalManifestCodec();
  private final JsonMapper json = JsonMapper.builder().build();
  private ScoreTrustVerification trustVerification;
  private ScoreTrustVerification.InputFiles files;
  private ScoreTrustRecord record;
  private ScoreTrustBasisProvider.Snapshot basis;

  @BeforeEach
  void syntheticFilesAndIndependentTestPins() throws Exception {
    Path directory = temporary.toRealPath();
    Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
    files =
        new ScoreTrustVerification.InputFiles(
            directory.resolve("trust.json"),
            directory.resolve("manifest.json"),
            directory.resolve("bundle.json"),
            null);
    trustVerification = new ScoreTrustVerification(Path.of("..").toRealPath());
    var bundle = ScoreSnapshotToolTests.fixture();
    var manifest =
        new ScoreApprovalManifest(
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
    Files.write(files.manifest(), manifestCodec.encode(manifest));
    Files.write(files.snapshotBundle(), bundle.encode());
    write(
        new ScoreTrustRecord(
            "score-trust-record-v1",
            2,
            "synthetic-release-2",
            ScoreTrustRecord.ReleaseStatus.ACTIVE,
            "20262",
            "CS100010",
            "a-rank-v1-candidate.1",
            "synthetic-policy-v1",
            manifestCodec.sha256(manifest),
            "synthetic-policy-1",
            "synthetic-source-1",
            "synthetic-coverage-1",
            List.of()));
  }

  @Test
  void noProviderOrReadFailureNeverRunsBindingOrUsesApprovalClaims() {
    var unused = mock(ScoreTrustVerification.class);
    assertStatus(
        new ScoreTrustStateVerification(null, unused).verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_MISSING);
    assertStatus(
        new ScoreTrustStateVerification(
                () -> {
                  throw new IOException("private-password-sentinel");
                },
                unused)
            .verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_UNAVAILABLE);
    assertStatus(
        new ScoreTrustStateVerification(() -> basis, null).verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_MISSING);
    verifyNoInteractions(unused);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "null",
        "changeId",
        "activeReleaseId",
        "releaseStatus",
        "hash",
        "minimum",
        "zero",
        "previousRecord",
        "previousHash"
      })
  void incompleteBasisIsRejectedBeforeFilesAreRead(String field) {
    var unused = mock(ScoreTrustVerification.class);
    var invalid = incomplete(field);
    assertStatus(
        new ScoreTrustStateVerification(() -> invalid, unused).verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_MISSING);
    verifyNoInteractions(unused);
  }

  @Test
  void stableSyntheticProviderChecksBothEndsWithoutGrantingPublication() {
    var reads = new AtomicInteger();
    var result =
        component(
                () -> {
                  reads.incrementAndGet();
                  return basis;
                })
            .verify(files);
    assertStatus(result, ScoreTrustStateVerification.Status.VERIFIED);
    assertThat(reads).hasValue(2);
    assertThat(result.historyCheck())
        .isEqualTo(ScoreTrustVerification.HistoryCheck.REVISION_FLOOR_ONLY);
    assertThat(result.currentInputStatus()).isNull();
  }

  @ParameterizedTest
  @ValueSource(strings = {"hash", "releaseId", "previousHash"})
  void independentHashAndActiveReleaseMustMatch(String which) {
    var expected = which.equals("hash") ? "0".repeat(64) : basis.expectedTrustSha256();
    var id = which.equals("releaseId") ? "synthetic-other-release" : basis.activeReleaseId();
    var previous =
        which.equals("previousHash")
            ? new ScoreTrustBasisProvider.PreviousRecord(record, "0".repeat(64))
            : null;
    var supplied =
        new ScoreTrustBasisProvider.Snapshot(
            basis.changeId(), id, basis.releaseStatus(), expected, 2L, previous);
    assertStatus(
        component(() -> supplied).verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_MISMATCH);
  }

  @ParameterizedTest
  @ValueSource(strings = {"INACTIVE", "REVOKED"})
  void providerCanDenyAReleaseBeforeReadingTheCurrentFiles(String state) {
    var supplied =
        new ScoreTrustBasisProvider.Snapshot(
            basis.changeId(),
            basis.activeReleaseId(),
            ScoreTrustRecord.ReleaseStatus.valueOf(state),
            basis.expectedTrustSha256(),
            2L,
            null);
    var unused = mock(ScoreTrustVerification.class);
    assertStatus(
        new ScoreTrustStateVerification(() -> supplied, unused).verify(files),
        ScoreTrustStateVerification.Status.REVOCATION_OR_REVISION_FAILURE);
    verifyNoInteractions(unused);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "INACTIVE",
        "REVOKED",
        "POLICY_APPROVAL",
        "SOURCE_VERIFICATION",
        "COVERAGE_APPROVAL"
      })
  void activeProviderAndCorrectPinDoNotOverrideRevokedOrInactiveRecords(String state)
      throws Exception {
    var tree = tree(record);
    if (state.equals("INACTIVE") || state.equals("REVOKED")) tree.put("releaseStatus", state);
    if (!state.equals("INACTIVE"))
      revoke(
          tree,
          state.equals("REVOKED") ? "RELEASE" : state,
          state.equals("REVOKED") ? record.activeReleaseId() : expectedId(state));
    write(codec.decode(json.writeValueAsBytes(tree)));
    assertStatus(
        component(() -> basis).verify(files),
        ScoreTrustStateVerification.Status.REVOCATION_OR_REVISION_FAILURE);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "policyVersion",
        "policyApprovalId",
        "sourceVerificationId",
        "coverageApprovalId",
        "manifestSha256",
        "quarterCode",
        "industryCode",
        "algorithmVersion"
      })
  void pinnedCurrentRecordStillNeedsTheExistingManifestAndScopeBinding(String field)
      throws Exception {
    var tree =
        tree(record)
            .put(field, field.equals("manifestSha256") ? "0".repeat(64) : "synthetic-other");
    if (List.of("quarterCode", "industryCode", "algorithmVersion").contains(field)) {
      Files.write(files.trustRecord(), json.writeValueAsBytes(tree));
      assertStatus(
          component(() -> basis).verify(files),
          ScoreTrustStateVerification.Status.TRUST_BASIS_MISMATCH);
    } else {
      write(codec.decode(json.writeValueAsBytes(tree)));
      assertStatus(
          component(() -> basis).verify(files), ScoreTrustStateVerification.Status.BINDING_FAILURE);
    }
  }

  @Test
  void currentRevisionMustMeetTheIndependentlyProvidedFloor() {
    var supplied =
        new ScoreTrustBasisProvider.Snapshot(
            basis.changeId(),
            basis.activeReleaseId(),
            basis.releaseStatus(),
            basis.expectedTrustSha256(),
            3L,
            null);
    assertStatus(
        component(() -> supplied).verify(files),
        ScoreTrustStateVerification.Status.REVOCATION_OR_REVISION_FAILURE);
  }

  @Test
  void providerPreviousRecordIsPinnedAndPassedToTheExistingHistoryVerifier() throws Exception {
    var prior = codec.decode(json.writeValueAsBytes(tree(record).put("revision", 1)));
    var supplied = withPrevious(basis, prior);
    var result = component(() -> supplied).verify(files);
    assertStatus(result, ScoreTrustStateVerification.Status.VERIFIED);
    assertThat(result.historyCheck()).isEqualTo(ScoreTrustVerification.HistoryCheck.CHECKED);
    var injected =
        new ScoreTrustVerification.InputFiles(
            files.trustRecord(),
            files.manifest(),
            files.snapshotBundle(),
            temporary.toRealPath().resolve("caller-previous.json"));
    assertStatus(
        component(() -> supplied).verify(injected),
        ScoreTrustStateVerification.Status.TRUST_BASIS_MISSING);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "rollback",
        "sameRevisionChanged",
        "deletedRevocation",
        "changedReason",
        "changedTime",
        "reusedRelease",
        "reusedPolicy",
        "reusedSource",
        "reusedCoverage",
        "sameReleaseRebound"
      })
  void independentlyKnownHistoryCannotBeRolledBackOrRewritten(String mutation) throws Exception {
    var old = tree(record);
    switch (mutation) {
      case "rollback" -> old.put("revision", 3);
      case "sameRevisionChanged" -> old.put("activeReleaseId", "synthetic-another");
      case "sameReleaseRebound" -> old.put("revision", 1).put("manifestSha256", "0".repeat(64));
      default -> {
        old.put("revision", 1);
        String target =
            switch (mutation) {
              case "reusedPolicy" -> "POLICY_APPROVAL";
              case "reusedSource" -> "SOURCE_VERIFICATION";
              case "reusedCoverage" -> "COVERAGE_APPROVAL";
              default -> "RELEASE";
            };
        String id =
            mutation.startsWith("reused")
                ? (target.equals("RELEASE") ? record.activeReleaseId() : expectedId(target))
                : "synthetic-retired";
        revoke(old, target, id);
        if (mutation.equals("changedReason") || mutation.equals("changedTime")) {
          var current = tree(record);
          revoke(current, target, id);
          var revoked = (ObjectNode) current.get("revocations").get(0);
          if (mutation.equals("changedReason")) revoked.put("reason", "synthetic-new-reason");
          else revoked.put("revokedAt", "2026-11-04T00:00:00Z");
          write(codec.decode(json.writeValueAsBytes(current)));
        }
      }
    }
    var supplied = withPrevious(basis, codec.decode(json.writeValueAsBytes(old)));
    assertStatus(
        component(() -> supplied).verify(files),
        ScoreTrustStateVerification.Status.REVOCATION_OR_REVISION_FAILURE);
  }

  @Test
  void aNewReleaseCanBindOnlyWithANewerRecordAndRetainedKnownRevocations() throws Exception {
    var old = tree(record).put("releaseStatus", "REVOKED");
    revoke(old, "RELEASE", record.activeReleaseId());
    var previous = codec.decode(json.writeValueAsBytes(old));
    var current = tree(record).put("revision", 3).put("activeReleaseId", "synthetic-release-3");
    revoke(current, "RELEASE", record.activeReleaseId());
    write(codec.decode(json.writeValueAsBytes(current)));
    var supplied = withPrevious(basis, previous);
    assertStatus(
        component(() -> supplied).verify(files), ScoreTrustStateVerification.Status.VERIFIED);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "changeId",
        "releaseId",
        "state",
        "hash",
        "revision",
        "previous",
        "sameDataNewGeneration"
      })
  void changesToAnyBasisFieldInvalidateIntermediateSuccessEvenWithAReusedChangeId(String field) {
    var after =
        new ScoreTrustBasisProvider.Snapshot(
            field.equals("changeId") || field.equals("sameDataNewGeneration")
                ? "synthetic-generation-2"
                : basis.changeId(),
            field.equals("releaseId") ? "synthetic-new-release" : basis.activeReleaseId(),
            field.equals("state") ? ScoreTrustRecord.ReleaseStatus.REVOKED : basis.releaseStatus(),
            field.equals("hash") ? "0".repeat(64) : basis.expectedTrustSha256(),
            field.equals("revision") ? 3L : basis.minimumRevision(),
            field.equals("previous")
                ? new ScoreTrustBasisProvider.PreviousRecord(record, codec.sha256(record))
                : null);
    var calls = new AtomicInteger();
    assertStatus(
        component(() -> calls.incrementAndGet() == 1 ? basis : after).verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_CHANGED);
    assertThat(calls).hasValue(2);
  }

  @ParameterizedTest
  @ValueSource(strings = {"exception", "null", "incomplete"})
  void endLookupFailureAlsoInvalidatesASuccessfulBinding(String mutation) {
    var calls = new AtomicInteger();
    var result =
        component(
                () -> {
                  if (calls.incrementAndGet() == 1) return basis;
                  if (mutation.equals("exception"))
                    throw new IOException("private-provider-password-sentinel");
                  return mutation.equals("null") ? null : incomplete("hash");
                })
            .verify(files);
    assertStatus(result, ScoreTrustStateVerification.Status.TRUST_BASIS_CHANGED);
    assertThat(result.historyCheck()).isEqualTo(ScoreTrustVerification.HistoryCheck.NOT_PROVIDED);
    assertThat(result.currentInputStatus()).isNull();
  }

  @Test
  void endChangeHasPriorityEvenIfBindingHadAlreadyFailed() throws Exception {
    Files.writeString(files.manifest(), "private-broken-json-sentinel");
    var after =
        new ScoreTrustBasisProvider.Snapshot(
            "synthetic-generation-2",
            basis.activeReleaseId(),
            basis.releaseStatus(),
            basis.expectedTrustSha256(),
            2L,
            null);
    var calls = new AtomicInteger();
    assertStatus(
        component(() -> calls.incrementAndGet() == 1 ? basis : after).verify(files),
        ScoreTrustStateVerification.Status.TRUST_BASIS_CHANGED);
    assertThat(calls).hasValue(2);
  }

  @Test
  void optionalCurrentDbStepUsesTheSameReferenceAndRechecksTheProviderAfterwards() {
    var current = mock(ScoreCurrentInputVerification.class);
    var supplied = new AtomicReference<>(basis);
    var calls = new AtomicInteger();
    when(current.verify(any(ScoreSnapshotReference.class)))
        .thenAnswer(
            invocation -> {
              var reference = invocation.getArgument(0, ScoreSnapshotReference.class);
              assertThat(reference.fileSha256())
                  .isEqualTo(ScoreSnapshotCodec.sha256(Files.readAllBytes(files.snapshotBundle())));
              supplied.set(
                  new ScoreTrustBasisProvider.Snapshot(
                      "synthetic-generation-2",
                      basis.activeReleaseId(),
                      ScoreTrustRecord.ReleaseStatus.REVOKED,
                      basis.expectedTrustSha256(),
                      3L,
                      null));
              return new ScoreCurrentInputVerification.Result(
                  ScoreInputComparison.Status.MATCHED, reference.fileSha256());
            });
    var result =
        component(
                () -> {
                  calls.incrementAndGet();
                  return supplied.get();
                })
            .verifyCurrentInputs(files, current);
    assertStatus(result, ScoreTrustStateVerification.Status.TRUST_BASIS_CHANGED);
    verify(current).verify(any(ScoreSnapshotReference.class));
    assertThat(calls).hasValue(2);
    assertThat(result.currentInputStatus()).isNull();
  }

  @Test
  void stableProviderCanFinishAnExplicitSyntheticDbDiagnosticWithoutApproval() {
    var current = mock(ScoreCurrentInputVerification.class);
    when(current.verify(any(ScoreSnapshotReference.class)))
        .thenAnswer(
            invocation ->
                new ScoreCurrentInputVerification.Result(
                    ScoreInputComparison.Status.MATCHED,
                    invocation.getArgument(0, ScoreSnapshotReference.class).fileSha256()));
    var result = component(() -> basis).verifyCurrentInputs(files, current);
    assertStatus(result, ScoreTrustStateVerification.Status.VERIFIED);
    assertThat(result.currentInputStatus()).isEqualTo(ScoreInputComparison.Status.MATCHED);
    assertStatus(
        component(() -> basis).verifyCurrentInputs(files, null),
        ScoreTrustStateVerification.Status.TRUST_BASIS_MISSING);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "INPUT_MISMATCH",
        "REFERENCE_INVALID",
        "DATA_NOT_READY",
        "DATABASE_UNAVAILABLE",
        "INTERNAL_ERROR",
        "wrongReference"
      })
  void dbFailureOrAResultForAnotherReferenceNeverBecomesVerified(String state) {
    var current = mock(ScoreCurrentInputVerification.class);
    when(current.verify(any(ScoreSnapshotReference.class)))
        .thenAnswer(
            invocation ->
                new ScoreCurrentInputVerification.Result(
                    state.equals("wrongReference")
                        ? ScoreInputComparison.Status.MATCHED
                        : ScoreInputComparison.Status.valueOf(state),
                    state.equals("wrongReference")
                        ? "0".repeat(64)
                        : invocation.getArgument(0, ScoreSnapshotReference.class).fileSha256()));
    assertStatus(
        component(() -> basis).verifyCurrentInputs(files, current),
        ScoreTrustStateVerification.Status.CURRENT_INPUT_FAILURE);
  }

  @Test
  void bindingFailureNeverRunsTheOptionalDbDiagnostic() throws Exception {
    var current = mock(ScoreCurrentInputVerification.class);
    Files.delete(files.snapshotBundle());
    assertStatus(
        component(() -> basis).verifyCurrentInputs(files, current),
        ScoreTrustStateVerification.Status.FILE_OR_INTEGRITY_FAILURE);
    verifyNoInteractions(current);
  }

  @Test
  void aPreviousSuccessIsNeverUsedWhenTheProviderDisappearsOrFailsLater() {
    var live = new AtomicReference<>(basis);
    var component = component(live::get);
    assertStatus(component.verify(files), ScoreTrustStateVerification.Status.VERIFIED);
    live.set(null);
    assertStatus(component.verify(files), ScoreTrustStateVerification.Status.TRUST_BASIS_MISSING);
    var fail = new AtomicInteger();
    var failing =
        component(
            () -> {
              if (fail.incrementAndGet() > 2) throw new IOException("password-sentinel");
              return basis;
            });
    assertStatus(failing.verify(files), ScoreTrustStateVerification.Status.VERIFIED);
    assertStatus(failing.verify(files), ScoreTrustStateVerification.Status.TRUST_BASIS_UNAVAILABLE);
  }

  @Test
  void providerValueToStringDoesNotExposeEvidenceOrIndependentPins() {
    var previous = new ScoreTrustBasisProvider.PreviousRecord(record, codec.sha256(record));
    var supplied = withPrevious(basis, record);
    assertThat(previous.toString())
        .doesNotContain(record.activeReleaseId(), record.manifestSha256());
    assertThat(supplied.toString())
        .doesNotContain(basis.expectedTrustSha256(), basis.activeReleaseId());
  }

  private ScoreTrustStateVerification component(ScoreTrustBasisProvider provider) {
    return new ScoreTrustStateVerification(provider, trustVerification);
  }

  private void assertStatus(
      ScoreTrustStateVerification.Result result, ScoreTrustStateVerification.Status expected) {
    assertThat(result.status()).isEqualTo(expected);
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.sourceTrust())
        .isEqualTo(ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED);
    assertThat(result.r03Complete()).isFalse();
    assertThat(result.toString())
        .doesNotContain(
            temporary.toString(),
            "sentinel",
            "synthetic-release",
            "synthetic-reviewer",
            "Exception",
            basis.expectedTrustSha256());
  }

  private ScoreTrustBasisProvider.Snapshot incomplete(String field) {
    if (field.equals("null")) return null;
    var previous =
        field.equals("previousRecord")
            ? new ScoreTrustBasisProvider.PreviousRecord(null, basis.expectedTrustSha256())
            : field.equals("previousHash")
                ? new ScoreTrustBasisProvider.PreviousRecord(record, null)
                : null;
    return new ScoreTrustBasisProvider.Snapshot(
        field.equals("changeId") ? null : basis.changeId(),
        field.equals("activeReleaseId") ? null : basis.activeReleaseId(),
        field.equals("releaseStatus") ? null : basis.releaseStatus(),
        field.equals("hash") ? null : basis.expectedTrustSha256(),
        field.equals("minimum") ? null : field.equals("zero") ? 0L : 2L,
        previous);
  }

  private static ScoreTrustBasisProvider.Snapshot withPrevious(
      ScoreTrustBasisProvider.Snapshot s, ScoreTrustRecord previous) {
    return new ScoreTrustBasisProvider.Snapshot(
        s.changeId(),
        s.activeReleaseId(),
        s.releaseStatus(),
        s.expectedTrustSha256(),
        s.minimumRevision(),
        new ScoreTrustBasisProvider.PreviousRecord(
            previous, new ScoreTrustRecordCodec().sha256(previous)));
  }

  private ObjectNode tree(ScoreTrustRecord value) {
    return (ObjectNode) json.readTree(codec.encode(value));
  }

  private void write(ScoreTrustRecord value) throws Exception {
    record = value;
    Files.write(files.trustRecord(), codec.encode(value));
    // 합성 테스트만 기대값을 생성한다. 제품 공급자는 독립 기준을 외부에서 받아야 한다.
    basis =
        new ScoreTrustBasisProvider.Snapshot(
            "synthetic-generation-1",
            value.activeReleaseId(),
            ScoreTrustRecord.ReleaseStatus.ACTIVE,
            codec.sha256(value),
            2L,
            null);
  }

  private static String expectedId(String target) {
    return switch (target) {
      case "POLICY_APPROVAL" -> "synthetic-policy-1";
      case "SOURCE_VERIFICATION" -> "synthetic-source-1";
      case "COVERAGE_APPROVAL" -> "synthetic-coverage-1";
      default -> throw new AssertionError();
    };
  }

  private static void revoke(ObjectNode tree, String target, String id) {
    tree.withArray("revocations")
        .addObject()
        .put("target", target)
        .put("targetId", id)
        .put("reason", "private-revocation-sentinel")
        .put("revokedAt", "2026-11-02T00:00:00Z");
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
        OffsetDateTime.parse("2026-11-02T00:00:00Z"),
        "synthetic-reviewer",
        "https://example.invalid/" + id);
  }
}
