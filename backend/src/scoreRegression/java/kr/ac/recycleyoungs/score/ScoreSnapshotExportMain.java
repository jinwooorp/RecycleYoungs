package kr.ac.recycleyoungs.score;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.io.PrintStream;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import org.flywaydb.core.Flyway;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 읽기 전용 한 스냅샷을 검증·롤백한 뒤에만 명시한 외부 위치에 보존하는 별도 CLI. */
public final class ScoreSnapshotExportMain {
  private ScoreSnapshotExportMain() {}

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
    if (!"1".equals(env.get("SCORE_SNAPSHOT_EXPORT_ENABLED"))) {
      out.println("NOT_EXECUTED: SCORE_SNAPSHOT_EXPORT_ENABLED=1 필요; DB 연결·파일 생성 없음");
      return 2;
    }
    var logger = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    Level previous = logger.getLevel();
    logger.setLevel(Level.OFF);
    String phase = "CONFIGURATION";
    var rolledBack = new AtomicBoolean();
    try {
      var target =
          ScoreSnapshotFiles.prepareOutput(
              Path.of(ScoreRegressionMain.required(env, "SCORE_SNAPSHOT_OUTPUT_PATH")), repository);
      String url = ScoreRegressionMain.required(env, "DB_JDBC_URL");
      ScoreRegressionMain.validateUrl(url);
      var source =
          ScoreRegressionMain.dataSource(
              url,
              ScoreRegressionMain.required(env, "DB_USER"),
              ScoreRegressionMain.required(env, "DB_PASSWORD"),
              "score-snapshot-export");
      phase = "READ_ONLY_CAPTURE";
      ScoreSnapshotBundle bundle;
      try (var context = ScoreRegressionMain.context(source)) {
        if (!context.getBeansOfType(Flyway.class).isEmpty()) throw new IllegalStateException();
        var transaction =
            new TransactionTemplate(context.getBean(PlatformTransactionManager.class));
        transaction.setReadOnly(true);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        transaction.setTimeout(60);
        bundle =
            transaction.execute(
                status -> {
                  TransactionSynchronizationManager.registerSynchronization(
                      new TransactionSynchronization() {
                        @Override
                        public void afterCompletion(int completion) {
                          rolledBack.set(completion == STATUS_ROLLED_BACK);
                        }
                      });
                  try {
                    var jdbc = context.getBean(JdbcClient.class);
                    OffsetDateTime started =
                        jdbc.sql(
                                """
                SELECT transaction_timestamp() AS started
                WHERE current_setting('default_transaction_read_only')='on'
                  AND current_setting('transaction_read_only')='on'
                  AND current_setting('transaction_isolation')='repeatable read'
                """)
                            .query(OffsetDateTime.class)
                            .single();
                    var repositoryBean = context.getBean(ScoreInputRepository.class);
                    var district = repositoryBean.findDistrictInputs("20262", "CS100010");
                    var dong = repositoryBean.findDongInputs("20262", "CS100010");
                    return new ScoreSnapshotBundle(
                        capture(district, started), capture(dong, started));
                  } finally {
                    status.setRollbackOnly();
                  }
                });
      }
      if (bundle == null || !rolledBack.get()) throw new IllegalStateException();
      phase = "VERIFY_AFTER_ROLLBACK";
      byte[] bytes = bundle.encode();
      ScoreSnapshotBundle.decode(bytes);
      phase = "FILE_PUBLICATION";
      ScoreSnapshotFiles.saveNew(target, bytes);
      out.println(
          "EXPORTED default_transaction_read_only=on transaction_read_only=on isolation=repeatable read flyway=NOT_CONFIGURED transactionEnd=ROLLBACK");
      out.println(
          "fileSha256="
              + ScoreSnapshotCodec.sha256(bytes)
              + " permissions=OWNER_READ_ONLY atomicPublication=HARD_LINK");
      bundle.printSummary(out);
      return 0;
    } catch (Exception error) {
      out.println(
          "NOT_COMPLETED phase="
              + phase
              + " rollbackConfirmed="
              + rolledBack.get()
              + "; 파일·접속정보·예외 원문 비출력");
      return 2;
    } finally {
      logger.setLevel(previous);
    }
  }

  private static ScoreSnapshotArtifact capture(ScoreInputSnapshot input, OffsetDateTime started) {
    return ScoreSnapshotArtifact.capture(
        input,
        input.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList(),
        started);
  }
}
