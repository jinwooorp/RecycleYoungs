package kr.ac.recycleyoungs.score;

import java.io.PrintStream;
import java.nio.file.Path;
import java.util.Map;

/** DB·Spring Context를 시작하지 않는 명시 파일 검증 CLI. 환경변수의 DB 설정은 사용하지 않는다. */
public final class ScoreSnapshotVerifyMain {
  private ScoreSnapshotVerifyMain() {}

  public static void main(String[] args) {
    int code = 2;
    try {
      if (args.length == 0)
        code =
            execute(
                System.getenv(),
                Path.of(System.getProperty("score.snapshot.repositoryRoot")),
                System.out);
    } catch (RuntimeException error) {
      System.out.println("NOT_COMPLETED: CONFIGURATION");
    }
    System.exit(code);
  }

  static int execute(Map<String, String> env, Path repository, PrintStream out) {
    try {
      String input = env.get("SCORE_SNAPSHOT_INPUT_PATH");
      if (input == null || input.isBlank()) throw new IllegalArgumentException();
      byte[] bytes = ScoreSnapshotFiles.read(Path.of(input), repository);
      var bundle = ScoreSnapshotBundle.decode(bytes);
      int pins = 0;
      pins += pin(env, "SCORE_SNAPSHOT_EXPECTED_FILE_SHA256", ScoreSnapshotCodec.sha256(bytes));
      pins += pin(env, "SCORE_SNAPSHOT_EXPECTED_DISTRICT_ID", bundle.district().inputSnapshotId());
      pins += pin(env, "SCORE_SNAPSHOT_EXPECTED_DONG_ID", bundle.dong().inputSnapshotId());
      out.println(
          "VERIFIED externalPins=" + pins + " fileSha256=" + ScoreSnapshotCodec.sha256(bytes));
      bundle.printSummary(out);
      return 0;
    } catch (Exception error) {
      out.println("NOT_COMPLETED: FILE_FORMAT_HASH_OR_REPLAY; 원문·경로 비출력");
      return 2;
    }
  }

  private static int pin(Map<String, String> env, String key, String actual) {
    if (!env.containsKey(key)) return 0;
    String expected = env.get(key);
    if (expected == null || !expected.matches("[a-f0-9]{64}") || !expected.equals(actual))
      throw new IllegalArgumentException();
    return 1;
  }
}
