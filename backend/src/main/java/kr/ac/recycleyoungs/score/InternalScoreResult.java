package kr.ac.recycleyoungs.score;

import java.util.List;
import java.util.Objects;

/** 승인 전 내부 진단 결과. 공개 응답 DTO가 아니며 계산 성공은 게시 승인을 뜻하지 않는다. */
public record InternalScoreResult(
    Request request,
    Status status,
    ScoreInputSnapshot snapshot,
    Integer eligibleCount,
    List<ExcludedRegion> excluded,
    List<Reason> reasons,
    List<ScoreCalculation.RegionScore> cohortScores,
    ScoreCalculation.RegionScore selectedScore) {
  public InternalScoreResult {
    Objects.requireNonNull(request, "request");
    Objects.requireNonNull(status, "status");
    excluded = List.copyOf(excluded);
    reasons = List.copyOf(reasons);
    cohortScores = List.copyOf(cohortScores);
  }

  /** 승인 아티팩트 검증을 아직 구현하지 않았으므로 생성자나 요청으로 승인 상태를 바꿀 수 없다. */
  public PublicationState publicationState() {
    return PublicationState.NOT_APPROVED;
  }

  public enum PublicationState {
    NOT_APPROVED
  }

  public enum Status {
    INTERNAL_CALCULATED,
    NOT_CALCULABLE,
    BOUNDARY_NOT_READY,
    REGION_NOT_FOUND,
    DATASET_NOT_READY,
    UNSUPPORTED_INPUT,
    DATABASE_UNAVAILABLE,
    INTERNAL_ERROR
  }

  /** 입력 사유의 선언 순서는 기존 계약의 안정 정렬 순서다. 집단 사유는 별도로 앞에 배치한다. */
  public enum ReasonCode {
    UNSUPPORTED_INPUT,
    BOUNDARY_NOT_READY,
    REGION_NOT_FOUND,
    DATASET_NOT_READY,
    INSUFFICIENT_COHORT,
    CONSTANT_INDICATOR,
    INPUT_ROW_MISSING,
    INPUT_NULL,
    INPUT_NEGATIVE,
    INPUT_NON_FINITE,
    ZERO_STORE_COUNT,
    SOURCE_NOT_ELIGIBLE,
    DATABASE_UNAVAILABLE,
    INTERNAL_ERROR
  }

  public record Request(
      ScoreCalculation.RegionUnit unit,
      String regionCode,
      String quarterCode,
      String industryCode) {}

  /** 집단·미준비 사유의 metric은 null이며 특정 지표의 사유는 해당 지표를 지정한다. */
  public record Reason(ReasonCode code, ScoreMetric metric) {}

  public record ExcludedRegion(String regionCode, List<Reason> reasons) {
    public ExcludedRegion {
      reasons = List.copyOf(reasons);
    }
  }
}
