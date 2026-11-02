package kr.ac.recycleyoungs.score;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Stream;

/** 한 트랜잭션에서 조회한 내부 원본 자료. 계산 가능·커버리지 승인·공개 여부를 뜻하지 않는다. */
public record ScoreInputSnapshot(
    ScoreCalculation.RegionUnit unit,
    String quarterCode,
    String industryCode,
    BatchMetadata boundary,
    boolean boundaryRowsPresent,
    DatasetReadiness readiness,
    List<RegionInput> regions) {
  public ScoreInputSnapshot {
    Objects.requireNonNull(unit, "unit");
    Objects.requireNonNull(quarterCode, "quarterCode");
    Objects.requireNonNull(industryCode, "industryCode");
    Objects.requireNonNull(readiness, "readiness");
    regions = List.copyOf(regions);
  }

  /** 전체 데이터셋에서 정상 출처를 참조하는 실제 행의 존재 여부. 요청 분기·업종 완비와 다르다. */
  public record DatasetReadiness(boolean stores, boolean sales, boolean footTraffic) {}

  /** 재현에 필요한 출처 메타데이터. 인증정보·로컬 경로·오류 원문은 읽거나 전달하지 않는다. */
  public record BatchMetadata(
      UUID batchId,
      String datasetCode,
      String sourceType,
      String scopeType,
      String scopeCode,
      String periodFrom,
      String periodTo,
      String sourceChecksum,
      String etlVersion,
      String status,
      OffsetDateTime startedAt,
      OffsetDateTime finishedAt,
      OffsetDateTime publishedAt) {}

  /** 통계 행의 존재·실제 source_batch_id·메타데이터·정상 출처 판정을 보존한다. */
  public record RowSource(
      boolean rowPresent, UUID sourceBatchId, BatchMetadata batch, boolean eligible) {}

  public enum MeasurementState {
    ROW_MISSING,
    SOURCE_NOT_ELIGIBLE,
    NULL,
    NON_FINITE,
    PRESENT
  }

  /** 부적격 출처의 원본도 내부 검증용으로만 보존한다. 이 모델을 공개 응답으로 직렬화하지 않는다. */
  public record RawValue(String raw, RowSource source) {
    public RawValue {
      Objects.requireNonNull(source, "source");
    }

    public MeasurementState state() {
      if (!source.rowPresent()) return MeasurementState.ROW_MISSING;
      if (!source.eligible()) return MeasurementState.SOURCE_NOT_ELIGIBLE;
      if (raw == null) return MeasurementState.NULL;
      return switch (raw) {
        case "NaN", "Infinity", "-Infinity" -> MeasurementState.NON_FINITE;
        default -> MeasurementState.PRESENT;
      };
    }

    private <T extends Number> ScoreInput.Value<T> toValue(Function<String, T> parser) {
      return switch (state()) {
        case ROW_MISSING -> ScoreInput.Value.rowMissing();
        case NULL -> ScoreInput.Value.nullValue();
        case NON_FINITE -> ScoreInput.Value.nonFinite();
        case PRESENT -> ScoreInput.Value.present(parser.apply(raw));
        case SOURCE_NOT_ELIGIBLE -> throw new IllegalStateException("부적격 출처는 계산 입력으로 변환할 수 없습니다.");
      };
    }
  }

  /** 전체 경계에 속한 한 지역. 숫자 문자열과 결측·출처 상태를 버리지 않고 전달한다. */
  public record RegionInput(
      String regionCode,
      String regionName,
      String districtCode,
      String districtName,
      RawValue sales,
      RawValue footTraffic,
      RawValue storeCount,
      RawValue closureRate) {
    public RegionInput {
      Objects.requireNonNull(regionCode, "regionCode");
      Objects.requireNonNull(regionName, "regionName");
      Objects.requireNonNull(districtCode, "districtCode");
      Objects.requireNonNull(districtName, "districtName");
      Objects.requireNonNull(sales, "sales");
      Objects.requireNonNull(footTraffic, "footTraffic");
      Objects.requireNonNull(storeCount, "storeCount");
      Objects.requireNonNull(closureRate, "closureRate");
    }

    /**
     * 부적격 출처는 기존 ScoreInput에 대응 상태가 없으므로 변환하지 않는다. 호출자는 이를 제외 사유로 유지해야 하며 Optional.empty를 행 없음이나
     * NULL로 대체하면 안 된다. 실제 0·음수 판정은 계산기에 맡긴다.
     */
    public Optional<ScoreInput> toScoreInput() {
      if (Stream.of(sales, footTraffic, storeCount, closureRate)
          .anyMatch(v -> v.state() == MeasurementState.SOURCE_NOT_ELIGIBLE))
        return Optional.empty();
      return Optional.of(
          new ScoreInput(
              regionCode,
              sales.toValue(BigInteger::new),
              footTraffic.toValue(BigDecimal::new),
              storeCount.toValue(BigInteger::new),
              closureRate.toValue(BigDecimal::new)));
    }
  }
}
