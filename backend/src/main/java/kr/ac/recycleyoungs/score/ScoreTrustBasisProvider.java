package kr.ac.recycleyoungs.score;

/** 외부 운영 주체가 독립 기준을 한 번에 읽어 제공하는 계약. 저장·발급·환경변수 구현은 제공하지 않는다. */
@FunctionalInterface
public interface ScoreTrustBasisProvider {
  /**
   * 각 조회는 일관된 불변 기준을 반환해야 한다. 진위·최신성·이력 보존은 공급자 책임이며, 내용이 바뀌면 되돌림을 포함해 changeId를 재사용하지 않는다.
   * 예외·null은 캐시된 과거 기준으로 대체하지 않는다.
   */
  Snapshot read() throws Exception;

  record Snapshot(
      String changeId,
      String activeReleaseId,
      ScoreTrustRecord.ReleaseStatus releaseStatus,
      String expectedTrustSha256,
      Long minimumRevision,
      PreviousRecord previous) {
    @Override
    public String toString() {
      return "ScoreTrustBasisProvider.Snapshot[redacted]";
    }
  }

  /** 입력 파일에서 만들어 채우지 않는 독립 이전 기준. 기록의 철회 이력도 그대로 기존 검증기에 전달한다. */
  record PreviousRecord(ScoreTrustRecord record, String expectedSha256) {
    @Override
    public String toString() {
      return "ScoreTrustBasisProvider.PreviousRecord[redacted]";
    }
  }
}
