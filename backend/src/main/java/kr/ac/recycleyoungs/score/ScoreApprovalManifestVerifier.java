package kr.ac.recycleyoungs.score;

import java.util.List;
import java.util.Objects;

/** 공개 승인이 아닌 결합 진단 전용 검증기. */
public final class ScoreApprovalManifestVerifier {
  /** manifest에서 자동 추출하지 않는 호출자 기대값. 이 ID 자체도 진위 증명은 아니다. */
  public record ExpectedReferences(
      String policyVersion,
      String policyApprovalId,
      String sourceVerificationId,
      String coverageApprovalId) {
    public ExpectedReferences {
      for (var id :
          List.of(policyVersion, policyApprovalId, sourceVerificationId, coverageApprovalId))
        ScoreApprovalManifest.identifier(id);
    }
  }

  public enum Status {
    BINDING_VERIFIED
  }

  public enum DigestComparison {
    NOT_PROVIDED,
    MATCHED
  }

  public enum SourceTrust {
    NOT_ESTABLISHED
  }

  public record Result(Status status, String manifestSha256, DigestComparison digestComparison) {
    public InternalScoreResult.PublicationState publicationState() {
      return InternalScoreResult.PublicationState.NOT_APPROVED;
    }

    public SourceTrust sourceTrust() {
      return SourceTrust.NOT_ESTABLISHED;
    }
  }

  /** 외부 해시 대조 성공도 승인 주체·배포 경로 신뢰 검증으로 승격하지 않는다. 폴백은 없다. */
  public Result verify(
      byte[] manifestJson,
      byte[] bundleJson,
      ExpectedReferences references,
      String expectedManifestSha256) {
    try {
      Objects.requireNonNull(references);
      var codec = new ScoreApprovalManifestCodec();
      var manifest = codec.decode(manifestJson);
      byte[] file = bundleJson.clone();
      var bundle = ScoreSnapshotBundle.decode(file);
      if (!manifest.fileSha256().equals(ScoreSnapshotCodec.sha256(file))
          || !references.policyVersion().equals(manifest.policyVersion())
          || !references.policyApprovalId().equals(manifest.policyApproval().approvalId())
          || !references.sourceVerificationId().equals(manifest.sourceVerification().approvalId())
          || !references.coverageApprovalId().equals(manifest.coverageApproval().approvalId()))
        throw new IllegalArgumentException();
      for (var evidence :
          List.of(
              manifest.policyApproval(),
              manifest.sourceVerification(),
              manifest.coverageApproval()))
        if (evidence.status() != ScoreApprovalManifest.ClaimedStatus.APPROVED)
          throw new IllegalArgumentException();
      check(manifest, manifest.district(), bundle.district());
      check(manifest, manifest.dong(), bundle.dong());
      String digest = codec.sha256(manifest);
      var comparison = DigestComparison.NOT_PROVIDED;
      if (expectedManifestSha256 != null) {
        ScoreApprovalManifest.hash(expectedManifestSha256);
        if (!expectedManifestSha256.equals(digest)) throw new IllegalArgumentException();
        comparison = DigestComparison.MATCHED;
      }
      return new Result(Status.BINDING_VERIFIED, digest, comparison);
    } catch (RuntimeException error) {
      // 원본 입력·근거 URL·담당자·원본 예외를 외부 오류에 포함하지 않는다.
      throw new IllegalArgumentException("manifest·입력 결합 검증 실패");
    }
  }

  private static void check(
      ScoreApprovalManifest manifest,
      ScoreApprovalManifest.CohortBinding binding,
      ScoreSnapshotArtifact artifact) {
    var p = artifact.payload();
    if (!manifest.quarterCode().equals(p.input().quarterCode())
        || !manifest.industryCode().equals(p.input().industryCode())
        || !manifest.algorithmVersion().equals(p.algorithmVersion())
        || !manifest.policy().equals(p.policy())
        || binding.unit() != p.input().unit()
        || !binding.inputSnapshotId().equals(artifact.inputSnapshotId())
        || !binding.boundaryRegionCodes().equals(p.boundaryRegionCodes())
        || !binding.eligibleRegionCodes().equals(p.eligibleRegionCodes())
        || !binding.excludedRegions().equals(p.excludedRegions())
        || !binding.batches().equals(p.batches())) throw new IllegalArgumentException();
  }
}
