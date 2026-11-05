package kr.ac.recycleyoungs.score;

import java.util.Arrays;

/** DB·파일 없이 구·동 전체 입력을 기존 정규 payload와 입력 ID로 정확히 대조한다. */
public final class ScoreInputComparison {
  private ScoreInputComparison() {}

  public enum Status {
    MATCHED,
    INPUT_MISMATCH,
    REFERENCE_INVALID,
    DATA_NOT_READY,
    DATABASE_UNAVAILABLE,
    INTERNAL_ERROR
  }

  public static Status compare(
      ScoreSnapshotReference reference, ScoreInputSnapshot district, ScoreInputSnapshot dong) {
    if (reference == null) return Status.REFERENCE_INVALID;
    if (district == null || dong == null) return Status.INTERNAL_ERROR;
    var expected = reference.bundle();
    if (!scope(expected.district(), district) || !scope(expected.dong(), dong))
      return Status.INPUT_MISMATCH;
    try {
      // 기존 보존 가능 조건을 공유한다. 개별 행의 결측·0·부적격과 전체 자료 미준비를 구분한다.
      ScoreSnapshotArtifact.requireReady(district);
      ScoreSnapshotArtifact.requireReady(dong);
    } catch (IllegalArgumentException failure) {
      return Status.DATA_NOT_READY;
    }
    try {
      return equal(expected.district(), district) && equal(expected.dong(), dong)
          ? Status.MATCHED
          : Status.INPUT_MISMATCH;
    } catch (RuntimeException failure) {
      // 모순된 현재 출처·숫자 형식 오류를 단순 결측이나 정상 0점으로 숨기지 않는다.
      return Status.INTERNAL_ERROR;
    }
  }

  private static boolean scope(ScoreSnapshotArtifact expected, ScoreInputSnapshot current) {
    var input = expected.payload().input();
    return current.unit() == input.unit()
        && input.quarterCode().equals(current.quarterCode())
        && input.industryCode().equals(current.industryCode());
  }

  private static boolean equal(ScoreSnapshotArtifact expected, ScoreInputSnapshot current) {
    // 요청 시각은 입력 해시 대상이 아니다. 이 진단에서 새 아티팩트를 저장하거나 게시하지 않는다.
    var actual =
        ScoreSnapshotArtifact.capture(
            current,
            current.regions().stream().map(ScoreInputSnapshot.RegionInput::regionCode).toList(),
            null);
    var codec = new ScoreSnapshotCodec();
    return expected.inputSnapshotId().equals(actual.inputSnapshotId())
        && Arrays.equals(
            codec.canonicalPayload(expected.payload()), codec.canonicalPayload(actual.payload()));
  }
}
