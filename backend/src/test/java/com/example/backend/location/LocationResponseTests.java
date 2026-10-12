package com.example.backend.location;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.ArrayList;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class LocationResponseTests {
    @ParameterizedTest @CsvSource({"0,0,OUTSIDE_OR_UNSUPPORTED,NO_MEMBERSHIP", "1,1,RESOLVED,MEMBERSHIP", "2,3,AMBIGUOUS_BOUNDARY,MEMBERSHIP"})
    void serializesDomainResultAndIndependentVersions(int dongs, int areas, String status, String commercialStatus) throws Exception {
        var repository = mock(LocationRepository.class);
        var rows = new ArrayList<LocationRepository.BoundaryRow>();
        if (dongs == 0) rows.add(LocationServiceTests.row("ADMIN_DONG", "1", null));
        for (int i = 0; i < dongs; i++) rows.add(LocationServiceTests.row("ADMIN_DONG", "1", LocationServiceTests.match(true, i, "BOUNDARY")));
        if (areas == 0) rows.add(LocationServiceTests.row("COMMERCIAL_AREA", "2", null));
        for (int i = 0; i < areas; i++) rows.add(LocationServiceTests.row("COMMERCIAL_AREA", "2", LocationServiceTests.match(false, i, "INTERIOR")));
        when(repository.resolve(LocationServiceTests.COORDINATE)).thenReturn(rows);
        var mvc = MockMvcBuilders.standaloneSetup(new LocationController(new LocationService(repository)))
            .setControllerAdvice(new LocationExceptionHandler()).build();
        var result = mvc.perform(get("/api/locations/resolve").param("lat", "37.5665").param("lng", "126.9780"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.coordinate.lat").value(37.5665))
            .andExpect(jsonPath("$.coordinate.lng").value(126.978))
            .andExpect(jsonPath("$.adminDong.status").value(status))
            .andExpect(jsonPath("$.adminDong.dataset.version").value("1"))
            .andExpect(jsonPath("$.adminDong.dataset.referenceDate").isEmpty())
            .andExpect(jsonPath("$.adminDong.dataset.referenceDateVerified").value(false))
            .andExpect(jsonPath("$.commercialArea.status").value(commercialStatus))
            .andExpect(jsonPath("$.commercialArea.dataset.version").value("2"))
            .andExpect(jsonPath("$.commercialArea.memberships.length()").value(areas))
            .andExpect(jsonPath("$.adminDong.candidates.length()").value(dongs > 1 ? dongs : 0));
        if (dongs == 1) result.andExpect(jsonPath("$.adminDong.resolvedDong.code").value("11110510"))
            .andExpect(jsonPath("$.adminDong.resolvedDong.pointRelation").value("BOUNDARY"));
        else result.andExpect(jsonPath("$.adminDong.resolvedDong").isEmpty());
        if (dongs == 0) result.andExpect(jsonPath("$.adminDong.reason").value("NO_COVERING_OPERATIONAL_BOUNDARY"));
    }
}
