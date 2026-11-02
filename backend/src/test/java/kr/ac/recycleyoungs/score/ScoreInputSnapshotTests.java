package kr.ac.recycleyoungs.score;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatExceptionOfType;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 원본 문자열과 조회 상태를 계산기 입력으로 연결하되 공개 가능 여부는 판단하지 않는다. */
class ScoreInputSnapshotTests {
  @Test
  void convertsExactNumbersWithoutDiscardingOriginalStrings() {
    var row =
        row(
            value("9007199254740993"),
            value("1.00000000000000000001"),
            value("0"),
            value("200.00"));
    var input = row.toScoreInput().orElseThrow();
    assertThat(input.sales().number()).isEqualTo(new BigInteger("9007199254740993"));
    assertThat(input.footTraffic().number()).isEqualTo(new BigDecimal("1.00000000000000000001"));
    assertThat(input.storeCount().number()).isZero();
    assertThat(input.closureRate().number()).isEqualTo(new BigDecimal("200.00"));
    assertThat(row.closureRate().raw()).isEqualTo("200.00");
  }

  @Test
  void distinguishesMissingRowNullZeroAndNonFinite() {
    var missing =
        new ScoreInputSnapshot.RawValue(
            null, new ScoreInputSnapshot.RowSource(false, null, null, false));
    var row = row(missing, value(null), value("0"), value("NaN"));
    var input = row.toScoreInput().orElseThrow();
    assertThat(input.sales().state()).isEqualTo(ScoreInput.ValueState.ROW_MISSING);
    assertThat(input.footTraffic().state()).isEqualTo(ScoreInput.ValueState.NULL);
    assertThat(input.storeCount().state()).isEqualTo(ScoreInput.ValueState.PRESENT);
    assertThat(input.storeCount().number()).isZero();
    assertThat(input.closureRate().state()).isEqualTo(ScoreInput.ValueState.NON_FINITE);
    for (String raw : new String[] {"Infinity", "-Infinity"}) {
      assertThat(
              row(value("1"), value(raw), value("1"), value("0"))
                  .toScoreInput()
                  .orElseThrow()
                  .footTraffic()
                  .state())
          .isEqualTo(ScoreInput.ValueState.NON_FINITE);
    }
  }

  @Test
  void refusesToMislabelUnqualifiedSourceAsMissingOrNull() {
    var source = new ScoreInputSnapshot.RowSource(true, new UUID(0, 2), null, false);
    var raw = new ScoreInputSnapshot.RawValue("999", source);
    assertThat(raw.state()).isEqualTo(ScoreInputSnapshot.MeasurementState.SOURCE_NOT_ELIGIBLE);
    assertThat(row(raw, value("1"), value("1"), value("0")).toScoreInput()).isEmpty();
    assertThat(raw.raw()).isEqualTo("999");
    assertThat(raw.source().sourceBatchId()).isEqualTo(new UUID(0, 2));
  }

  @Test
  void leavesInvalidNumericTextAsMappingErrorAndNegativeValuesForCalculatorValidation() {
    assertThatExceptionOfType(NumberFormatException.class)
        .isThrownBy(() -> row(value("invalid"), value("1"), value("1"), value("0")).toScoreInput());
    assertThat(
            row(value("-1"), value("1"), value("1"), value("0"))
                .toScoreInput()
                .orElseThrow()
                .sales()
                .number())
        .isEqualTo(BigInteger.valueOf(-1));
  }

  @Test
  void defensivelyCopiesCohortAndKeepsReturnedListImmutable() {
    var rows = new ArrayList<>(List.of(row(value("1"), value("1"), value("1"), value("0"))));
    var snapshot =
        new ScoreInputSnapshot(
            ScoreCalculation.RegionUnit.DONG,
            "20262",
            "CS100010",
            null,
            false,
            new ScoreInputSnapshot.DatasetReadiness(false, false, false),
            rows);
    rows.clear();
    assertThat(snapshot.regions()).hasSize(1);
    assertThatExceptionOfType(UnsupportedOperationException.class)
        .isThrownBy(() -> snapshot.regions().clear());
  }

  private static ScoreInputSnapshot.RawValue value(String raw) {
    return new ScoreInputSnapshot.RawValue(
        raw, new ScoreInputSnapshot.RowSource(true, new UUID(0, 1), null, true));
  }

  private static ScoreInputSnapshot.RegionInput row(
      ScoreInputSnapshot.RawValue sales,
      ScoreInputSnapshot.RawValue foot,
      ScoreInputSnapshot.RawValue stores,
      ScoreInputSnapshot.RawValue closure) {
    return new ScoreInputSnapshot.RegionInput(
        "00110001", "예시동", "00110", "예시구", sales, foot, stores, closure);
  }
}
