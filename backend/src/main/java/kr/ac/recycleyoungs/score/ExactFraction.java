package kr.ac.recycleyoungs.score;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;
import java.util.Objects;

/** 점수 계산의 정확한 유리수. 소수 변환은 호출자가 출력 시점에 명시적으로 요청한다. */
public record ExactFraction(BigInteger numerator, BigInteger denominator)
    implements Comparable<ExactFraction> {
  public ExactFraction {
    Objects.requireNonNull(numerator, "numerator");
    Objects.requireNonNull(denominator, "denominator");
    if (denominator.signum() == 0) {
      throw new IllegalArgumentException("분모는 0일 수 없습니다.");
    }
    if (denominator.signum() < 0) {
      numerator = numerator.negate();
      denominator = denominator.negate();
    }
    BigInteger gcd = numerator.gcd(denominator);
    numerator = numerator.divide(gcd);
    denominator = denominator.divide(gcd);
  }

  public ExactFraction add(ExactFraction other) {
    return new ExactFraction(
        numerator.multiply(other.denominator).add(other.numerator.multiply(denominator)),
        denominator.multiply(other.denominator));
  }

  @Override
  public int compareTo(ExactFraction other) {
    return numerator.multiply(other.denominator).compareTo(other.numerator.multiply(denominator));
  }

  /** 표시 정밀도를 계산 규칙에 섞지 않도록 scale과 반올림 모드를 필수로 받는다. */
  public BigDecimal toDecimal(int scale, RoundingMode roundingMode) {
    return new BigDecimal(numerator).divide(new BigDecimal(denominator), scale, roundingMode);
  }
}
