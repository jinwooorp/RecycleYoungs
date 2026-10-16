package com.example.backend.admindong;

import static org.junit.jupiter.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ChangeScoreTests {
    private List<ConsumptionScore.Row> rows(long value) {
        var rows = new ArrayList<ConsumptionScore.Row>();
        for (int i = 0; i < 30; i++) rows.add(new ConsumptionScore.Row("11000" + String.format("%03d", i), value));
        return rows;
    }
    @Test void exactTiesAndNegativeDirection() {
        var current = rows(50); var previous = rows(100);
        current.set(0, new ConsumptionScore.Row("11000000", 90L));
        var result = ChangeScore.evaluate("11000000", current, previous);
        assertEquals(100, result.score()); assertEquals("-10.0000", result.changeRate());
        assertEquals("DECREASE", result.direction());
        assertEquals(48, ChangeScore.evaluate("11000001", current, previous).score());
    }
    @Test void zeroCurrentIsValidButZeroPreviousIsNot() {
        assertEquals("-100.0000", ChangeScore.evaluate("11000000", rows(0), rows(1)).changeRate());
        assertEquals("ZERO_PREVIOUS", ChangeScore.evaluate("11000000", rows(1), rows(0)).reason());
    }
    @Test void ranksBeyondDoublePrecisionExactly() {
        var current = rows(9007199254740992L); var previous = rows(9007199254740992L);
        current.set(0, new ConsumptionScore.Row("11000000", 9007199254740993L));
        assertEquals(100, ChangeScore.evaluate("11000000", current, previous).score());
        assertEquals("INCREASE", ChangeScore.evaluate("11000000", current, previous).direction());
    }
    @Test void absentNullNegativeAndSmallCohortStayDistinct() {
        var current = rows(1); var previous = rows(1);
        assertEquals("NO_ROW_CURRENT", ChangeScore.evaluate("11999999", current, previous).reason());
        previous.removeFirst();
        assertEquals("NO_ROW_PREVIOUS", ChangeScore.evaluate("11000000", current, previous).reason());
        assertEquals("INSUFFICIENT_COHORT", ChangeScore.evaluate("11000001", current, previous).reason());
        current.set(1, new ConsumptionScore.Row("11000001", null));
        assertEquals("NULL_CURRENT", ChangeScore.evaluate("11000001", current, previous).reason());
        current.set(1, new ConsumptionScore.Row("11000001", -1L));
        assertEquals("INVALID_CURRENT", ChangeScore.evaluate("11000001", current, previous).reason());
    }
    @Test void duplicateRowsFailAndYearBoundaryIsImmediate() {
        var current = rows(1); current.add(current.getFirst());
        assertThrows(DataIntegrityException.class, () -> ChangeScore.evaluate("11000000", current, rows(1)));
        assertEquals("20244", ChangeScore.previousQuarter("20251"));
        assertEquals("20253", ChangeScore.previousQuarter("20254"));
    }
}
