package com.example.backend.admindong;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ConsumptionScoreTests {
    @Test void ranksExactBigintsAndTiesWithoutFloatingPointConversion() {
        var values = LongStream.range(0, 30).map(i -> 9007199254740992L + i).boxed().toList();
        assertEquals(0, ConsumptionScore.percentile(values.getFirst(), values));
        assertEquals(100, ConsumptionScore.percentile(values.getLast(), values));
        assertEquals(50, ConsumptionScore.percentile(0L, java.util.Collections.nCopies(30, 0L)));
        assertEquals(50, ConsumptionScore.percentile(1L, List.of(0L, 1L, 1L, 2L)));
    }
    @Test void separatesMissingInvalidAndInsufficientCohortFromZero() {
        assertNull(ConsumptionScore.percentile(null, List.of(0L, 1L)));
        assertNull(ConsumptionScore.percentile(-1L, List.of(0L, 1L)));
        assertNull(ConsumptionScore.percentile(0L, List.of(0L)));
        assertEquals(0, ConsumptionScore.percentile(0L, List.of(0L, 1L)));
    }
    @Test void rejectsDuplicateCodesAndPreservesNullAndNoRowReasons() {
        var rows = new ArrayList<ConsumptionScore.Row>();
        for (int i = 0; i < 30; i++) rows.add(new ConsumptionScore.Row(String.format("11110%03d", i), (long)i));
        assertEquals(100, ConsumptionScore.evaluate("11110029", rows).score());
        assertEquals("NO_ROW", ConsumptionScore.evaluate("11110515", rows).reason());
        rows.add(new ConsumptionScore.Row("11110515", null));
        assertEquals("NULL_VALUE", ConsumptionScore.evaluate("11110515", rows).reason());
        rows.add(new ConsumptionScore.Row("11110515", 1L));
        assertThrows(DataIntegrityException.class, () -> ConsumptionScore.evaluate("11110515", rows));
    }
}
