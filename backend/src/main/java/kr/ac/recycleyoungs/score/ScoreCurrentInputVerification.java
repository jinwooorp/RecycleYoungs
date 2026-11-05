package kr.ac.recycleyoungs.score;

import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionSystemException;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 구·동 전체 현재 입력을 한 PostgreSQL 읽기 스냅샷에서 대조하는 내부 진단. 웹·Flyway·ETL을 시작하지 않는다. */
public final class ScoreCurrentInputVerification {
  public record Result(ScoreInputComparison.Status status, String referenceFileSha256) {
    public InternalScoreResult.PublicationState publicationState() {
      return InternalScoreResult.PublicationState.NOT_APPROVED;
    }

    public ScoreApprovalManifestVerifier.SourceTrust sourceTrust() {
      return ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED;
    }

    public boolean r03Complete() {
      return false;
    }
  }

  private final JdbcClient jdbc;
  private final ScoreInputRepository repository;
  private final TransactionTemplate transaction;

  /** DataSource는 호출자가 준비한다. 생성 시 DB에 연결하거나 운영 환경변수를 읽지 않는다. */
  public ScoreCurrentInputVerification(DataSource source) {
    this(source, new ScoreInputRepository(JdbcClient.create(source)));
  }

  ScoreCurrentInputVerification(DataSource source, ScoreInputRepository repository) {
    jdbc = JdbcClient.create(source);
    this.repository = repository;
    var manager = new JdbcTransactionManager(source);
    // JDBC 힌트에만 의존하지 않고 PostgreSQL에 SET TRANSACTION READ ONLY를 적용한다.
    manager.setEnforceReadOnly(true);
    transaction = new TransactionTemplate(manager);
    transaction.setReadOnly(true);
    transaction.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    transaction.setTimeout(60);
  }

  /** 임의 기준의 동일성 진단도 가능하지만 승인 자료로 해석하지 않는다. 손상된 기준은 DB 접근 전에 거부한다. */
  public Result verify(byte[] referenceJson) {
    ScoreSnapshotReference reference;
    try {
      reference = ScoreSnapshotReference.decode(referenceJson);
    } catch (RuntimeException failure) {
      return new Result(ScoreInputComparison.Status.REFERENCE_INVALID, null);
    }
    return verify(reference);
  }

  /** 신뢰 검증의 inspect()가 전달한 동일 불변 참조를 받을 수 있다. 파일 경로를 재개방하지 않는다. */
  public Result verify(ScoreSnapshotReference reference) {
    if (reference == null) return new Result(ScoreInputComparison.Status.REFERENCE_INVALID, null);
    var rolledBack = new AtomicBoolean();
    try {
      var comparison =
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
                  Boolean safe =
                      jdbc.sql(
                              """
              SELECT current_setting('transaction_read_only')='on'
                AND current_setting('transaction_isolation')='repeatable read'
              """)
                          .query(Boolean.class)
                          .single();
                  if (!Boolean.TRUE.equals(safe)) throw new IllegalStateException();
                  var district = repository.findDistrictInputs("20262", "CS100010");
                  var dong = repository.findDongInputs("20262", "CS100010");
                  return ScoreInputComparison.compare(reference, district, dong);
                } finally {
                  status.setRollbackOnly();
                }
              });
      return new Result(
          comparison != null && rolledBack.get()
              ? comparison
              : ScoreInputComparison.Status.INTERNAL_ERROR,
          reference.fileSha256());
    } catch (CannotCreateTransactionException
        | TransactionSystemException
        | DataAccessResourceFailureException
        | TransientDataAccessResourceException
        | QueryTimeoutException failure) {
      return new Result(ScoreInputComparison.Status.DATABASE_UNAVAILABLE, reference.fileSha256());
    } catch (RuntimeException failure) {
      // SQL·인증정보·입력·원본 예외를 결과에 담지 않으며 과거 정상 결과도 보관하지 않는다.
      return new Result(ScoreInputComparison.Status.INTERNAL_ERROR, reference.fileSha256());
    }
  }
}
