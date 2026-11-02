package kr.ac.recycleyoungs.score;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.io.PrintStream;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.support.TransactionTemplate;

/** 명시 실행만 허용하는 읽기 전용 진단 도구. Spring Boot·웹·Flyway 자동 구성을 시작하지 않는다. */
public final class ScoreRegressionMain {
  private ScoreRegressionMain() {}

  public static void main(String[] args) {
    int code = args.length == 0 ? execute(System.getenv(), System.out) : 2;
    if (args.length != 0) System.out.println("NOT_EXECUTED: 명령행 인자는 받지 않습니다.");
    System.exit(code);
  }

  static int execute(Map<String, String> environment, PrintStream out) {
    if (!"1".equals(environment.get("SCORE_REGRESSION_ENABLED"))) {
      out.println("NOT_EXECUTED: SCORE_REGRESSION_ENABLED=1 명시가 필요합니다. DB 연결 없음.");
      return 2;
    }
    // 데이터소스·Spring의 진단 로그에 URL·비밀번호·예외 원문이 섞이지 않도록 실행 구간만 차단한다.
    Logger logger = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    Level previous = logger.getLevel();
    logger.setLevel(Level.OFF);
    var phase = new AtomicReference<>("CONFIGURATION");
    var observedSafety = new AtomicReference<Safety>();
    try {
      String url = required(environment, "DB_JDBC_URL");
      validateUrl(url);
      String user = required(environment, "DB_USER");
      String password = required(environment, "DB_PASSWORD");
      var source = dataSource(url, user, password);
      try (var context = context(source)) {
        if (!context.getBeansOfType(Flyway.class).isEmpty())
          throw new IllegalStateException("Flyway 금지");
        var manager = context.getBean(PlatformTransactionManager.class);
        var jdbc = context.getBean(JdbcClient.class);
        var repository = context.getBean(ScoreInputRepository.class);
        var service = context.getBean(ScoreService.class);
        var transaction = new TransactionTemplate(manager);
        transaction.setReadOnly(true);
        transaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
        transaction.setTimeout(60);
        var execution =
            transaction.execute(
                status -> {
                  try {
                    phase.set("DB_SAFETY");
                    var safety =
                        jdbc.sql(
                                """
                SELECT current_setting('default_transaction_read_only') AS default_read_only,
                  current_setting('transaction_read_only') AS read_only,
                  current_setting('transaction_isolation') AS isolation,
                  transaction_timestamp() AS started,clock_timestamp() AS checked
                """)
                            .query(
                                (rs, row) ->
                                    new Safety(
                                        rs.getString("default_read_only"),
                                        rs.getString("read_only"),
                                        rs.getString("isolation"),
                                        rs.getObject("started", OffsetDateTime.class),
                                        rs.getObject("checked", OffsetDateTime.class)))
                            .single();
                    observedSafety.set(safety);
                    if (!safety.defaultReadOnly().equals("on")
                        || !safety.readOnly().equals("on")
                        || !safety.isolation().equals("repeatable read")) {
                      throw new IllegalStateException("DB 읽기 전용 조건 불충족");
                    }
                    // 각 단위에서 Repository와 Service를 한 번씩 호출하여 동일 스냅샷 입력도 대조한다.
                    // 지역별 조회·별도 트랜잭션·외부 파일 복사·점수 수식 재구현은 하지 않는다.
                    phase.set("REPOSITORY");
                    var districts = repository.findDistrictInputs("20262", "CS100010");
                    var dongs = repository.findDongInputs("20262", "CS100010");
                    phase.set("SERVICE");
                    var districtResult =
                        service.diagnoseDistrict(firstCode(districts), "20262", "CS100010");
                    var dongResult = service.diagnoseDong(firstCode(dongs), "20262", "CS100010");
                    phase.set("SNAPSHOT_PARITY");
                    if (!districts.equals(districtResult.snapshot())
                        || !dongs.equals(dongResult.snapshot())) {
                      throw new IllegalStateException("Repository·Service 스냅샷 불일치");
                    }
                    phase.set("VERIFICATION");
                    return new Execution(
                        safety,
                        ScoreRegressionVerifier.verify(
                            List.of(districtResult, dongResult),
                            ScoreRegressionVerifier.historical()));
                  } finally {
                    status.setRollbackOnly();
                  }
                });
        // execute가 반환된 뒤에만 실제 ROLLBACK 완료로 기록한다. 원본 전체 입력은 출력하지 않는다.
        if (execution == null) throw new IllegalStateException("진단 결과 없음");
        out.println("TARGET quarter=20262 industry=CS100010 footTrafficIndustryFilter=NONE");
        out.println(
            "SAFETY default_transaction_read_only="
                + execution.safety().defaultReadOnly()
                + " transaction_read_only="
                + execution.safety().readOnly()
                + " isolation="
                + execution.safety().isolation()
                + " flyway=NOT_CONFIGURED transactionEnd=ROLLBACK");
        out.println(
            "TIME transactionStarted="
                + kst(execution.safety().started())
                + " safetyChecked="
                + kst(execution.safety().checked())
                + " rollbackConfirmed="
                + kst(OffsetDateTime.now()));
        execution.report().lines().forEach(out::println);
        execution.report().differences().forEach(d -> out.println("DIFFERENCE " + d));
        out.println(
            "SUMMARY checkedRegions="
                + execution.report().checkedRegions()
                + " arithmetic="
                + execution.report().arithmeticPassed()
                + " permutation="
                + execution.report().permutationPassed()
                + " differences="
                + execution.report().differences().size());
        return execution.report().differences().isEmpty()
                && execution.report().arithmeticPassed()
                && execution.report().permutationPassed()
            ? 0
            : 1;
      }
    } catch (RuntimeException error) {
      // 클래스명만 출력한다. cause·message·stacktrace는 URL·인증정보·개인 경로를 포함할 수 있다.
      out.println(
          "NOT_COMPLETED: "
              + error.getClass().getSimpleName()
              + " phase="
              + phase.get()
              + "; 원본 예외·접속정보 비출력. 실데이터 검증 성공 아님.");
      var safety = observedSafety.get();
      if (safety != null)
        out.println(
            "SAFETY_OBSERVED default="
                + safety.defaultReadOnly()
                + " transaction="
                + safety.readOnly()
                + " isolation="
                + safety.isolation());
      return 2;
    } finally {
      logger.setLevel(previous);
    }
  }

