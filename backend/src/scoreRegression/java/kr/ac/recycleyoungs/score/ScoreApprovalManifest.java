package kr.ac.recycleyoungs.score;

import java.net.URI;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** 입력과 분리된 승인 주장. 실제 승인 주체의 신뢰를 증명하지 않는다. */
public record ScoreApprovalManifest(
    String manifestSchemaVersion,
    String quarterCode,
    String industryCode,
    String algorithmVersion,
    String policyVersion,
    Map<String, String> policy,
    CohortBinding district,
    CohortBinding dong,
    String fileSha256,
    ApprovalEvidence policyApproval,
    ApprovalEvidence sourceVerification,
    ApprovalEvidence coverageApproval) {
  public static final String SCHEMA_VERSION = "score-approval-manifest-v1";

  public ScoreApprovalManifest {
    if (!SCHEMA_VERSION.equals(manifestSchemaVersion)
        || !"20262".equals(quarterCode)
        || !"CS100010".equals(industryCode)
        || !ScoreSnapshotArtifact.ALGORITHM_VERSION.equals(algorithmVersion))
      throw new IllegalArgumentException("지원하지 않는 manifest 범위·버전");
    identifier(policyVersion);
    policy = Map.copyOf(policy);
    if (policy.isEmpty()) throw new IllegalArgumentException("정책 누락");
    policy.forEach(
        (key, value) -> {
          text(key);
          text(value);
        });
    Objects.requireNonNull(district);
    Objects.requireNonNull(dong);
    if (district.unit() != ScoreCalculation.RegionUnit.DISTRICT
        || dong.unit() != ScoreCalculation.RegionUnit.DONG)
      throw new IllegalArgumentException("승인 대상 단위 불일치");
    hash(fileSha256);
    Objects.requireNonNull(policyApproval);
    Objects.requireNonNull(sourceVerification);
    Objects.requireNonNull(coverageApproval);
  }

  /** 개수만이 아니라 전체 코드·제외 사유·실제 배치 판본을 독립적으로 명시한다. */
  public record CohortBinding(
      ScoreCalculation.RegionUnit unit,
      String inputSnapshotId,
      List<String> boundaryRegionCodes,
      List<String> eligibleRegionCodes,
      List<InternalScoreResult.ExcludedRegion> excludedRegions,
      List<ScoreInputSnapshot.BatchMetadata> batches) {
    public CohortBinding {
      Objects.requireNonNull(unit);
      hash(inputSnapshotId);
      boundaryRegionCodes = codes(boundaryRegionCodes);
      eligibleRegionCodes = codes(eligibleRegionCodes);
      if (boundaryRegionCodes.isEmpty()) throw new IllegalArgumentException("전체 경계 누락");
      var excluded = new ArrayList<InternalScoreResult.ExcludedRegion>();
      for (var region : excludedRegions) {
        text(region.regionCode());
        var reasons =
            region.reasons().stream()
                .sorted(
                    Comparator.comparing(InternalScoreResult.Reason::code)
                        .thenComparing(InternalScoreResult.Reason::metric))
                .toList();
        if (reasons.isEmpty() || new HashSet<>(reasons).size() != reasons.size())
          throw new IllegalArgumentException("제외 사유 누락·중복");
        reasons.forEach(
            r -> {
              Objects.requireNonNull(r.code());
              Objects.requireNonNull(r.metric());
            });
        excluded.add(new InternalScoreResult.ExcludedRegion(region.regionCode(), reasons));
      }
      excludedRegions =
          excluded.stream()
              .sorted(
                  Comparator.comparing(
                      InternalScoreResult.ExcludedRegion::regionCode,
                      ScoreSnapshotCodec::compareCodePoints))
              .toList();
      var partition = new ArrayList<>(eligibleRegionCodes);
      excludedRegions.forEach(e -> partition.add(e.regionCode()));
      if (!codes(partition).equals(boundaryRegionCodes))
        throw new IllegalArgumentException("완비·제외 목록이 전체 경계를 분할하지 않음");
      batches =
          batches.stream()
              .map(ScoreApprovalManifest::batch)
              .sorted(Comparator.comparing(b -> b.batchId().toString()))
              .toList();
      if (batches.isEmpty()
          || batches.stream().map(ScoreInputSnapshot.BatchMetadata::batchId).distinct().count()
              != batches.size()) throw new IllegalArgumentException("배치 누락·중복");
    }
  }

  /** APPROVED는 외부 작성자의 주장이다. 담당·URL 형식 검사로 근거의 진위를 보증하지 않는다. */
  public record ApprovalEvidence(
      String approvalId,
      ClaimedStatus status,
      OffsetDateTime approvedAt,
      String reviewer,
      String evidenceUrl) {
    public ApprovalEvidence {
      identifier(approvalId);
      Objects.requireNonNull(status);
      text(reviewer);
      text(evidenceUrl);
      var uri = URI.create(evidenceUrl);
      if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))
          || uri.getHost() == null
          || uri.getUserInfo() != null) throw new IllegalArgumentException("근거 URL 형식 오류");
      if ((status == ClaimedStatus.APPROVED) != (approvedAt != null))
        throw new IllegalArgumentException("승인 주장과 시각 모순");
      approvedAt = utc(approvedAt);
    }
  }

  public enum ClaimedStatus {
    APPROVED,
    PENDING,
    REJECTED
  }

  static void identifier(String value) {
    if (value == null || !value.matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"))
      throw new IllegalArgumentException("식별자 형식 오류");
  }

  static void hash(String value) {
    if (value == null || !value.matches("[a-f0-9]{64}"))
      throw new IllegalArgumentException("SHA-256 형식 오류");
  }

  private static void text(String value) {
    if (value == null
        || value.isBlank()
        || !value.equals(value.strip())
        || value.codePoints().anyMatch(Character::isISOControl))
      throw new IllegalArgumentException("필수 문자열 누락·형식 오류");
  }

  private static List<String> codes(List<String> values) {
    values.forEach(ScoreApprovalManifest::text);
    if (new HashSet<>(values).size() != values.size())
      throw new IllegalArgumentException("지역 코드 중복");
    return values.stream().sorted(ScoreSnapshotCodec::compareCodePoints).toList();
  }

  private static OffsetDateTime utc(OffsetDateTime value) {
    return value == null ? null : value.withOffsetSameInstant(ZoneOffset.UTC);
  }

  private static ScoreInputSnapshot.BatchMetadata batch(ScoreInputSnapshot.BatchMetadata b) {
    Objects.requireNonNull(b.batchId());
    text(b.datasetCode());
    text(b.sourceType());
    text(b.scopeType());
    hash(b.sourceChecksum());
    text(b.etlVersion());
    text(b.status());
    Objects.requireNonNull(b.startedAt());
    return new ScoreInputSnapshot.BatchMetadata(
        b.batchId(),
        b.datasetCode(),
        b.sourceType(),
        b.scopeType(),
        b.scopeCode(),
        b.periodFrom(),
        b.periodTo(),
        b.sourceChecksum(),
        b.etlVersion(),
        b.status(),
        utc(b.startedAt()),
        utc(b.finishedAt()),
        utc(b.publishedAt()));
  }
}
