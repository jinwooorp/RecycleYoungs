package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import java.math.BigInteger;
import java.math.RoundingMode;
import org.junit.jupiter.api.Test;

/** 분수의 약분·부호·정확한 비교를 검증한다. */
class ExactFractionTests {
  @Test
  void reducesFractionsNormalizesSignAndCanonicalizesZero() {
    assertThat(fraction(6, -8)).isEqualTo(fraction(-3, 4));
    assertThat(fraction(-6, -8)).isEqualTo(fraction(3, 4));
    assertThat(fraction(0, -8).numerator()).isZero();
    assertThat(fraction(0, -8).denominator()).isOne();
    assertThatIllegalArgumentException().isThrownBy(() -> fraction(1, 0));
  }

  @Test
  void addsWithoutTruncatingOrRoundingRepeatingDecimals() {
    assertThat(fraction(1, 3).add(fraction(1, 6))).isEqualTo(fraction(1, 2));
    assertThat(fraction(1, 3).toDecimal(12, RoundingMode.HALF_UP).toPlainString())
        .isEqualTo("0.333333333333");
    assertThat(fraction(2, 3).toDecimal(12, RoundingMode.HALF_UP).toPlainString())
        .isEqualTo("0.666666666667");
  }

  @Test
  void comparesLargeCloseFractionsExactly() {
    var huge = BigInteger.TEN.pow(100);
    assertThat(new ExactFraction(huge.add(BigInteger.ONE), huge))
        .isGreaterThan(new ExactFraction(huge.add(BigInteger.TWO), huge.add(BigInteger.ONE)));
    assertThat(fraction(-1, 3)).isLessThan(fraction(0, 1));
    assertThat(fraction(2, 6).compareTo(fraction(1, 3))).isZero();
  }

  private static ExactFraction fraction(long numerator, long denominator) {
    return new ExactFraction(BigInteger.valueOf(numerator), BigInteger.valueOf(denominator));
  }
}
