package kr.ac.recycleyoungs.score;

import java.math.BigInteger;

/** 승인 전 A 후보의 네 지표. 비중 정수 m은 각각 3·3·2·2이며 실제 비중은 m/10이다. */
public enum ScoreMetric {
  SALES(3, true),
  FOOT_TRAFFIC(3, true),
  STORE_COUNT(2, false),
  CLOSURE_RATE(2, false);

  private final BigInteger weightNumerator;
  private final boolean increasing;

  ScoreMetric(int weightNumerator, boolean increasing) {
    this.weightNumerator = BigInteger.valueOf(weightNumerator);
    this.increasing = increasing;
  }

  public BigInteger weightNumerator() {
    return weightNumerator;
  }

  public ExactFraction weight() {
    return new ExactFraction(weightNumerator, BigInteger.TEN);
  }

  public boolean increasing() {
    return increasing;
  }
}
