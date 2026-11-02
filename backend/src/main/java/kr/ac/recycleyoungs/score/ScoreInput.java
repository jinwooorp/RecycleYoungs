package kr.ac.recycleyoungs.score;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Objects;

/** 한 지역의 원본 입력. 조회·게시 검증은 호출자의 책임이며 문자열 식별자는 추정하지 않는다. */
public record ScoreInput(
    String regionCode,
    Value<BigInteger> sales,
    Value<BigDecimal> footTraffic,
    Value<BigInteger> storeCount,
    Value<BigDecimal> closureRate) {
  public ScoreInput {
    if (regionCode == null || regionCode.isBlank()) {
      throw new IllegalArgumentException("지역 코드는 비어 있을 수 없습니다.");
    }
    Objects.requireNonNull(sales, "sales");
    Objects.requireNonNull(footTraffic, "footTraffic");
    Objects.requireNonNull(storeCount, "storeCount");
    Objects.requireNonNull(closureRate, "closureRate");
  }

  /** BigDecimal로 표현할 수 없는 NaN·Infinity는 조회 경계에서 NON_FINITE로 전달한다. */
  public enum ValueState {
    PRESENT,
    ROW_MISSING,
    NULL,
    NON_FINITE
  }

  /** 결측 상태를 숫자 0과 분리한다. PRESENT만 실제 숫자를 가지며 원본 BigDecimal scale을 보존한다. */
  public record Value<T extends Number>(ValueState state, T number) {
    public Value {
      Objects.requireNonNull(state, "state");
      if ((state == ValueState.PRESENT) != (number != null)) {
        throw new IllegalArgumentException("PRESENT 상태에만 값이 필요합니다.");
      }
    }

    public static <T extends Number> Value<T> present(T number) {
      return new Value<>(ValueState.PRESENT, Objects.requireNonNull(number, "number"));
    }

    public static <T extends Number> Value<T> rowMissing() {
      return new Value<>(ValueState.ROW_MISSING, null);
    }

    public static <T extends Number> Value<T> nullValue() {
      return new Value<>(ValueState.NULL, null);
    }

    public static <T extends Number> Value<T> nonFinite() {
      return new Value<>(ValueState.NON_FINITE, null);
    }
  }

  Value<? extends Number> value(ScoreMetric metric) {
    return switch (metric) {
      case SALES -> sales;
      case FOOT_TRAFFIC -> footTraffic;
      case STORE_COUNT -> storeCount;
      case CLOSURE_RATE -> closureRate;
    };
  }

  BigDecimal numericValue(ScoreMetric metric) {
    Number number = value(metric).number();
    return number instanceof BigInteger integer ? new BigDecimal(integer) : (BigDecimal) number;
  }
}
