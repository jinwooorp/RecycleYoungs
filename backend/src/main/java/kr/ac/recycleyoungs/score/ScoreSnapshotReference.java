package kr.ac.recycleyoungs.score;

/** 형식·해시·재현을 검증한 불변 보존 입력. 구조 검증은 출처 신뢰나 승인을 뜻하지 않는다. */
public final class ScoreSnapshotReference {
  private final ScoreSnapshotBundle bundle;
  private final String fileSha256;

  private ScoreSnapshotReference(byte[] bytes) {
    byte[] captured = bytes.clone();
    bundle = ScoreSnapshotBundle.decode(captured);
    fileSha256 = ScoreSnapshotCodec.sha256(captured);
  }

  /** 경로를 보관하거나 재개방하지 않는다. 호출 중 원본 배열이 바뀌어도 캡처한 바이트만 사용한다. */
  public static ScoreSnapshotReference decode(byte[] bytes) {
    try {
      return new ScoreSnapshotReference(bytes);
    } catch (RuntimeException failure) {
      throw new IllegalArgumentException("보존 기준 형식·해시·재현 검증 실패");
    }
  }

  ScoreSnapshotBundle bundle() {
    return bundle;
  }

  /** 신뢰 검증과 DB 대조가 사용한 동일 파일 바이트를 연결하는 식별값이며 승인 증거가 아니다. */
  public String fileSha256() {
    return fileSha256;
  }

  @Override
  public String toString() {
    return "ScoreSnapshotReference[fileSha256=" + fileSha256 + "]";
  }
}
