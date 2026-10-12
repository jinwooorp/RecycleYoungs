package com.example.backend.location;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;

class LocationRequestTests {
    private LocationService service;
    private MockMvc mvc;

    @BeforeEach void setup() {
        service = mock(LocationService.class);
        mvc = MockMvcBuilders.standaloneSetup(new LocationController(service))
            .setControllerAdvice(new LocationExceptionHandler()).build();
    }

    static MultiValueMap<String, String> valid() {
        var query = new LinkedMultiValueMap<String, String>();
        query.add("lat", "37.5665"); query.add("lng", "126.9780");
        return query;
    }

    static Stream<Arguments> invalidQueries() {
        var cases = Stream.<Arguments>builder();
        for (var field : new String[]{"lat", "lng"}) {
            var missing = valid(); missing.remove(field);
            cases.add(Arguments.of(missing, "INVALID_PARAMETER", field));
            var duplicate = valid(); duplicate.add(field, "0");
            cases.add(Arguments.of(duplicate, "INVALID_PARAMETER", field));
            var empty = valid(); empty.set(field, "");
            cases.add(Arguments.of(empty, "INVALID_PARAMETER", field));
            for (var value : new String[]{"abc", "NaN", "Infinity", "-Infinity", "1e999", "1e-999", " 37", "37 ", "0x1p0", "37f", "１２", "1;SELECT", "0".repeat(65)}) {
                var bad = valid(); bad.set(field, value);
                cases.add(Arguments.of(bad, "INVALID_COORDINATE", field));
            }
        }
        for (var value : new String[]{"90.0001", "-90.0001", "90.000000000000000001", "-90.000000000000000001"}) {
            var bad = valid(); bad.set("lat", value); cases.add(Arguments.of(bad, "INVALID_COORDINATE", "lat"));
        }
        for (var value : new String[]{"180.0001", "-180.0001", "180.000000000000000001", "-180.000000000000000001"}) {
            var bad = valid(); bad.set("lng", value); cases.add(Arguments.of(bad, "INVALID_COORDINATE", "lng"));
        }
        var unknown = valid(); unknown.add("industryCode", "CAFE");
        cases.add(Arguments.of(unknown, "INVALID_PARAMETER", "industryCode"));
        return cases.build();
    }

    @ParameterizedTest @MethodSource("invalidQueries")
    void rejectsBeforeService(MultiValueMap<String, String> query, String code, String field) throws Exception {
        mvc.perform(get("/api/locations/resolve").params(query)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(field))
            .andExpect(jsonPath("$.message").isString())
            .andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)));
        verifyNoInteractions(service);
    }

    @Test void bindsLatitudeAndLongitudeInOrder() throws Exception {
        mvc.perform(get("/api/locations/resolve").params(valid())).andExpect(status().isOk());
        verify(service).resolve(new LocationResponses.Coordinate(37.5665, 126.978));
    }

    @ParameterizedTest @MethodSource("validCoordinates")
    void acceptsFiniteDecimalCoordinates(String lat, String lng) throws Exception {
        mvc.perform(get("/api/locations/resolve").param("lat", lat).param("lng", lng)).andExpect(status().isOk());
        verify(service).resolve(new LocationResponses.Coordinate(Double.parseDouble(lat), Double.parseDouble(lng)));
    }

    static Stream<Arguments> validCoordinates() {
        return Stream.of(Arguments.of("-90", "-180"), Arguments.of("90", "180"),
            Arguments.of("0", "0"), Arguments.of("3.75665e1", "1.26978e2"));
    }

    @Test void unavailableIs503() throws Exception {
        when(service.resolve(any())).thenThrow(new BoundaryDataUnavailableException());
        mvc.perform(get("/api/locations/resolve").params(valid())).andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.code").value("BOUNDARY_DATA_UNAVAILABLE")).andExpect(jsonPath("$.field").isEmpty());
    }

    @Test void integrityIs500() throws Exception {
        when(service.resolve(any())).thenThrow(new com.example.backend.admindong.DataIntegrityException());
        mvc.perform(get("/api/locations/resolve").params(valid())).andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.code").value("DATA_INTEGRITY_ERROR"));
    }

    @Test void internalErrorDoesNotLeakDetails() throws Exception {
        when(service.resolve(any())).thenThrow(new IllegalStateException("private SQL credential"));
        mvc.perform(get("/api/locations/resolve").params(valid())).andExpect(status().isInternalServerError())
            .andExpect(content().json("""
                {"code":"INTERNAL_ERROR","message":"서버 오류가 발생했습니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }
}
