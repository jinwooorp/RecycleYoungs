package kr.ac.recycleyoungs.score;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Map;

/** 독립 기대값과 외부 파일의 결합만 진단한다. DB·웹 서버·실제 승인·파일 쓰기는 사용하지 않는다. */
public final class ScoreTrustPreflightMain {
  private static final String HOLDS =
      "publication=NOT_APPROVED sourceTrust=NOT_ESTABLISHED R03_COMPLETE=false";

  private ScoreTrustPreflightMain() {}

  public static void main(String[] args) {
    int code = 2;
    try {
      if (args.length != 0) throw new IllegalArgumentException();
      // 저장소 경로도 파일을 읽기 전 설정 단계에서만 해석한다. .env·DB 설정은 읽지 않는다.
      code = execute(System.getenv(), repository(), System.out);
    } catch (RuntimeException error) {
      failure(System.out, "CONFIGURATION");
    }
    System.exit(code);
  }

  private static Path repository() {
    String root = System.getProperty("score.snapshot.repositoryRoot");
    return root == null ? null : Path.of(root);
  }

  static int execute(Map<String, String> env, Path repository, PrintStream out) {
    return execute(env, repository, out, ScoreSnapshotFiles::read);
  }

  /** 테스트에서는 파일 접근 횟수·읽기 실패·실행 중 교체를 제어하며 제품 경로는 기존 안전 판독기만 사용한다. */
  @FunctionalInterface
  interface Reader {
    byte[] read(Path path, Path repository) throws IOException;
  }

  static int execute(Map<String, String> env, Path repository, PrintStream out, Reader reader) {
    if (!"1".equals(env.get("SCORE_TRUST_PREFLIGHT_ENABLED"))) {
      out.println("NOT_EXECUTED: EXPLICIT_ENABLE_REQUIRED");
      out.println(HOLDS);
      return 2;
    }
    String phase = "CONFIGURATION";
    try {
      var config = Configuration.from(env);
      if (repository == null) throw new IllegalArgumentException();
      phase = "INPUT_FILES";
      byte[] trust = reader.read(config.trust(), repository);
      byte[] manifest = reader.read(config.manifest(), repository);
      byte[] bundle = reader.read(config.bundle(), repository);
      byte[] previous =
          config.previous() == null ? null : reader.read(config.previous(), repository);

      phase = "TRUST_PIN";
      checkPin(trust, config.expected());
      ScoreTrustRecord previousRecord = null;
      if (previous != null) {
        phase = "PREVIOUS_TRUST_PIN";
        previousRecord = checkPin(previous, config.previousExpected());
      }
      phase = "BINDING";
      var result = new ScoreTrustRecordVerifier().verify(trust, manifest, bundle, previousRecord);

      // 개별 파일의 안전 읽기에 더해 결합 검증 도중 바뀐 파일도 성공 출력 전에 거부한다.
      // 여러 파일의 원자적 읽기나 종료 이후 최신성까지 보장하는 운영 게이트는 아니다.
      phase = "FILE_STABILITY";
      unchanged(config.trust(), trust, repository, reader);
      unchanged(config.manifest(), manifest, repository, reader);
      unchanged(config.bundle(), bundle, repository, reader);
      if (previous != null) unchanged(config.previous(), previous, repository, reader);

      out.println(
          "PREFLIGHT_VERIFIED binding="
              + result.status()
              + " externalTrustPin=MATCHED revisionCheck="
              + result.revisionCheck());
      out.println("sourceComparabilityApproval=NOT_ESTABLISHED publicationApproval=NOT_APPROVED");
      out.println(HOLDS);
      return 0;
    } catch (Exception error) {
      // 원본 예외·JSON·경로·승인 ID를 출력하거나 과거 정상 파일/결과로 대체하지 않는다.
      failure(out, phase);
      return 2;
    }
  }

  private static ScoreTrustRecord checkPin(byte[] bytes, String expected) {
    var codec = new ScoreTrustRecordCodec();
    var record = codec.decode(bytes);
    if (!expected.equals(codec.sha256(record))) throw new IllegalArgumentException();
    return record;
  }

  private static void unchanged(Path path, byte[] before, Path repository, Reader reader)
      throws IOException {
    if (!Arrays.equals(before, reader.read(path, repository))) throw new IOException();
  }

  private static void failure(PrintStream out, String phase) {
    out.println("NOT_COMPLETED: phase=" + phase + "; 원문·경로 비출력");
    out.println(HOLDS);
  }

  /** 필수 설정과 선택 설정 쌍을 모두 검사한 뒤 첫 파일 읽기를 허용한다. */
  private record Configuration(
      Path trust,
      Path manifest,
      Path bundle,
      String expected,
      Path previous,
      String previousExpected) {
    static Configuration from(Map<String, String> env) {
      Path trust = path(env, "SCORE_TRUST_RECORD_PATH");
      Path manifest = path(env, "SCORE_APPROVAL_MANIFEST_PATH");
      Path bundle = path(env, "SCORE_SNAPSHOT_INPUT_PATH");
      String expected = hash(env, "SCORE_TRUST_RECORD_EXPECTED_SHA256");
      Path previous = null;
      String previousExpected = null;
      if (env.containsKey("SCORE_TRUST_PREVIOUS_RECORD_PATH")
          || env.containsKey("SCORE_TRUST_PREVIOUS_EXPECTED_SHA256")) {
        previous = path(env, "SCORE_TRUST_PREVIOUS_RECORD_PATH");
        previousExpected = hash(env, "SCORE_TRUST_PREVIOUS_EXPECTED_SHA256");
      }
      return new Configuration(trust, manifest, bundle, expected, previous, previousExpected);
    }

    private static Path path(Map<String, String> env, String key) {
      String value = env.get(key);
      if (value == null || value.isBlank()) throw new IllegalArgumentException();
      Path path = Path.of(value);
      if (!path.isAbsolute() || !path.equals(path.normalize()) || path.getFileName() == null)
        throw new IllegalArgumentException();
      return path;
    }

    private static String hash(Map<String, String> env, String key) {
      String value = env.get(key);
      if (value == null || !value.matches("[a-f0-9]{64}")) throw new IllegalArgumentException();
      return value;
    }
  }
}
