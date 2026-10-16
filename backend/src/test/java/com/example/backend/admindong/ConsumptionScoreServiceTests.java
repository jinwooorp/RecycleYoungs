package com.example.backend.admindong;

import java.util.List;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class ConsumptionScoreServiceTests {
    @Test void validOfficialDongWithoutAnyStatisticsReturnsNoRowInsteadOfUnknownDong() {
        var repository = mock(AdminDongRepository.class);
        when(repository.lookup()).thenReturn(new AdminDongRepository.Lookup(List.of(),
            List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "CS100010", true)),
            List.of(new ApiResponses.Quarter("20254", "2025년 4분기"))));
        when(repository.consumptionRows("CS100010", "20254")).thenReturn(List.of());
        var result = new ConsumptionScoreService(repository, new RegionCatalog()).scores(List.of("11110515"), "20254");
        assertEquals("NO_ROW", result.items().getFirst().reason());
        assertEquals("UNAVAILABLE", result.items().getFirst().status());
        assertNull(result.items().getFirst().score());
        assertEquals("청운효자동", result.items().getFirst().dong().name());
    }
}
