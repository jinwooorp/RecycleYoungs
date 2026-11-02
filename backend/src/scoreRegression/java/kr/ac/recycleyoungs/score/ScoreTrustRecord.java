package kr.ac.recycleyoungs.score;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;

/** manifest와 분리한 기대값. 보호된 배포 경로의 진위나 실제 승인을 증명하지 않는다. */
public record ScoreTrustRecord(
    String trustRecordSchemaVersion,
    long revision,
    String activeReleaseId,
    ReleaseStatus releaseStatus,
    String quarterCode,
    String industryCode,
    String algorithmVersion,
    String policyVersion,
    String manifestSha256,
    String policyApprovalId,
    String sourceVerificationId,
    String coverageApprovalId,
    List<Revocation> revocations) {
  public static final String SCHEMA_VERSION = "score-trust-record-v1";

  public ScoreTrustRecord {
    if (!SCHEMA_VERSION.equals(trustRecordSchemaVersion)
        || revision <= 0
        || !"20262".equals(quarterCode)
        || !"CS100010".equals(industryCode)
        || !ScoreSnapshotArtifact.ALGORITHM_VERSION.equals(algorithmVersion))
      throw new IllegalArgumentException("지원하지 않는 신뢰 기록 범위·버전·리비전");
    if (activeReleaseId != null) ScoreApprovalManifest.identifier(activeReleaseId);
    Objects.requireNonNull(releaseStatus);
    if (releaseStatus != ReleaseStatus.INACTIVE && activeReleaseId == null)
      throw new IllegalArgumentException("릴리스 ID 누락");
    for (String id :
        List.of(policyVersion, policyApprovalId, sourceVerificationId, coverageApprovalId))
      ScoreApprovalManifest.identifier(id);
    ScoreApprovalManifest.hash(manifestSha256);
    revocations =
        revocations.stream()
            .map(Objects::requireNonNull)
            .sorted(
                Comparator.comparing(Revocation::target)
                    .thenComparing(Revocation::targetId, ScoreSnapshotCodec::compareCodePoints))
            .toList();
    var targets = new HashSet<List<Object>>();
    for (var revocation : revocations)
      if (!targets.add(List.of(revocation.target(), revocation.targetId())))
        throw new IllegalArgumentException("철회 대상 중복");
    if (releaseStatus == ReleaseStatus.REVOKED
        && revocations.stream()
            .noneMatch(r -> r.target() == Target.RELEASE && r.targetId().equals(activeReleaseId)))
      throw new IllegalArgumentException("철회 상태의 근거 누락");
  }

  /** ACTIVE도 이 기록 안의 활성 주장일 뿐 공개 승인 상태가 아니다. */
  public enum ReleaseStatus {
    ACTIVE,
    INACTIVE,
    REVOKED
  }

  public enum Target {
    RELEASE,
    POLICY_APPROVAL,
    SOURCE_VERIFICATION,
    COVERAGE_APPROVAL
  }

  /** 철회는 대상 종류·ID별 한 번의 불변 기록이며 이유나 시각을 덮어쓰지 않는다. */
  public record Revocation(
      Target target, String targetId, String reason, OffsetDateTime revokedAt) {
    public Revocation {
      Objects.requireNonNull(target);
      ScoreApprovalManifest.identifier(targetId);
      if (reason == null
          || reason.isBlank()
          || !reason.equals(reason.strip())
          || reason.codePoints().anyMatch(Character::isISOControl))
        throw new IllegalArgumentException("철회 사유 누락·형식 오류");
      revokedAt = Objects.requireNonNull(revokedAt).withOffsetSameInstant(ZoneOffset.UTC);
    }
  }
}
