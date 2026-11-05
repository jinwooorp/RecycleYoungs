package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.file.AccessDeniedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** 합성 파일은 JUnit 소유 디렉터리에만 둔다. 실제 승인·DB·원천 파일은 사용하지 않는다. */
class ScoreTrustPreflightTests {
  @TempDir Path temporary;
  private final ScoreTrustRecordCodec codec = new ScoreTrustRecordCodec();
  private final ScoreApprovalManifestCodec manifestCodec = new ScoreApprovalManifestCodec();
  private final JsonMapper json = JsonMapper.builder().build();
  private final ByteArrayOutputStream output = new ByteArrayOutputStream();

  @ParameterizedTest
  @ValueSource(strings = {"", "0", "true", " 1", "1 "})
  void requiresExactOptInBeforeAnyFileAccess(String enabled) {
    var reads = new AtomicInteger();
    int code =
        run(
            Map.of("SCORE_TRUST_PREFLIGHT_ENABLED", enabled),
            (path, root) -> {
              reads.incrementAndGet();
              throw new AccessDeniedException("secret-path");
            });
    assertThat(code).isEqualTo(2);
    assertThat(reads).hasValue(0);
    assertThat(output.toString()).contains("NOT_EXECUTED").doesNotContain("secret-path");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "SCORE_TRUST_RECORD_PATH",
        "SCORE_APPROVAL_MANIFEST_PATH",
        "SCORE_SNAPSHOT_INPUT_PATH",
        "SCORE_TRUST_RECORD_EXPECTED_SHA256",
        "SCORE_TRUST_PREVIOUS_RECORD_PATH",
        "SCORE_TRUST_PREVIOUS_EXPECTED_SHA256"
      })
  void missingOrBlankSettingsIncludingHalfAPreviousPairNeverReadFiles(String key) {
    for (boolean blank : List.of(false, true)) {
      var env = configuration();
      env.put("SCORE_TRUST_PREVIOUS_RECORD_PATH", "/protected/previous.json");
      env.put("SCORE_TRUST_PREVIOUS_EXPECTED_SHA256", "b".repeat(64));
      if (blank) env.put(key, " ");
      else env.remove(key);
      assertConfigurationFailureWithoutReads(env);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"short", "A", "newline", "relative", "unnormalized"})
  void malformedExpectedHashesOrPathsFailBeforeReads(String mutation) {
    var env = configuration();
    switch (mutation) {
      case "short" -> env.put("SCORE_TRUST_RECORD_EXPECTED_SHA256", "abc");
      case "A" -> env.put("SCORE_TRUST_RECORD_EXPECTED_SHA256", "A".repeat(64));
      case "newline" -> env.put("SCORE_TRUST_RECORD_EXPECTED_SHA256", "a".repeat(64) + "\n");
      case "relative" -> env.put("SCORE_TRUST_RECORD_PATH", "relative.json");
      default -> env.put("SCORE_TRUST_RECORD_PATH", "/protected/../secret.json");
    }
    assertConfigurationFailureWithoutReads(env);
  }

  @Test
  void verifiesSyntheticFilesWithoutGrantingApprovalOrClaimingUncheckedHistory() throws Exception {
    var env = inputs();
    var before = contents(env);
    assertThat(run(env)).isZero();
    assertThat(output.toString())
        .contains(
            "PREFLIGHT_VERIFIED binding=TRUST_BINDING_VERIFIED",
            "externalTrustPin=MATCHED revisionCheck=NOT_PROVIDED",
            "sourceComparabilityApproval=NOT_ESTABLISHED publicationApproval=NOT_APPROVED",
            "publication=NOT_APPROVED sourceTrust=NOT_ESTABLISHED R03_COMPLETE=false")
        .doesNotContain(temporary.toString(), "synthetic-reviewer", "example.invalid", "합성");
    assertThat(contents(env)).containsExactlyEntriesOf(before);
    try (var files = Files.list(temporary)) {
      assertThat(files.count()).isEqualTo(3);
    }
  }

  @Test
  void acceptsCanonicalPinForWhitespaceDifferentJsonOnlyWhenProvidedIndependently()
      throws Exception {
    var env = inputs();
    Path trust = Path.of(env.get("SCORE_TRUST_RECORD_PATH"));
    Files.writeString(trust, "\n " + Files.readString(trust) + " \n");
    assertThat(run(env)).isZero();
    env.remove("SCORE_TRUST_RECORD_EXPECTED_SHA256");
    output.reset();
    assertThat(run(env)).isEqualTo(2);
    assertThat(output.toString()).contains("CONFIGURATION").doesNotContain("PREFLIGHT_VERIFIED");
  }

  @ParameterizedTest
  @CsvSource({
    "trust,missing",
    "trust,broken",
    "manifest,missing",
    "manifest,broken",
    "bundle,missing",
    "bundle,broken",
    "bundle,empty"
  })
  void rejectsMissingEmptyOrDamagedFilesWithoutLeakingContents(String file, String mutation)
      throws Exception {
    var env = inputs();
    Path target = file(env, file);
    if (mutation.equals("missing")) Files.delete(target);
    else
      Files.writeString(target, mutation.equals("empty") ? "" : "{private-json-password-sentinel");
    assertFailure(env, null);
  }

  @ParameterizedTest
  @ValueSource(strings = {"trust", "previous"})
  void rejectsAnIndependentHashMismatch(String which) throws Exception {
    var env = inputs();
    if (which.equals("previous")) previous(env, trust(env));
    env.put(
        which.equals("trust")
            ? "SCORE_TRUST_RECORD_EXPECTED_SHA256"
            : "SCORE_TRUST_PREVIOUS_EXPECTED_SHA256",
        "0".repeat(64));
    assertFailure(env, which.equals("trust") ? "TRUST_PIN" : "PREVIOUS_TRUST_PIN");
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
  void rejectsInactiveOrRevokedBindingsEvenWithAMatchingTrustPin(String mutation) throws Exception {
    var env = inputs();
    ObjectNode tree = tree(trust(env));
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
      tree.withArray("revocations")
          .addObject()
          .put("target", target)
          .put("targetId", id)
          .put("reason", "private-revocation-sentinel")
          .put("revokedAt", "2026-11-02T00:00:00Z");
    }
    writeTrust(env, codec.decode(json.writeValueAsBytes(tree)));
    assertFailure(env, "BINDING");
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "policyApprovalId",
        "sourceVerificationId",
        "coverageApprovalId",
        "policyVersion",
        "quarterCode",
        "industryCode",
        "algorithmVersion",
        "manifestSha256"
      })
  void rejectsIdScopeAndVersionMismatches(String field) throws Exception {
    var env = inputs();
    ObjectNode tree = tree(trust(env));
    tree.put(field, field.equals("manifestSha256") ? "0".repeat(64) : "synthetic-mismatch");
    // 지원 범위에 맞지 않는 분기·업종·알고리즘은 기존 Codec에서 먼저 거부한다.
    if (List.of("quarterCode", "industryCode", "algorithmVersion").contains(field)) {
      Files.write(file(env, "trust"), json.writeValueAsBytes(tree));
      assertFailure(env, "TRUST_PIN");
    } else {
      writeTrust(env, codec.decode(json.writeValueAsBytes(tree)));
      assertFailure(env, "BINDING");
    }
  }

  @Test
  void checksHistoryOnlyAgainstASeparatelyPinnedPreviousRecord() throws Exception {
    var env = inputs();
    previous(env, codec.decode(json.writeValueAsBytes(tree(trust(env)).put("revision", 1))));
    assertThat(run(env)).isZero();
    assertThat(output.toString()).contains("revisionCheck=CHECKED");
    // 독립적으로 알려진 더 높은 리비전이 있으면 현재 정상 결합도 거부한다.
    previous(env, codec.decode(json.writeValueAsBytes(tree(trust(env)).put("revision", 3))));
    output.reset();
    assertFailure(env, "BINDING");
  }

  @ParameterizedTest
  @ValueSource(strings = {"missing", "broken", "sameRevisionChanged", "removedRevocation"})
  void neverSilentlyDropsAFailedOrContradictoryHistoryBaseline(String mutation) throws Exception {
    var env = inputs();
    var old = tree(trust(env));
    if (mutation.equals("sameRevisionChanged"))
      old.put("activeReleaseId", "synthetic-other-release");
    if (mutation.equals("removedRevocation")) {
      old.put("revision", 1);
      old.withArray("revocations")
          .addObject()
          .put("target", "RELEASE")
          .put("targetId", "synthetic-retired")
          .put("reason", "private-revocation-sentinel")
          .put("revokedAt", "2026-11-02T00:00:00Z");
    }
    previous(env, codec.decode(json.writeValueAsBytes(old)));
    Path path = Path.of(env.get("SCORE_TRUST_PREVIOUS_RECORD_PATH"));
    if (mutation.equals("missing")) Files.delete(path);
    if (mutation.equals("broken")) Files.writeString(path, "private-json-password-sentinel");
    assertFailure(env, null);
  }

  @ParameterizedTest
  @ValueSource(strings = {"raw", "source", "exclusion"})
  void rejectsChangedInputsEvenWhenTheChangedSnapshotIsInternallyValid(String mutation)
      throws Exception {
    var env = inputs();
    var original = ScoreSnapshotToolTests.fixture();
    var input = original.dong().payload().input();
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
            original.district(),
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
    Files.write(file(env, "bundle"), changed.encode());
    assertFailure(env, "BINDING");
  }

  @ParameterizedTest
  @ValueSource(strings = {"repository", "symlink", "parentLink", "sharedParent", "permission"})
  void rejectsUnsafePathsAndRealPermissionErrors(String mutation) throws Exception {
    var env = inputs();
    Path target = file(env, "trust");
    switch (mutation) {
      case "repository" ->
          env.put("SCORE_TRUST_RECORD_PATH", repository().resolve("AGENTS.md").toString());
      case "symlink" -> {
        Path link = temporary.toRealPath().resolve("link.json");
        Files.createSymbolicLink(link, target);
        env.put("SCORE_TRUST_RECORD_PATH", link.toString());
      }
      case "parentLink" -> {
        Path link = temporary.toRealPath().resolve("alias");
        Files.createSymbolicLink(link, temporary.toRealPath());
        env.put("SCORE_TRUST_RECORD_PATH", link.resolve(target.getFileName()).toString());
      }
      case "sharedParent" ->
          Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rwxr-xr-x"));
      default ->
          Files.setPosixFilePermissions(target, PosixFilePermissions.fromString("---------"));
    }
    try {
      assertFailure(env, "INPUT_FILES");
    } finally {
      Files.setPosixFilePermissions(temporary, PosixFilePermissions.fromString("rwx------"));
      Files.setPosixFilePermissions(target, PosixFilePermissions.fromString("rw-------"));
    }
  }

  @Test
  void neverPrintsSensitiveReaderExceptionsOrUsesACachedSuccess() throws Exception {
    var env = inputs();
    assertThat(run(env)).isZero();
    output.reset();
    assertThat(
            run(
                env,
                (path, root) -> {
                  throw new AccessDeniedException(
                      path.toString(), "private-json-password-sentinel", "jdbc:sentinel");
                }))
        .isEqualTo(2);
    assertThat(output.toString())
        .contains("INPUT_FILES")
        .doesNotContain("PREFLIGHT_VERIFIED", temporary.toString(), "sentinel", "Exception");
  }

  @ParameterizedTest
  @ValueSource(strings = {"trust", "manifest", "bundle", "previous"})
  void detectsFileChangesAfterTheFirstReadBeforeReturningSuccess(String which) throws Exception {
    var env = inputs();
    if (which.equals("previous")) previous(env, trust(env));
    Path changed =
        which.equals("previous")
            ? Path.of(env.get("SCORE_TRUST_PREVIOUS_RECORD_PATH"))
            : file(env, which);
    var count = new AtomicInteger();
    assertThat(
            run(
                env,
                (path, root) -> {
                  if (path.equals(changed) && count.incrementAndGet() == 2)
                    Files.writeString(path, "changed-private-json-password-sentinel");
                  return ScoreSnapshotFiles.read(path, root);
                }))
        .isEqualTo(2);
    assertThat(output.toString())
        .contains("FILE_STABILITY")
        .doesNotContain("PREFLIGHT_VERIFIED", temporary.toString(), "sentinel");
  }

  private void assertConfigurationFailureWithoutReads(Map<String, String> env) {
    var reads = new AtomicInteger();
    assertThat(
            run(
                env,
                (path, root) -> {
                  reads.incrementAndGet();
                  return new byte[0];
                }))
        .isEqualTo(2);
    assertThat(reads).hasValue(0);
    assertThat(output.toString()).contains("CONFIGURATION").doesNotContain("PREFLIGHT_VERIFIED");
  }

  private void assertFailure(Map<String, String> env, String phase) throws Exception {
    assertThat(run(env)).isEqualTo(2);
    assertThat(output.toString())
        .contains("NOT_COMPLETED", "publication=NOT_APPROVED", "sourceTrust=NOT_ESTABLISHED")
        .doesNotContain(
            "PREFLIGHT_VERIFIED",
            temporary.toString(),
            "sentinel",
            "synthetic-reviewer",
            "example.invalid");
    if (phase != null) assertThat(output.toString()).contains("phase=" + phase);
  }

  private int run(Map<String, String> env) throws Exception {
    return ScoreTrustPreflightMain.execute(env, repository(), new PrintStream(output));
  }

  private int run(Map<String, String> env, ScoreTrustPreflightMain.Reader reader) {
    return ScoreTrustPreflightMain.execute(
        env, Path.of("..").toAbsolutePath().normalize(), new PrintStream(output), reader);
  }

  private static Path repository() throws java.io.IOException {
    return Path.of("..").toRealPath();
  }

  private HashMap<String, String> configuration() {
    return new HashMap<>(
        Map.of(
            "SCORE_TRUST_PREFLIGHT_ENABLED",
            "1",
            "SCORE_TRUST_RECORD_PATH",
            "/protected/trust.json",
            "SCORE_APPROVAL_MANIFEST_PATH",
            "/protected/manifest.json",
            "SCORE_SNAPSHOT_INPUT_PATH",
            "/protected/bundle.json",
            "SCORE_TRUST_RECORD_EXPECTED_SHA256",
            "a".repeat(64)));
  }

  private Map<String, String> inputs() throws Exception {
    Path directory = temporary.toRealPath();
    Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
    var env = configuration();
    env.put("SCORE_TRUST_RECORD_PATH", directory.resolve("trust.json").toString());
    env.put("SCORE_APPROVAL_MANIFEST_PATH", directory.resolve("manifest.json").toString());
    env.put("SCORE_SNAPSHOT_INPUT_PATH", directory.resolve("bundle.json").toString());
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
    Files.write(file(env, "bundle"), bundle.encode());
    Files.write(file(env, "manifest"), manifestCodec.encode(manifest));
    writeTrust(
        env,
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
    return env;
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

  private Path file(Map<String, String> env, String which) {
    return Path.of(
        env.get(
            switch (which) {
              case "trust" -> "SCORE_TRUST_RECORD_PATH";
              case "manifest" -> "SCORE_APPROVAL_MANIFEST_PATH";
              default -> "SCORE_SNAPSHOT_INPUT_PATH";
            }));
  }

  private ScoreTrustRecord trust(Map<String, String> env) throws Exception {
    return codec.decode(Files.readAllBytes(file(env, "trust")));
  }

  private ObjectNode tree(ScoreTrustRecord record) {
    return (ObjectNode) json.readTree(codec.encode(record));
  }

  private void writeTrust(Map<String, String> env, ScoreTrustRecord record) throws Exception {
    Files.write(file(env, "trust"), codec.encode(record));
    // 테스트만 합성 기대값을 만든다. CLI는 외부 제공 기대값을 필수로 받고 이 생성 경로를 갖지 않는다.
    env.put("SCORE_TRUST_RECORD_EXPECTED_SHA256", codec.sha256(record));
  }

  private void previous(Map<String, String> env, ScoreTrustRecord record) throws Exception {
    Path path = temporary.toRealPath().resolve("previous.json");
    Files.write(path, codec.encode(record));
    env.put("SCORE_TRUST_PREVIOUS_RECORD_PATH", path.toString());
    env.put("SCORE_TRUST_PREVIOUS_EXPECTED_SHA256", codec.sha256(record));
  }

  private Map<String, String> contents(Map<String, String> env) throws Exception {
    var values = new HashMap<String, String>();
    for (String which : List.of("trust", "manifest", "bundle"))
      values.put(which, Files.readString(file(env, which)));
    return values;
  }
}
