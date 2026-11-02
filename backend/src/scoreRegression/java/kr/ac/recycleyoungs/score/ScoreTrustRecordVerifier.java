package kr.ac.recycleyoungs.score;

import java.util.List;

/** 독립 기대값의 결합만 검사하며 실제 승인이나 운영 신뢰 경로를 검증하지 않는다. */
public final class ScoreTrustRecordVerifier {
  public enum Status {
    TRUST_BINDING_VERIFIED
  }

  public enum RevisionCheck {
    NOT_PROVIDED,
    CHECKED
  }

  public record Result(
      Status status,
      long revision,
      String activeReleaseId,
      String manifestSha256,
      RevisionCheck revisionCheck) {
    public InternalScoreResult.PublicationState publicationState() {
      return InternalScoreResult.PublicationState.NOT_APPROVED;
    }

    public ScoreApprovalManifestVerifier.SourceTrust sourceTrust() {
      return ScoreApprovalManifestVerifier.SourceTrust.NOT_ESTABLISHED;
    }
  }

  /** 이전 기록은 호출자가 독립적으로 신뢰할 수 있을 때만 제공한다. null이면 이력 보호를 주장하지 않으며, 현재 기록의 유래를 이 메서드가 인증하는 것도 아니다. */
  public Result verify(
      byte[] trustRecordJson,
      byte[] manifestJson,
      byte[] bundleJson,
      ScoreTrustRecord independentlyTrustedPreviousRecord) {
    try {
      var codec = new ScoreTrustRecordCodec();
      var record = codec.decode(trustRecordJson);
      if (record.releaseStatus() != ScoreTrustRecord.ReleaseStatus.ACTIVE)
        throw new IllegalArgumentException();
      for (var revocation : record.revocations()) {
        String expectedId =
            switch (revocation.target()) {
              case RELEASE -> record.activeReleaseId();
              case POLICY_APPROVAL -> record.policyApprovalId();
              case SOURCE_VERIFICATION -> record.sourceVerificationId();
              case COVERAGE_APPROVAL -> record.coverageApprovalId();
            };
        if (revocation.targetId().equals(expectedId)) throw new IllegalArgumentException();
      }
      var revisionCheck = RevisionCheck.NOT_PROVIDED;
      if (independentlyTrustedPreviousRecord != null) {
        checkHistory(record, independentlyTrustedPreviousRecord);
        revisionCheck = RevisionCheck.CHECKED;
      }
      // 범위도 기록에서 고정한다. 기대 ID나 해시를 manifest·입력에서 생성하지 않는다.
      var manifestBytes = manifestJson.clone();
      var manifest = new ScoreApprovalManifestCodec().decode(manifestBytes);
      if (!record.quarterCode().equals(manifest.quarterCode())
          || !record.industryCode().equals(manifest.industryCode())
          || !record.algorithmVersion().equals(manifest.algorithmVersion()))
        throw new IllegalArgumentException();
      var references =
          new ScoreApprovalManifestVerifier.ExpectedReferences(
              record.policyVersion(),
              record.policyApprovalId(),
              record.sourceVerificationId(),
              record.coverageApprovalId());
      var binding =
          new ScoreApprovalManifestVerifier()
              .verify(manifestBytes, bundleJson, references, record.manifestSha256());
      return new Result(
          Status.TRUST_BINDING_VERIFIED,
          record.revision(),
          record.activeReleaseId(),
          binding.manifestSha256(),
          revisionCheck);
    } catch (RuntimeException error) {
      // 기대값·입력·철회 사유·원본 예외를 실패 메시지에 노출하지 않는다. 폴백도 없다.
      throw new IllegalArgumentException("신뢰 기록·입력 결합 검증 실패");
    }
  }

  private static void checkHistory(ScoreTrustRecord current, ScoreTrustRecord previous) {
    // 전역 저장소나 단조 증가 카운터는 없다. 전달받은 기준에 대해서만 퇴행을 탐지한다.
    if (current.revision() < previous.revision()
        || current.revision() == previous.revision() && !current.equals(previous)
        || !current.revocations().containsAll(previous.revocations()))
      throw new IllegalArgumentException();
    // 제공된 이전 기록과 활성 ID가 같으면 리비전만 올려 다른 manifest로 바꾸지 못하게 한다.
    if (current.activeReleaseId().equals(previous.activeReleaseId())
        && !releasePins(current).equals(releasePins(previous)))
      throw new IllegalArgumentException();
  }

  private static List<String> releasePins(ScoreTrustRecord record) {
    return List.of(
        record.quarterCode(),
        record.industryCode(),
        record.algorithmVersion(),
        record.policyVersion(),
        record.manifestSha256(),
        record.policyApprovalId(),
        record.sourceVerificationId(),
        record.coverageApprovalId());
  }
}
