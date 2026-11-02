package kr.ac.recycleyoungs.score;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 승인 전 A 후보의 내부 진단만 수행한다. 공개 점수 제공이나 승인 판정 기능은 없다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class ScoreService {
  private final ScoreInputRepository repository;

  public ScoreService(ScoreInputRepository repository) {
    this.repository = repository;
  }

  public InternalScoreResult diagnoseDistrict(String code, String quarter, String industry) {
    return diagnose(
        new InternalScoreResult.Request(
            ScoreCalculation.RegionUnit.DISTRICT, code, quarter, industry));
  }

  public InternalScoreResult diagnoseDong(String code, String quarter, String industry) {
    return diagnose(
        new InternalScoreResult.Request(ScoreCalculation.RegionUnit.DONG, code, quarter, industry));
  }

  /**
   * Repository는 경계·통계를 SQL 한 번으로 읽는다. 상태 판정은 경계→지역→데이터셋 순서를 지킨다. 승인 검사를 생략한 공개 계산 경로가 아니라 별도의 내부 진단
   * 경로이며 결과는 항상 미승인이다.
   */
  private InternalScoreResult diagnose(InternalScoreResult.Request request) {
    if (!"20262".equals(request.quarterCode())
        || !"CS100010".equals(request.industryCode())
        || request.regionCode() == null
        || request.regionCode().isBlank()) {
      return stopped(request, InternalScoreResult.Status.UNSUPPORTED_INPUT, null);
    }
    try {
      var snapshot =
          request.unit() == ScoreCalculation.RegionUnit.DISTRICT
              ? repository.findDistrictInputs(request.quarterCode(), request.industryCode())
              : repository.findDongInputs(request.quarterCode(), request.industryCode());
      if (snapshot.unit() != request.unit()
          || !Objects.equals(snapshot.quarterCode(), request.quarterCode())
          || !Objects.equals(snapshot.industryCode(), request.industryCode())) {
        throw new IllegalStateException("조회 스냅샷의 단위·분기·업종이 요청과 다릅니다.");
      }
      if (snapshot.boundary() == null || !snapshot.boundaryRowsPresent()) {
        return stopped(request, InternalScoreResult.Status.BOUNDARY_NOT_READY, snapshot);
      }
      if (snapshot.regions().stream().noneMatch(r -> r.regionCode().equals(request.regionCode()))) {
        return stopped(request, InternalScoreResult.Status.REGION_NOT_FOUND, snapshot);
      }
      var ready = snapshot.readiness();
      if (!ready.stores() || !ready.sales() || !ready.footTraffic()) {
        return stopped(request, InternalScoreResult.Status.DATASET_NOT_READY, snapshot);
      }
      return calculate(request, snapshot);
    } catch (DataAccessResourceFailureException
        | TransientDataAccessResourceException
        | QueryTimeoutException e) {
      rollbackDiagnosticTransaction();
      return stopped(request, InternalScoreResult.Status.DATABASE_UNAVAILABLE, null);
    } catch (RuntimeException e) {
      // SQL 문법·매핑·숫자 파싱·불변식 오류를 결측이나 정상 0점으로 숨기지 않는다.
      rollbackDiagnosticTransaction();
      return stopped(request, InternalScoreResult.Status.INTERNAL_ERROR, null);
    }
  }

  private InternalScoreResult calculate(
      InternalScoreResult.Request request, ScoreInputSnapshot snapshot) {
    var evaluation = ScoreCohortEvaluator.evaluate(snapshot);
    var excluded = evaluation.excluded();
    var reasons = new ArrayList<>(evaluation.reasons());
    var scores = evaluation.scores();
    var selected =
        scores.stream()
            .filter(r -> r.input().regionCode().equals(request.regionCode()))
            .findFirst()
            .orElse(null);
    excluded.stream()
        .filter(r -> r.regionCode().equals(request.regionCode()))
        .findFirst()
        .ifPresent(r -> reasons.addAll(r.reasons()));
    return new InternalScoreResult(
        request,
        selected == null
            ? InternalScoreResult.Status.NOT_CALCULABLE
            : InternalScoreResult.Status.INTERNAL_CALCULATED,
        snapshot,
        evaluation.eligibleCount(),
        excluded,
        reasons,
        scores,
        selected);
  }

  private static InternalScoreResult stopped(
      InternalScoreResult.Request request,
      InternalScoreResult.Status status,
      ScoreInputSnapshot snapshot) {
    return new InternalScoreResult(
        request,
        status,
        snapshot,
        null,
        List.of(),
        List.of(
            new InternalScoreResult.Reason(
                InternalScoreResult.ReasonCode.valueOf(status.name()), null)),
        List.of(),
        null);
  }

  /**
   * Repository 예외로 공유 트랜잭션이 rollback-only가 된 경우 정상 commit을 시도하지 않는다. 오류 상태를 반환하되 Service 소유 트랜잭션은
   * rollback하여 UnexpectedRollbackException을 피한다. 프록시가 트랜잭션을 시작하기 전에 실패한
   * CannotCreateTransactionException은 호출 경계에 그대로 전파된다.
   */
  private static void rollbackDiagnosticTransaction() {
    if (TransactionSynchronizationManager.isActualTransactionActive()) {
      TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
    }
  }
}
