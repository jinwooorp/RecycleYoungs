package com.example.backend.admindong;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

class RegionAndConsumptionRequestTests {
    @Test void officialCatalogContainsVerifiedDistrictPrefixesAndUtf8Names() {
        var catalog = new RegionCatalog();
        assertEquals(425, catalog.dongs().size());
        assertEquals(25, catalog.dongs().stream().map(RegionCatalog.Dong::districtCode).distinct().count());
        var dong = catalog.dongs().stream().filter(d -> d.code().equals("11110515")).findFirst().orElseThrow();
        assertEquals("청운효자동", dong.name()); assertEquals("종로구", dong.districtName());
    }

    @Test void scoreEndpointRejectsDuplicatesUnknownFieldsAndInvalidQuarterBeforeService() throws Exception {
        var service = mock(ConsumptionScoreService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new ConsumptionScoreController(service)).setControllerAdvice(new ApiExceptionHandler()).build();
        for (String codes : List.of("", "11110515,11110515", "11110515,11260550,11470670,11110530", " 11110515", "１２３４５６７８"))
            mvc.perform(get("/api/cafe-consumption-scores").param("dongCodes", codes).param("quarterCode", "20254"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
        mvc.perform(get("/api/cafe-consumption-scores").param("dongCodes", "11110515").param("quarterCode", "20255"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_QUARTER"));
        mvc.perform(get("/api/cafe-consumption-scores").param("dongCodes", "11110515").param("quarterCode", "20254").param("extra", "1"))
            .andExpect(status().isBadRequest());
        verifyNoInteractions(service);
    }

    @Test void scoreEndpointPreservesBigintStringsAndUnavailableNull() throws Exception {
        var service = mock(ConsumptionScoreService.class);
        when(service.scores(List.of("11110515"), "20254")).thenReturn(new ConsumptionScoreService.Response(
            new ApiResponses.Quarter("20254", "2025년 4분기"), ConsumptionScore.MODEL, "hash", 1, 30, "source", "UNVERIFIED",
            List.of(new ConsumptionScoreService.Item(new ApiResponses.NamedCode("11110515", "청운효자동"), "UNAVAILABLE", null, "9007199254740993", "INSUFFICIENT_COHORT"))));
        var mvc = MockMvcBuilders.standaloneSetup(new ConsumptionScoreController(service)).setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(get("/api/cafe-consumption-scores").param("dongCodes", "11110515").param("quarterCode", "20254"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].transactionCount").value("9007199254740993"))
            .andExpect(jsonPath("$.items[0].score").value(org.hamcrest.Matchers.nullValue()));
    }

    @Test void boundarySerializesGeometryAsAnObjectAndKeepsHoleRings() throws Exception {
        var service = mock(RegionService.class);
        String geometry = """
            {"type":"Polygon","coordinates":[[[126,37],[128,37],[128,38],[126,37]],[[126.5,37.2],[127,37.2],[127,37.4],[126.5,37.2]]]}
            """;
        when(service.boundary("11110515", "1")).thenReturn(new RegionService.Boundary("11110515", "청운효자동", "1", "source", 4326,
            "VALID_SOURCE", null, "UNRESOLVED", "PASSED_WITH_LIMITATIONS", null, false, geometry));
        var mvc = MockMvcBuilders.standaloneSetup(new RegionController(service)).setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(get("/api/regions/admin-dongs/11110515/boundary").param("datasetVersion", "1"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.geometry.type").value("Polygon"))
            .andExpect(jsonPath("$.geometry.coordinates.length()").value(2));
        mvc.perform(get("/api/regions/admin-dongs/11110515/boundary").param("datasetVersion", "1", "2"))
            .andExpect(status().isBadRequest());
        verify(service, times(1)).boundary("11110515", "1");
    }

    @Test void boundaryServiceRejectsStaleVersionAndNeverRepairsMissingGeometry() {
        var repository = mock(RegionRepository.class);
        var service = new RegionService(new RegionCatalog(), repository, mock(AdminDongRepository.class));
        when(repository.boundaries("11110515")).thenReturn(List.of(new RegionRepository.BoundaryRow("2", "11110515", "청운효자동",
            "REPAIRED_OPERATIONAL", "repair source preserved", "UNRESOLVED", "PASSED_WITH_LIMITATIONS", null, false, "{}")));
        var error = assertThrows(InvalidQueryException.class, () -> service.boundary("11110515", "1"));
        assertEquals("BOUNDARY_VERSION_CHANGED", error.code());
        when(repository.boundaries("11110515")).thenReturn(List.of());
        assertEquals("BOUNDARY_DATA_UNAVAILABLE", assertThrows(InvalidQueryException.class, () -> service.boundary("11110515", "2")).code());
    }

    @Test void regionStatisticsSupportIsCafeSpecificAndNotAllIndustryLookupPresence() {
        var stats = mock(AdminDongRepository.class);
        when(stats.lookup()).thenReturn(new AdminDongRepository.Lookup(List.of(new ApiResponses.NamedCode("11110515", "청운효자동")),
            List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "cafe-source", true)), List.of()));
        when(stats.supportedDongs("cafe-source")).thenReturn(List.of());
        var repository = mock(RegionRepository.class); when(repository.boundaries("")).thenReturn(List.of());
        var regions = new RegionService(new RegionCatalog(), repository, stats).regions();
        assertFalse(regions.districts().getFirst().dongs().getFirst().statisticsSupported());
        assertNull(regions.boundaryVersion());
    }
}
