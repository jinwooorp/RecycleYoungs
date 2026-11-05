package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 제품 진입점을 합성 파일로 검사하며 실제 신뢰 공급자·승인·DB에는 접근하지 않는다. */
class ScoreTrustVerificationTests {
  @TempDir Path temporary;
  private final ScoreTrustRecordCodec codec = new ScoreTrustRecordCodec();
  private final ScoreApprovalManifestCodec manifestCodec = new ScoreApprovalManifestCodec();
  private final JsonMapper json = JsonMapper.builder().build();
  private ScoreTrustVerification.InputFiles files;
  private String expected;
  private String previousExpected;
  private ScoreTrustVerification verification;

  @BeforeEach
  void syntheticInputs() throws Exception {
    Path directory = temporary.toRealPath();
    Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
    files =
        new ScoreTrustVerification.InputFiles(
            directory.resolve("trust.json"),
            directory.resolve("manifest.json"),
            directory.resolve("bundle.json"),
            null);
    verification = new ScoreTrustVerification(repository());
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
    Files.write(files.snapshotBundle(), bundle.encode());
    Files.write(files.manifest(), manifestCodec.encode(manifest));
    writeTrust(
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
  void missingTrustBasisRejectsBeforeAnyFileAccessOrConstructionSideEffects() {
    var reads = new AtomicInteger();
    var component =
        new ScoreTrustVerification(
            null,
            (path, root) -> {
              reads.incrementAndGet();
              throw new AccessDeniedException("secret");
            });
    assertThat(reads).hasValue(0);
    assertStatus(component.verify(null, files), ScoreTrustVerification.Status.TRUST_BASIS_MISSING);
    assertThat(reads).hasValue(0);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "missingHash",
        "badHash",
        "previousPathOnly",
        "previousHashOnly",
        "badPreviousHash",
        "zeroFloor",
        "relative",
        "missingInputs"
      })
  void invalidConfigurationNeverReadsFiles(String mutation) throws Exception {
    var basis = basis(null);
    var input = files;
    switch (mutation) {
      case "missingHash" -> basis = new ScoreTrustVerification.TrustBasis(null, null, null);
      case "badHash" -> basis = new ScoreTrustVerification.TrustBasis("A".repeat(64), null, null);
      case "previousPathOnly" ->
          input =
              new ScoreTrustVerification.InputFiles(
                  files.trustRecord(),
                  files.manifest(),
                  files.snapshotBundle(),
                  temporary.toRealPath().resolve("previous.json"));
      case "previousHashOnly" ->
          basis = new ScoreTrustVerification.TrustBasis(expected, expected, null);
      case "badPreviousHash" -> {
        previous(trust());
        basis = new ScoreTrustVerification.TrustBasis(expected, "bad", null);
        input = files;
      }
      case "zeroFloor" -> basis = basis(0L);
      case "relative" ->
          input =
              new ScoreTrustVerification.InputFiles(
                  Path.of("relative.json"), files.manifest(), files.snapshotBundle(), null);
      default -> input = null;
    }
    var reads = new AtomicInteger();
    var component =
        new ScoreTrustVerification(
            repository(),
            (path, root) -> {
              reads.incrementAndGet();
              throw new IOException("secret");
            });
    assertStatus(component.verify(basis, input), ScoreTrustVerification.Status.TRUST_BASIS_MISSING);
    assertThat(reads).hasValue(0);
  }

  @Test
  void validBindingNeverGrantsApprovalOrClaimsUnprovidedHistory() throws Exception {
    var before = Files.readAllBytes(files.trustRecord());
    var result = verify();
    assertStatus(result, ScoreTrustVerification.Status.BINDING_VERIFIED);
    assertThat(result.historyCheck()).isEqualTo(ScoreTrustVerification.HistoryCheck.NOT_PROVIDED);
    assertThat(Files.readAllBytes(files.trustRecord())).isEqualTo(before);
    try (var entries = Files.list(temporary)) {
      assertThat(entries.count()).isEqualTo(3);
    }
  }

  @Test
  void revisionFloorIsIndependentButDoesNotClaimFullHistoryProtection() {
    var result = verification.verify(basis(2L), files);
    assertStatus(result, ScoreTrustVerification.Status.BINDING_VERIFIED);
    assertThat(result.historyCheck())
        .isEqualTo(ScoreTrustVerification.HistoryCheck.REVISION_FLOOR_ONLY);
    assertStatus(
        verification.verify(basis(3L), files),
        ScoreTrustVerification.Status.REVOCATION_OR_REVISION_FAILURE);
  }

  @ParameterizedTest
  @ValueSource(strings = {"current", "previous"})
  void expectedHashMustComeFromTheCallerAndMatch(String which) throws Exception {
    if (which.equals("previous")) previous(trust());
    var basis =
        which.equals("current")
            ? new ScoreTrustVerification.TrustBasis("0".repeat(64), previousExpected, null)
            : new ScoreTrustVerification.TrustBasis(expected, "0".repeat(64), null);
    assertStatus(
        verification.verify(basis, files), ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "missingTrust",
        "corruptTrust",
        "missingManifest",
        "corruptManifest",
        "missingBundle",
        "corruptBundle",
        "emptyBundle"
      })
  void missingOrCorruptFilesNeverProduceAPartialSuccess(String mutation) throws Exception {
    Path target =
        mutation.contains("Trust")
            ? files.trustRecord()
            : mutation.contains("Manifest") ? files.manifest() : files.snapshotBundle();
    if (mutation.startsWith("missing")) Files.delete(target);
    else
      Files.writeString(
          target, mutation.startsWith("empty") ? "" : "private-json-password-sentinel");
    var status =
        mutation.equals("corruptManifest") || mutation.equals("corruptBundle")
            ? ScoreTrustVerification.Status.BINDING_FAILURE
            : ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE;
    assertStatus(verify(), status);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "INACTIVE",
        "REVOKED",
        "RELEASE",
        "POLICY_APPROVAL",
        "SOURCE_VERIFICATION",
        "COVERAGE_APPROVAL"
      })
  void rejectsInactiveReleasesAndRevokedReleaseOrEvidence(String mutation) throws Exception {
    var tree = tree(trust());
    if (mutation.equals("INACTIVE") || mutation.equals("REVOKED"))
      tree.put("releaseStatus", mutation);
    if (!mutation.equals("INACTIVE")) {
      String target = mutation.equals("REVOKED") ? "RELEASE" : mutation;
      String id =
          switch (target) {
            case "RELEASE" -> "synthetic-release-2";
            case "POLICY_APPROVAL" -> "synthetic-policy-1";
            case "SOURCE_VERIFICATION" -> "synthetic-source-1";
            default -> "synthetic-coverage-1";
          };
      revoke(tree, target, id);
    }
    writeTrust(codec.decode(json.writeValueAsBytes(tree)));
    assertStatus(verify(), ScoreTrustVerification.Status.REVOCATION_OR_REVISION_FAILURE);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "rollback",
        "sameRevisionChanged",
        "removedRevocation",
        "revokedReleaseReuse",
        "sameReleaseRebound"
      })
  void independentlyPinnedHistoryRejectsRegressionAndRebinding(String mutation) throws Exception {
    var old = tree(trust());
    switch (mutation) {
      case "rollback" -> old.put("revision", 3);
      case "sameRevisionChanged" -> old.put("activeReleaseId", "synthetic-other");
      case "removedRevocation" -> {
        old.put("revision", 1);
        revoke(old, "RELEASE", "synthetic-retired");
      }
      case "revokedReleaseReuse" -> {
        old.put("revision", 1).put("releaseStatus", "REVOKED");
        revoke(old, "RELEASE", "synthetic-release-2");
      }
      default -> old.put("revision", 1).put("manifestSha256", "0".repeat(64));
    }
    previous(codec.decode(json.writeValueAsBytes(old)));
    assertStatus(verify(), ScoreTrustVerification.Status.REVOCATION_OR_REVISION_FAILURE);
  }

  @Test
  void newActiveReleaseRequiresANewerRevisionAndRetainedRevocations() throws Exception {
    var old =
        tree(trust())
            .put("revision", 1)
            .put("activeReleaseId", "synthetic-old")
            .put("releaseStatus", "REVOKED");
    revoke(old, "RELEASE", "synthetic-old");
    previous(codec.decode(json.writeValueAsBytes(old)));
    var current = tree(trust());
    revoke(current, "RELEASE", "synthetic-old");
    writeTrust(codec.decode(json.writeValueAsBytes(current)));
    var result = verify();
    assertStatus(result, ScoreTrustVerification.Status.BINDING_VERIFIED);
    assertThat(result.historyCheck()).isEqualTo(ScoreTrustVerification.HistoryCheck.CHECKED);
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
  void changedApprovalReferencesOrManifestBindingFail(String field) throws Exception {
    writeTrust(
        codec.decode(
            json.writeValueAsBytes(
                tree(trust())
                    .put(
                        field,
                        field.equals("manifestSha256") ? "0".repeat(64) : "synthetic-other"))));
    assertStatus(verify(), ScoreTrustVerification.Status.BINDING_FAILURE);
  }

  @ParameterizedTest
  @ValueSource(strings = {"manifest", "raw", "source", "exclusion"})
  void changesToManifestAndValidSnapshotInputsFailBinding(String mutation) throws Exception {
    if (mutation.equals("manifest")) {
      var tree = (ObjectNode) json.readTree(Files.readAllBytes(files.manifest()));
      ((ObjectNode) tree.get("policyApproval")).put("reviewer", "private-reviewer-sentinel");
      Files.write(files.manifest(), json.writeValueAsBytes(tree));
    } else {
      var bundle = ScoreSnapshotToolTests.fixture();
      var input = bundle.dong().payload().input();
      var rows = new ArrayList<>(input.regions());
      var r = rows.getFirst();
      var value =
          switch (mutation) {
            case "raw" -> new ScoreInputSnapshot.RawValue("99999", r.sales().source());
            case "source" ->
                new ScoreInputSnapshot.RawValue(
                    r.sales().raw(),
                    new ScoreInputSnapshot.RowSource(
                        true,
                        new java.util.UUID(0, 99),
                        ScoreSnapshotTests.batch(99, "SEOUL_DONG_SALES_STAT"),
                        true));
            default -> new ScoreInputSnapshot.RawValue(null, r.sales().source());
          };
      rows.set(
          0,
          new ScoreInputSnapshot.RegionInput(
              r.regionCode(),
              r.regionName(),
              r.districtCode(),
              r.districtName(),
              value,
              r.footTraffic(),
              r.storeCount(),
              r.closureRate()));
      var changed =
          new ScoreSnapshotBundle(
              bundle.district(),
              ScoreSnapshotToolTests.capture(
                  new ScoreInputSnapshot(
                      input.unit(),
                      input.quarterCode(),
                      input.industryCode(),
                      input.boundary(),
                      true,
                      input.readiness(),
                      rows)));
      ScoreSnapshotBundle.decode(changed.encode());
      Files.write(files.snapshotBundle(), changed.encode());
    }
    assertStatus(verify(), ScoreTrustVerification.Status.BINDING_FAILURE);
  }

  @ParameterizedTest
  @ValueSource(strings = {"repository", "symlink", "parentLink", "sharedParent", "permission"})
  void rejectsUnsafeFilesAndPermissions(String mutation) throws Exception {
    var input = files;
    switch (mutation) {
      case "repository" ->
          input =
              new ScoreTrustVerification.InputFiles(
                  repository().resolve("AGENTS.md"),
                  files.manifest(),
                  files.snapshotBundle(),
                  null);
      case "symlink" -> {
        Path link = temporary.toRealPath().resolve("link.json");
        Files.createSymbolicLink(link, files.trustRecord());
        input =
            new ScoreTrustVerification.InputFiles(
                link, files.manifest(), files.snapshotBundle(), null);
      }
      case "parentLink" -> {
        Path link = temporary.toRealPath().resolve("alias");
        Files.createSymbolicLink(link, temporary.toRealPath());
        input =
            new ScoreTrustVerification.InputFiles(
                link.resolve("trust.json"), files.manifest(), files.snapshotBundle(), null);
      }
      case "sharedParent" ->
          Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rwxr-xr-x"));
      default ->
          Files.setPosixFilePermissions(
              files.trustRecord(), PosixFilePermissions.fromString("---------"));
    }
    try {
      assertStatus(
          verification.verify(basis(null), input),
          ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE);
    } finally {
      Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rwx------"));
      Files.setPosixFilePermissions(
          files.trustRecord(), PosixFilePermissions.fromString("rw-------"));
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"trust", "manifest", "bundle", "previous"})
  void refusesChangesBetweenFileReads(String which) throws Exception {
    if (which.equals("previous")) previous(trust());
    Path selected =
        switch (which) {
          case "trust" -> files.trustRecord();
          case "manifest" -> files.manifest();
          case "bundle" -> files.snapshotBundle();
          default -> files.previousRecord();
        };
    var reads = new AtomicInteger();
    var component =
        new ScoreTrustVerification(
            repository(),
            (path, root) -> {
              if (path.equals(selected) && reads.incrementAndGet() == 2)
                Files.writeString(path, "changed-private-json-password-sentinel");
              return ScoreSnapshotFiles.read(path, root);
            });
    var result = component.verify(basis(null), files);
    assertStatus(result, ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE);
    assertThat(result.phase()).isEqualTo(ScoreTrustVerification.Phase.FILE_STABILITY);
  }

  @Test
  void detectsAChangeDuringTheActualFileChannelRead() throws Exception {
    var mutations = new AtomicInteger();
    var component =
        new ScoreTrustVerification(
            repository(),
            (path, root) ->
                ScoreSnapshotFiles.read(
                    path,
                    root,
                    () -> {
                      if (path.equals(files.trustRecord()) && mutations.incrementAndGet() == 1) {
                        try {
                          Files.writeString(path, "changed-during-open-channel-private-sentinel");
                        } catch (IOException failure) {
                          throw new java.io.UncheckedIOException(failure);
                        }
                      }
                    }));
    var result = component.verify(basis(null), files);
    assertStatus(result, ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE);
    assertThat(result.phase()).isEqualTo(ScoreTrustVerification.Phase.INPUT_FILES);
    assertThat(mutations).hasValue(1);
  }

  @Test
  void neverFallsBackToACachedSuccessOrLeaksSensitiveReadErrors() throws Exception {
    assertStatus(verify(), ScoreTrustVerification.Status.BINDING_VERIFIED);
    Files.delete(files.trustRecord());
    assertStatus(verify(), ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE);
    var component =
        new ScoreTrustVerification(
            repository(),
            (path, root) -> {
              throw new AccessDeniedException(
                  path.toString(), "password-sentinel", "jdbc:private-sentinel");
            });
    assertStatus(
        component.verify(basis(null), files),
        ScoreTrustVerification.Status.FILE_OR_INTEGRITY_FAILURE);
  }

  private ScoreTrustVerification.Result verify() {
    return verification.verify(basis(null), files);
  }

  private ScoreTrustVerification.TrustBasis basis(Long minimum) {
    return new ScoreTrustVerification.TrustBasis(expected, previousExpected, minimum);
  }

  private void assertStatus(
      ScoreTrustVerification.Result result, ScoreTrustVerification.Status status) {
    assertThat(result.status()).isEqualTo(status);
    assertThat(result.publicationState())
        .isEqualTo(InternalScoreResult.PublicationState.NOT_APPROVED);
    assertThat(result.sourceTrust())
        .isEqualTo(ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED);
    assertThat(result.r03Complete()).isFalse();
    assertThat(result.toString())
        .doesNotContain(
            temporary.toString(), "sentinel", "synthetic-reviewer", "example.invalid", "Exception");
  }

  private ObjectNode tree(ScoreTrustRecord record) {
    return (ObjectNode) json.readTree(codec.encode(record));
  }

  private ScoreTrustRecord trust() throws Exception {
    return codec.decode(Files.readAllBytes(files.trustRecord()));
  }

  private void writeTrust(ScoreTrustRecord record) throws Exception {
    Files.write(files.trustRecord(), codec.encode(record));
    expected = codec.sha256(record);
  }

  private void previous(ScoreTrustRecord record) throws Exception {
    Path path = temporary.toRealPath().resolve("previous.json");
    Files.write(path, codec.encode(record));
    previousExpected = codec.sha256(record);
    files =
        new ScoreTrustVerification.InputFiles(
            files.trustRecord(), files.manifest(), files.snapshotBundle(), path);
  }

  private static void revoke(ObjectNode tree, String target, String id) {
    tree.withArray("revocations")
        .addObject()
        .put("target", target)
        .put("targetId", id)
        .put("reason", "private-revocation-sentinel")
        .put("revokedAt", "2026-11-02T00:00:00Z");
  }

  private static Path repository() throws IOException {
    return Path.of("..").toRealPath();
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
