package com.example.backend.nearby;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.List;
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

class NearbyRequestTests {
    private NearbyService service;
    private MockMvc mvc;
    @BeforeEach void setup() {
        service = mock(NearbyService.class);
        mvc = MockMvcBuilders.standaloneSetup(new NearbyController(service)).setControllerAdvice(new NearbyExceptionHandler()).build();
    }
    static MultiValueMap<String, String> valid() {
        var q = new LinkedMultiValueMap<String, String>();
        q.add("lat", "37.5665"); q.add("lng", "126.978"); q.add("radius", "500"); q.add("industryCode", "CAFE");
        return q;
    }
    static Stream<Arguments> invalidQueries() {
        var cases = Stream.<Arguments>builder();
        for (var field : List.of("lat", "lng", "radius", "industryCode")) {
            var missing = valid(); missing.remove(field); cases.add(Arguments.of(missing, "INVALID_PARAMETER", field));
            var duplicate = valid(); duplicate.add(field, "500"); cases.add(Arguments.of(duplicate, "INVALID_PARAMETER", field));
            var empty = valid(); empty.set(field, ""); cases.add(Arguments.of(empty, "INVALID_PARAMETER", field));
        }
        for (var field : List.of("lat", "lng")) {
            for (var value : List.of("abc", "NaN", "Infinity", "-Infinity", "1e999", "1e-999", " 37", "37 ", "0x1p0", "37f", "１２", "1;SELECT", "0".repeat(65))) {
                var q = valid(); q.set(field, value); cases.add(Arguments.of(q, "INVALID_COORDINATE", field));
            }
        }
        for (var value : List.of("90.0001", "-90.0001", "90.000000000000000001")) {
            var q = valid(); q.set("lat", value); cases.add(Arguments.of(q, "INVALID_COORDINATE", "lat"));
        }
        for (var value : List.of("180.0001", "-180.0001", "180.000000000000000001")) {
            var q = valid(); q.set("lng", value); cases.add(Arguments.of(q, "INVALID_COORDINATE", "lng"));
        }
        for (var value : List.of("0", "-500", "501", "NaN", "Infinity", "abc", "500.0", "0500", " 500")) {
            var q = valid(); q.set("radius", value); cases.add(Arguments.of(q, "UNSUPPORTED_RADIUS", "radius"));
        }
        for (var value : List.of("PUB", "I21201", "CS100010", "cafe", " CAFE")) {
            var q = valid(); q.set("industryCode", value); cases.add(Arguments.of(q, "UNSUPPORTED_INDUSTRY", "industryCode"));
        }
        var q = valid(); q.add("limit", "1"); cases.add(Arguments.of(q, "INVALID_PARAMETER", "limit"));
        return cases.build();
    }
    @ParameterizedTest @MethodSource("invalidQueries")
    void rejectsBeforeService(MultiValueMap<String, String> query, String code, String field) throws Exception {
        mvc.perform(get("/api/nearby-stores").params(query)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(field))
            .andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)));
        verifyNoInteractions(service);
    }
    @Test void exposesNearbyEndpoint() throws Exception {
        var result = NearbyServiceTests.result(0);
        when(service.find(any())).thenReturn(result);
        mvc.perform(get("/api/nearby-stores").params(valid())).andExpect(status().isOk())
            .andExpect(jsonPath("$.totalCount").value("0")).andExpect(jsonPath("$.data.snapshotStatus").value("UNVERIFIED"))
            .andExpect(jsonPath("$.data.referenceDate").value(org.hamcrest.Matchers.nullValue()));
        verify(service).find(NearbyServiceTests.QUERY);
    }
    @Test void allowsGlobalCoordinateLimits() {
        var q = valid(); q.set("lat", "-90"); q.set("lng", "180");
        org.assertj.core.api.Assertions.assertThat(NearbyQueryValidator.validate(q).coordinate())
            .isEqualTo(new NearbyResponses.Coordinate(-90, 180));
    }
    static Stream<Arguments> errors() {
        return Stream.of(Arguments.of(new NearbyDataUnavailableException("STORES_DATA_UNAVAILABLE"), 503, "STORES_DATA_UNAVAILABLE"),
            Arguments.of(new NearbyDataUnavailableException("CAFE_MAPPING_UNAVAILABLE"), 503, "CAFE_MAPPING_UNAVAILABLE"),
            Arguments.of(new NearbyDataUnavailableException("CAFE_DATA_UNAVAILABLE"), 503, "CAFE_DATA_UNAVAILABLE"),
            Arguments.of(new com.example.backend.admindong.DataIntegrityException(), 500, "DATA_INTEGRITY_ERROR"),
            Arguments.of(new IllegalStateException("private SQL credential"), 500, "INTERNAL_ERROR"));
    }
    @ParameterizedTest @MethodSource("errors")
    void errorsAreSafe(RuntimeException error, int statusCode, String code) throws Exception {
        when(service.find(any())).thenThrow(error);
        mvc.perform(get("/api/nearby-stores").params(valid())).andExpect(status().is(statusCode))
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("private"))));
    }
}
