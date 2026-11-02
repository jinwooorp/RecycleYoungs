package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 도구의 파일·설정 경계는 합성 데이터와 JUnit 소유 임시 디렉터리에서만 검증한다. */
class ScoreSnapshotToolTests {
  @TempDir Path temporary;

  @Test
  void disabledExportNeverConnectsOrCreatesFiles() throws Exception {
    Path directory = privateDirectory();
    var output = new ByteArrayOutputStream();
    int exit =
        ScoreSnapshotExportMain.execute(
            Map.of(
                "DB_JDBC_URL",
                "sentinel-jdbc",
                "DB_PASSWORD",
                "sentinel-password",
                "SCORE_SNAPSHOT_OUTPUT_PATH",
                directory.resolve("unused.json").toString()),
            repository(),
            new PrintStream(output));
    assertThat(exit).isEqualTo(2);
    assertThat(output.toString())
        .contains("NOT_EXECUTED")
        .doesNotContain("sentinel", directory.toString());
    try (var files = Files.list(directory)) {
      assertThat(files.count()).isZero();
    }
  }

  @Test
  void enabledExportRejectsUnsafeConnectionOptionsBeforeConnecting() throws Exception {
    Path directory = privateDirectory();
    var out = new ByteArrayOutputStream();
    assertThat(
            ScoreSnapshotExportMain.execute(
                Map.of(
                    "SCORE_SNAPSHOT_EXPORT_ENABLED",
                    "1",
                    "SCORE_SNAPSHOT_OUTPUT_PATH",
                    directory.resolve("unused.json").toString(),
                    "DB_JDBC_URL",
                    "jdbc:postgresql://invalid.invalid/test?options=sentinel",
                    "DB_USER",
                    "sentinel-user",
                    "DB_PASSWORD",
                    "sentinel-password"),
                repository(),
                new PrintStream(out)))
        .isEqualTo(2);
    assertThat(out.toString())
        .contains("phase=CONFIGURATION")
        .doesNotContain("sentinel", directory.toString(), "jdbc:");
    try (var files = Files.list(directory)) {
      assertThat(files.count()).isZero();
    }
  }