  private static String required(Map<String, String> environment, String name) {
    String value = environment.get(name);
    if (value == null || value.isBlank()) throw new IllegalArgumentException("필수 환경변수 없음");
    return value;
  }

  /** JDBC URL이 연결 속성의 쓰기 방지를 덮어쓰거나 인증정보·추가 설정 파일을 지정하지 못하게 한다. */
  private static void validateUrl(String url) {
    if (!url.startsWith("jdbc:postgresql://"))
      throw new IllegalArgumentException("PostgreSQL URL 필요");
    URI uri = URI.create(url.substring(5));
    if (uri.getRawUserInfo() != null || uri.getRawFragment() != null)
      throw new IllegalArgumentException("URL 인증정보·fragment 금지");
    if (uri.getRawQuery() != null) {
      for (String parameter : uri.getRawQuery().split("&")) {
        String key =
            URLDecoder.decode(parameter.split("=", 2)[0], StandardCharsets.UTF_8)
                .toLowerCase(Locale.ROOT);
        if (!Set.of("sslmode", "ssl", "currentschema").contains(key))
          throw new IllegalArgumentException("연결 속성 덮어쓰기 금지");
      }
    }
  }

  private static DataSource dataSource(String url, String user, String password) {
    var source = new DriverManagerDataSource(url, user, password);
    var properties = new Properties();
    properties.setProperty(
        "options",
        "-c default_transaction_read_only=on -c statement_timeout=40000 -c lock_timeout=5000");
    properties.setProperty("readOnly", "true");
    // always 모드는 autoCommit=false 전환 때 세션 기본값을 READ WRITE로 바꾼다.
    // transaction 모드로 시작 옵션의 default_transaction_read_only=on도 유지한다.
    properties.setProperty("readOnlyMode", "transaction");
    properties.setProperty("connectTimeout", "5");
    properties.setProperty("socketTimeout", "45");
    properties.setProperty("ApplicationName", "score-r03-regression");
    source.setConnectionProperties(properties);
    return source;
  }

  private static AnnotationConfigApplicationContext context(DataSource source) {
    var context = new AnnotationConfigApplicationContext();
    context.getEnvironment().setActiveProfiles("db", "score-regression-tool");
    context.register(ToolTransactions.class);
    context.registerBean(DataSource.class, () -> source);
    context.registerBean(JdbcClient.class, () -> JdbcClient.create(source));
    context.registerBean(
        PlatformTransactionManager.class,
        () -> {
          var manager = new JdbcTransactionManager(source);
          manager.setEnforceReadOnly(true);
          manager.setValidateExistingTransaction(true);
          return manager;
        });
    context.registerBean(
        ScoreInputRepository.class,
        () -> new ScoreInputRepository(context.getBean(JdbcClient.class)));
    context.registerBean(
        ScoreService.class, () -> new ScoreService(context.getBean(ScoreInputRepository.class)));
    try {
      context.refresh();
      return context;
    } catch (RuntimeException error) {
      context.close();
      throw error;
    }
  }

  private static String firstCode(ScoreInputSnapshot snapshot) {
    return snapshot.regions().isEmpty()
        ? "__no_boundary_region__"
        : snapshot.regions().getFirst().regionCode();
  }

  private static String kst(OffsetDateTime time) {
    return time.atZoneSameInstant(ZoneId.of("Asia/Seoul")).toOffsetDateTime().toString();
  }

  private record Safety(
      String defaultReadOnly,
      String readOnly,
      String isolation,
      OffsetDateTime started,
      OffsetDateTime checked) {}

  private record Execution(Safety safety, ScoreRegressionVerifier.Report report) {}

  /** 일반 애플리케이션·테스트의 component scan에서는 활성화되지 않는다. */
  @Configuration(proxyBeanMethods = false)
  @Profile("score-regression-tool")
  @EnableTransactionManagement(proxyTargetClass = true)
  static class ToolTransactions {}
}
