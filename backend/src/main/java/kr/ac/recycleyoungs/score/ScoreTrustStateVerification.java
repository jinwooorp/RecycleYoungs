package kr.ac.recycleyoungs.score;

/** 공급자의 독립 기준과 시작/종료 상태를 확인하는 내부 진단. 운영 승인·저장·캐시·REST 연결은 없다. */
public final class ScoreTrustStateVerification {
  public enum Status {
    TRUST_BASIS_MISSING,
    TRUST_BASIS_UNAVAILABLE,
    TRUST_BASIS_MISMATCH,
    REVOCATION_OR_REVISION_FAILURE,
    TRUST_BASIS_CHANGED,
    FILE_OR_INTEGRITY_FAILURE,
    BINDING_FAILURE,
    CURRENT_INPUT_FAILURE,
    VERIFIED
  }

  /** 공급자 원문·기준 ID·파일 경로·예외를 노출하지 않는다. VERIFIED도 공개 허용 결과가 아니다. */
  public record Result(
      Status status,
      ScoreTrustVerification.HistoryCheck historyCheck,
      ScoreInputComparison.Status currentInputStatus) {
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

  private final ScoreTrustBasisProvider provider;
  private final ScoreTrustVerification verification;

  /** 신뢰할 애플리케이션 구성에서 공급자를 주입한다. HTTP·환경변수로 공급자를 선택하거나 기준을 생성하지 않는다. */
  public ScoreTrustStateVerification(
      ScoreTrustBasisProvider provider, ScoreTrustVerification verification) {
    this.provider = provider;
    this.verification = verification;
  }

  public Result verify(ScoreTrustVerification.InputFiles files) {
    return run(files, null, false);
  }

  /** DB 대조도 명시적으로 요청하면 그 종료까지 포함해 기준을 재확인한다. 파일은 같은 불변 참조를 전달한다. */
  public Result verifyCurrentInputs(
      ScoreTrustVerification.InputFiles files, ScoreCurrentInputVerification current) {
    return run(files, current, true);
  }

  private Result run(
      ScoreTrustVerification.InputFiles files,
      ScoreCurrentInputVerification current,
      boolean checkCurrent) {
    if (provider == null || verification == null || checkCurrent && current == null)
      return stopped(Status.TRUST_BASIS_MISSING);
    ScoreTrustBasisProvider.Snapshot before;
    try {
      before = provider.read();
    } catch (Exception failure) {
      return stopped(Status.TRUST_BASIS_UNAVAILABLE);
    }
    try {
      complete(before);
      // 이전 기준은 공급자만 제공한다. 호출자가 파일 경로로 다른 이전 기록을 끼워 넣을 수 없다.
      if (files == null || files.previousRecord() != null) throw new IllegalArgumentException();
    } catch (RuntimeException failure) {
      return stopped(Status.TRUST_BASIS_MISSING);
    }
    if (before.releaseStatus() != ScoreTrustRecord.ReleaseStatus.ACTIVE)
      return stopped(Status.REVOCATION_OR_REVISION_FAILURE);

    Result provisional;
    try {
      var previous = before.previous();
      var basis =
          new ScoreTrustVerification.TrustBasis(
              before.expectedTrustSha256(),
              previous == null ? null : previous.expectedSha256(),
              before.minimumRevision(),
              before.activeReleaseId());
      var inspection =
          verification.inspect(basis, files, previous == null ? null : previous.record());
      var result = inspection.result();
      if (result.status() != ScoreTrustVerification.Status.BINDING_VERIFIED) {
        provisional = stopped(map(result));
      } else if (checkCurrent) {
        var compared = current.verify(inspection.reference());
        if (compared.status() != ScoreInputComparison.Status.MATCHED
            || !inspection.reference().fileSha256().equals(compared.referenceFileSha256())) {
          provisional =
              new Result(
                  Status.CURRENT_INPUT_FAILURE,
                  ScoreTrustVerification.HistoryCheck.NOT_PROVIDED,
                  compared.status());
        } else {
          provisional = new Result(Status.VERIFIED, result.historyCheck(), compared.status());
        }
      } else {
        provisional = new Result(Status.VERIFIED, result.historyCheck(), null);
      }
    } catch (RuntimeException failure) {
      provisional = stopped(Status.BINDING_FAILURE);
    }

    try {
      var after = provider.read();
      complete(after);
      // changeId뿐 아니라 모든 기준을 비교한다. 중간 성공이나 공급자의 식별자 재사용으로 변경을 숨기지 않는다.
      if (!before.equals(after)) return stopped(Status.TRUST_BASIS_CHANGED);
    } catch (Exception failure) {
      // 종료 조회 오류도 중간 성공을 무효화한다. 원본 예외나 과거 정상 기준을 반환하지 않는다.
      return stopped(Status.TRUST_BASIS_CHANGED);
    }
    return provisional;
  }

  private static void complete(ScoreTrustBasisProvider.Snapshot snapshot) {
    if (snapshot == null
        || snapshot.releaseStatus() == null
        || snapshot.minimumRevision() == null
        || snapshot.minimumRevision() < 1) throw new IllegalArgumentException();
    ScoreApprovalManifest.identifier(snapshot.changeId());
    ScoreApprovalManifest.identifier(snapshot.activeReleaseId());
    ScoreApprovalManifest.hash(snapshot.expectedTrustSha256());
    if (snapshot.previous() != null) {
      if (snapshot.previous().record() == null) throw new IllegalArgumentException();
      ScoreApprovalManifest.hash(snapshot.previous().expectedSha256());
    }
  }

  private static Status map(ScoreTrustVerification.Result result) {
    return switch (result.status()) {
      case TRUST_BASIS_MISSING -> Status.TRUST_BASIS_MISSING;
      case TRUST_BASIS_MISMATCH -> Status.TRUST_BASIS_MISMATCH;
      case REVOCATION_OR_REVISION_FAILURE -> Status.REVOCATION_OR_REVISION_FAILURE;
      case BINDING_FAILURE -> Status.BINDING_FAILURE;
      case FILE_OR_INTEGRITY_FAILURE ->
          result.phase() == ScoreTrustVerification.Phase.TRUST_PIN
                  || result.phase() == ScoreTrustVerification.Phase.PREVIOUS_TRUST_PIN
              ? Status.TRUST_BASIS_MISMATCH
              : Status.FILE_OR_INTEGRITY_FAILURE;
      case BINDING_VERIFIED -> Status.VERIFIED;
    };
  }

  private static Result stopped(Status status) {
    return new Result(status, ScoreTrustVerification.HistoryCheck.NOT_PROVIDED, null);
  }
}