  @Test
  void refusesAnUnprotectedWritableAncestorEvenWhenTheImmediateParentIsPrivate() throws Exception {
    Path base = privateDirectory();
    Path shared = Files.createDirectory(base.resolve("shared"));
    Files.setPosixFilePermissions(shared, PosixFilePermissions.fromString("rwxrwxrwx"));
    Path parent =
        Files.createDirectory(
            shared.resolve("private"),
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
    assertThatThrownBy(
            () -> ScoreSnapshotFiles.prepareOutput(parent.resolve("forbidden.json"), repository()))
        .isInstanceOf(Exception.class);
    try (var files = Files.list(parent)) {
      assertThat(files.count()).isZero();
    }
  }

  @Test
  void exportsOnePrivateCompleteFileAndVerifiesOfflineWithIndependentPins() throws Exception {
    Path target = privateDirectory().resolve("synthetic.score-snapshot.json");
    var bundle = fixture();
    byte[] bytes = bundle.encode();
    ScoreSnapshotFiles.saveNew(ScoreSnapshotFiles.prepareOutput(target, repository()), bytes);
    assertThat(Files.getPosixFilePermissions(target))
        .isEqualTo(PosixFilePermissions.fromString("r--------"));
    assertThat(Files.readAllBytes(target)).isEqualTo(bytes);
    var buffer = new ByteArrayOutputStream();
    assertThat(
            ScoreSnapshotVerifyMain.execute(
                Map.of(
                    "SCORE_SNAPSHOT_INPUT_PATH",
                    target.toString(),
                    "SCORE_SNAPSHOT_EXPECTED_DISTRICT_ID",
                    bundle.district().inputSnapshotId(),
                    "SCORE_SNAPSHOT_EXPECTED_DONG_ID",
                    bundle.dong().inputSnapshotId(),
                    "SCORE_SNAPSHOT_EXPECTED_FILE_SHA256",
                    ScoreSnapshotCodec.sha256(bytes),
                    "DB_JDBC_URL",
                    "never-read-sentinel"),
                repository(),
                new PrintStream(buffer)))
        .isZero();
    assertThat(buffer.toString())
        .contains(
            "VERIFIED",
            "districtBoundary=3",
            "dongBoundary=3",
            "externalPins=3",
            "NOT_APPROVED",
            "R03_COMPLETE=false")
        .doesNotContain("never-read-sentinel", target.toString(), "합성", "monthly_sales_amount");
    try (var files = Files.list(target.getParent())) {
      assertThat(files.count()).isEqualTo(1);
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"raw", "source", "hash", "result", "duplicate", "version", "missing"})
  void refusesCorruptOrIncompleteBundles(String change) {
    String json = new String(fixture().encode(), StandardCharsets.UTF_8);
    json =
        switch (change) {
          case "raw" -> json.replaceFirst("\"raw\":\"1000\"", "\"raw\":\"1001\"");
          case "source" -> json.replaceFirst("synthetic-v1", "changed-source");
          case "hash" ->
              json.replaceFirst(
                  "\"inputSnapshotId\":\"[a-f0-9]{64}\"",
                  "\"inputSnapshotId\":\"" + "0".repeat(64) + "\"");
          case "result" -> json.replaceFirst("\"numerator\":\"40\"", "\"numerator\":\"41\"");
          case "duplicate" -> json.replaceFirst("\\{", "{\"bundleSchemaVersion\":\"duplicate\",");
          case "version" -> json.replace("score-snapshot-bundle-v1", "unsupported-bundle");
          default ->
              "{\"bundleSchemaVersion\":\"score-snapshot-bundle-v1\",\"district\":"
                  + new String(
                      new ScoreSnapshotCodec().encode(fixture().district()), StandardCharsets.UTF_8)
                  + "}";
        };
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    assertThatThrownBy(() -> ScoreSnapshotBundle.decode(bytes))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void refusesDifferentBoundaryVersionsAndSwappedUnits() {
    var valid = fixture();
    var input = valid.dong().payload().input();
    var changed =
        new ScoreInputSnapshot(
            input.unit(),
            input.quarterCode(),
            input.industryCode(),
            ScoreSnapshotTests.batch(99, "SEOUL_DONG_BOUNDARY"),
            true,
            input.readiness(),
            input.regions());
    var other = capture(changed);
    assertThatThrownBy(() -> new ScoreSnapshotBundle(valid.district(), other))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ScoreSnapshotBundle(valid.dong(), valid.district()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {"file", "symlink", "parentLink", "repository", "relative", "sharedParent"})
  void refusesOverwriteSymlinkRepositoryAndUnsafeOutputPaths(String kind) throws Exception {
    Path directory = privateDirectory();
    Path target = directory.resolve("target.json");
    Path sentinel = directory.resolve("existing.json");
    Files.writeString(sentinel, "sentinel-original");
    switch (kind) {
      case "file" -> target = sentinel;
      case "symlink" -> Files.createSymbolicLink(target, sentinel);
      case "parentLink" -> {
        Path link = directory.resolve("alias");
        Files.createSymbolicLink(link, directory);
        target = link.resolve("new.json");
      }
      case "repository" -> target = repository().resolve("forbidden.score-snapshot.json");
      case "relative" -> target = Path.of("relative.score-snapshot.json");
      default ->
          Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwxr-xr-x"));
    }
    Path selected = target;
    assertThatThrownBy(() -> ScoreSnapshotFiles.prepareOutput(selected, repository()))
        .isInstanceOf(Exception.class);
    assertThat(Files.readString(sentinel)).isEqualTo("sentinel-original");
  }

  @Test
  void aRacingNewTargetIsNotOverwrittenAndOwnStageIsCleaned() throws Exception {
    Path target = privateDirectory().resolve("race.json");
    var prepared = ScoreSnapshotFiles.prepareOutput(target, repository());
    Files.writeString(target, "created-after-preflight");
    assertThatThrownBy(() -> ScoreSnapshotFiles.saveNew(prepared, fixture().encode()))
        .isInstanceOf(Exception.class);
    assertThat(Files.readString(target)).isEqualTo("created-after-preflight");
    try (var files = Files.list(target.getParent())) {
      assertThat(files.count()).isEqualTo(1);
    }
  }

  @Test
  void publishFailureRemovesOnlyItsOwnStage() throws Exception {
    Path directory = privateDirectory();
    Path target = directory.resolve("x".repeat(300) + ".json");
    assertThatThrownBy(
            () ->
                ScoreSnapshotFiles.saveNew(
                    ScoreSnapshotFiles.prepareOutput(target, repository()), fixture().encode()))
        .isInstanceOf(Exception.class);
    try (var files = Files.list(directory)) {
      assertThat(files.count()).isZero();
    }
  }

  @Test
  void refusesParentReplacementAfterPreflightWithoutWritingThroughTheLink() throws Exception {
    Path base = privateDirectory();
    Path parent =
        Files.createDirectory(
            base.resolve("private"),
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
    Path alternate =
        Files.createDirectory(
            base.resolve("alternate"),
            PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rwx------")));
    var prepared = ScoreSnapshotFiles.prepareOutput(parent.resolve("unsafe.json"), repository());
    Path moved = Files.move(parent, base.resolve("moved"));
    Files.createSymbolicLink(parent, alternate);
    assertThatThrownBy(() -> ScoreSnapshotFiles.saveNew(prepared, fixture().encode()))
        .isInstanceOf(Exception.class);
    try (var a = Files.list(alternate);
        var b = Files.list(moved)) {
      assertThat(a.count()).isZero();
      assertThat(b.count()).isZero();
    }
  }

  @Test
  void verifiesOnlyExplicitFilesAndRejectsExternalHashMismatchWithoutLeakingPaths()
      throws Exception {
    Path target = privateDirectory().resolve("pin.json");
    ScoreSnapshotFiles.saveNew(
        ScoreSnapshotFiles.prepareOutput(target, repository()), fixture().encode());
    var out = new ByteArrayOutputStream();
    assertThat(ScoreSnapshotVerifyMain.execute(Map.of(), repository(), new PrintStream(out)))
        .isEqualTo(2);
    assertThat(
            ScoreSnapshotVerifyMain.execute(
                Map.of(
                    "SCORE_SNAPSHOT_INPUT_PATH",
                    target.toString(),
                    "SCORE_SNAPSHOT_EXPECTED_FILE_SHA256",
                    "0".repeat(64)),
                repository(),
                new PrintStream(out)))
        .isEqualTo(2);
    assertThat(out.toString()).contains("NOT_COMPLETED").doesNotContain(target.toString(), "합성");
  }

  static ScoreSnapshotBundle fixture() {
    return new ScoreSnapshotBundle(
        capture(input(ScoreCalculation.RegionUnit.DISTRICT)),
        capture(input(ScoreCalculation.RegionUnit.DONG)));
  }

  static ScoreInputSnapshot input(ScoreCalculation.RegionUnit unit) {
    var rows = new ArrayList<ScoreInputSnapshot.RegionInput>();
    for (int i = 1; i <= 3; i++) {
      String district = "0000" + i;
      String code = unit == ScoreCalculation.RegionUnit.DISTRICT ? district : district + "001";
      int start = unit == ScoreCalculation.RegionUnit.DISTRICT ? 2 : 5;
      rows.add(
          new ScoreInputSnapshot.RegionInput(
              code,
              unit == ScoreCalculation.RegionUnit.DISTRICT ? "합성구" + i : "합성동" + i,
              district,
              "합성구" + i,
              value("" + (i * 1000), start + 1, "SEOUL_" + unit + "_SALES_STAT"),
              value("" + (i * 100), start + 2, "SEOUL_" + unit + "_FOOT_TRAFFIC_STAT"),
              value("" + (i * 10), start, "SEOUL_" + unit + "_STORE_STAT"),
              value("" + i, start, "SEOUL_" + unit + "_STORE_STAT")));
    }
    return new ScoreInputSnapshot(
        unit,
        "20262",
        "CS100010",
        ScoreSnapshotTests.batch(1, "SEOUL_DONG_BOUNDARY"),
        true,
        new ScoreInputSnapshot.DatasetReadiness(true, true, true),
        rows);
  }

  private static ScoreInputSnapshot.RawValue value(String raw, int id, String dataset) {
    return new ScoreInputSnapshot.RawValue(
        raw,
        new ScoreInputSnapshot.RowSource(
            true, new java.util.UUID(0, id), ScoreSnapshotTests.batch(id, dataset), true));
  }

  static ScoreSnapshotArtifact capture(ScoreInputSnapshot input) {
    return ScoreSnapshotArtifact.capture(
        input,
        input.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList(),
        OffsetDateTime.parse("2026-11-02T00:00:00Z"));
  }

  private Path privateDirectory() throws Exception {
    Path real = temporary.toRealPath();
    Files.setPosixFilePermissions(real, PosixFilePermissions.fromString("rwx------"));
    return real;
  }

  private static Path repository() throws Exception {
    return Path.of("..").toRealPath();
  }
}
