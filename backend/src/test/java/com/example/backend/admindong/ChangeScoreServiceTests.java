package com.example.backend.admindong;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ChangeScoreServiceTests {
    private AdminDongRepository repository(boolean previous) {
        var repository = mock(AdminDongRepository.class);
        when(repository.lookup()).thenReturn(new AdminDongRepository.Lookup(List.of(),
            List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "source", true)),
            previous ? List.of(new ApiResponses.Quarter("20251", "2025년 1분기"), new ApiResponses.Quarter("20244", "2024년 4분기"))
                : List.of(new ApiResponses.Quarter("20251", "2025년 1분기"))));
        when(repository.consumptionRows(anyString(), anyString())).thenReturn(List.of());
        return repository;
    }
    @Test void readsOnlyImmediatePreviousAndPreservesCatalogDongNoRow() {
        var repository = repository(true);
        var result = new ChangeScoreService(repository, new RegionCatalog()).scores(List.of("11110515"), "20251");
        assertEquals("20244", result.previousQuarterCode()); assertEquals("NO_ROW_CURRENT", result.items().getFirst().reason());
        assertNull(result.items().getFirst().score());
        verify(repository).consumptionRows("source", "20251"); verify(repository).consumptionRows("source", "20244");
    }
    @Test void missingPreviousQuarterNeverFallsBackToAnotherQuarter() {
        var repository = repository(false);
        when(repository.consumptionRows("source", "20251")).thenReturn(List.of(new ConsumptionScore.Row("11110515", 0L)));
        var result = new ChangeScoreService(repository, new RegionCatalog()).scores(List.of("11110515"), "20251");
        assertEquals("PREVIOUS_QUARTER_UNAVAILABLE", result.items().getFirst().reason());
        verify(repository, never()).consumptionRows("source", "20244");
        assertThrows(InvalidQueryException.class, () -> new ChangeScoreService(repository, new RegionCatalog()).scores(List.of("11999999"), "20251"));
    }
    @Test void currentDataProblemsTakePriorityOverMissingPreviousQuarter() {
        var repository = repository(false);
        var service = new ChangeScoreService(repository, new RegionCatalog());
        assertEquals("NO_ROW_CURRENT", service.scores(List.of("11110515"), "20251").items().getFirst().reason());
        when(repository.consumptionRows("source", "20251")).thenReturn(List.of(new ConsumptionScore.Row("11110515", null)));
        assertEquals("NULL_CURRENT", service.scores(List.of("11110515"), "20251").items().getFirst().reason());
        when(repository.consumptionRows("source", "20251")).thenReturn(List.of(new ConsumptionScore.Row("11110515", -1L)));
        assertEquals("INVALID_CURRENT", service.scores(List.of("11110515"), "20251").items().getFirst().reason());
    }
    @Test void historicalPeriodsUseImmediateQuarterAndKeepTheSameScoreModel() {
        for (var pair : List.of(List.of("20212", "20211"), List.of("20221", "20214"), List.of("20251", "20244"))) {
            var repository = repository(true);
            when(repository.lookup()).thenReturn(new AdminDongRepository.Lookup(List.of(),
                List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "source", true)),
                pair.stream().map(q -> new ApiResponses.Quarter(q, q)).toList()));
            var current = new ArrayList<ConsumptionScore.Row>();
            current.add(new ConsumptionScore.Row("11110515", 110L));
            new RegionCatalog().dongs().stream().filter(d -> !d.code().equals("11110515")).limit(29)
                .forEach(d -> current.add(new ConsumptionScore.Row(d.code(), 100L)));
            when(repository.consumptionRows("source", pair.get(0))).thenReturn(current);
            when(repository.consumptionRows("source", pair.get(1))).thenReturn(current.stream()
                .map(r -> new ConsumptionScore.Row(r.dongCode(), 100L)).toList());
            var result = new ChangeScoreService(repository, new RegionCatalog()).scores(List.of("11110515"), pair.get(0));
            assertEquals(pair.get(1), result.previousQuarterCode());
            assertEquals("110", result.items().getFirst().currentCount());
            assertEquals("100", result.items().getFirst().previousCount());
            assertEquals(100, result.items().getFirst().score());
            assertEquals("10.0000", result.items().getFirst().changeRate());
            assertEquals("INCREASE", result.items().getFirst().direction());
            assertEquals(ChangeScore.MODEL, result.modelVersion());
            verify(repository).consumptionRows("source", pair.get(1));
        }
    }
    @Test void firstHistoricalQuarterKeepsScaleScoreWhileChangeHasNoComparison() {
        var repository = repository(false);
        when(repository.lookup()).thenReturn(new AdminDongRepository.Lookup(List.of(),
            List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "source", true)),
            List.of(new ApiResponses.Quarter("20211", "2021년 1분기"))));
        var rows = new ArrayList<ConsumptionScore.Row>();
        rows.add(new ConsumptionScore.Row("11110515", 0L));
        new RegionCatalog().dongs().stream().filter(d -> !d.code().equals("11110515")).limit(29)
            .forEach(d -> rows.add(new ConsumptionScore.Row(d.code(), 100L)));
        when(repository.consumptionRows("source", "20211")).thenReturn(rows);
        var scale = new ConsumptionScoreService(repository, new RegionCatalog()).scores(List.of("11110515"), "20211");
        var change = new ChangeScoreService(repository, new RegionCatalog()).scores(List.of("11110515"), "20211");
        assertEquals(0, scale.items().getFirst().score());
        assertEquals("AVAILABLE", scale.items().getFirst().status());
        assertEquals("0", change.items().getFirst().currentCount());
        assertEquals("20204", change.previousQuarterCode());
        assertNull(change.items().getFirst().score());
        assertEquals("PREVIOUS_QUARTER_UNAVAILABLE", change.items().getFirst().reason());
        verify(repository, never()).consumptionRows("source", "20204");
    }
    @Test void baselineIgnoresRowOrderButChangesWithEitherPeriod() {
        var repository = repository(true);
        var current = new ArrayList<>(List.of(new ConsumptionScore.Row("11110515", 11L), new ConsumptionScore.Row("11110530", 20L)));
        when(repository.consumptionRows("source", "20251")).thenAnswer(i -> List.copyOf(current));
        when(repository.consumptionRows("source", "20244")).thenReturn(List.of(new ConsumptionScore.Row("11110515", 10L)));
        var service = new ChangeScoreService(repository, new RegionCatalog());
        String baseline = service.scores(List.of("11110515"), "20251").baselineId();
        java.util.Collections.reverse(current);
        assertEquals(baseline, service.scores(List.of("11110515"), "20251").baselineId());
        when(repository.consumptionRows("source", "20244")).thenReturn(List.of(new ConsumptionScore.Row("11110515", 9L)));
        assertNotEquals(baseline, service.scores(List.of("11110515"), "20251").baselineId());
    }
    @Test void requestValidationAndErrorsUseCommonContract() throws Exception {
        var service = mock(ChangeScoreService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new ChangeScoreController(service)).setControllerAdvice(new ApiExceptionHandler()).build();
        for (String codes : List.of("", "11110515,11110515", "11110515,11260550,11470670,11110530", " 11110515"))
            mvc.perform(get("/api/cafe-change-scores").param("dongCodes", codes).param("quarterCode", "20254"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
        mvc.perform(get("/api/cafe-change-scores").param("dongCodes", "11110515").param("quarterCode", "20254", "20253")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/cafe-change-scores").param("dongCodes", "11110515").param("quarterCode", "20255")).andExpect(status().isBadRequest());
        verifyNoInteractions(service);
        when(service.scores(anyList(), anyString())).thenThrow(new DataIntegrityException());
        mvc.perform(get("/api/cafe-change-scores").param("dongCodes", "11110515").param("quarterCode", "20254"))
            .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.code").value("DATA_INTEGRITY_ERROR"));
    }
}
