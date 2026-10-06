package com.example.backend.admindong;

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

class AdminDongTrendRequestTests {
    private MockMvc mvc;
    private AdminDongRepository repository;

    @BeforeEach
    void setup() {
        repository = mock(AdminDongRepository.class);
        when(repository.lookup()).thenReturn(new AdminDongRepository.Lookup(
            List.of(new ApiResponses.NamedCode("11110515", "청운효자동")),
            List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "CS100010", true),
                new AdminDongRepository.Industry(2, "GYM", "헬스장", null, false)), List.of()));
        mvc = MockMvcBuilders.standaloneSetup(new AdminDongController(new AdminDongService(repository)))
            .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    static MultiValueMap<String, String> valid() {
        var query = new LinkedMultiValueMap<String, String>();
        query.add("dongCode", "11110515"); query.add("industryCode", "CAFE");
        return query;
    }

    static Stream<Arguments> invalidQueries() {
        var cases = Stream.<Arguments>builder();
        for (var field : new String[]{"dongCode", "industryCode"}) {
            var missing = valid(); missing.remove(field); cases.add(Arguments.of(missing, "INVALID_PARAMETER", field));
            var empty = valid(); empty.set(field, ""); cases.add(Arguments.of(empty, "INVALID_PARAMETER", field));
            var duplicate = valid(); duplicate.add(field, duplicate.getFirst(field));
            cases.add(Arguments.of(duplicate, "INVALID_PARAMETER", field));
        }
        for (var field : new String[]{"quarterCode", "year", "foo"}) {
            var unknown = valid(); unknown.add(field, "20251"); cases.add(Arguments.of(unknown, "INVALID_PARAMETER", field));
        }
        for (var value : new String[]{"1111051", "111105150", " 11110515", "11110515 ", "１２３４５６７８", " "}) {
            var q = valid(); q.set("dongCode", value); cases.add(Arguments.of(q, "INVALID_DONG_CODE", "dongCode"));
        }
        for (var value : new String[]{"cafe", " CAFE", "CAFE ", "1CAFE", "A".repeat(31), " "}) {
            var q = valid(); q.set("industryCode", value); cases.add(Arguments.of(q, "INVALID_INDUSTRY_CODE", "industryCode"));
        }
        var unknownBeforeMissing = valid(); unknownBeforeMissing.remove("dongCode"); unknownBeforeMissing.add("quarterCode", "20251");
        cases.add(Arguments.of(unknownBeforeMissing, "INVALID_PARAMETER", "quarterCode"));
        var duplicateFirst = valid(); duplicateFirst.add("dongCode", "11110530"); duplicateFirst.add("industryCode", "PUB"); duplicateFirst.add("foo", "x");
        cases.add(Arguments.of(duplicateFirst, "INVALID_PARAMETER", "dongCode"));
        var unknownSorted = valid(); unknownSorted.add("z", "x"); unknownSorted.add("a", "x");
        cases.add(Arguments.of(unknownSorted, "INVALID_PARAMETER", "a"));
        var requiredFirst = valid(); requiredFirst.set("dongCode", "bad"); requiredFirst.remove("industryCode");
        cases.add(Arguments.of(requiredFirst, "INVALID_PARAMETER", "industryCode"));
        var formats = valid(); formats.set("dongCode", "bad"); formats.set("industryCode", "cafe");
        cases.add(Arguments.of(formats, "INVALID_DONG_CODE", "dongCode"));
        return cases.build();
    }

    @ParameterizedTest
    @MethodSource("invalidQueries")
    void strictTwoFieldQueriesFailBeforeDatabaseAccess(MultiValueMap<String, String> query, String code, String field) throws Exception {
        mvc.perform(get("/api/admin-dong-trends").params(query)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(field))
            .andExpect(jsonPath("$.message").isString()).andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)));
        verifyNoInteractions(repository);
    }

    static Stream<Arguments> unsupportedQueries() {
        var cases = Stream.<Arguments>builder();
        for (var value : new String[]{"MISSING", "CS100010", "GYM"}) {
            var q = valid(); q.set("industryCode", value);
            cases.add(Arguments.of(q, value.equals("GYM") ? "UNSUPPORTED_INDUSTRY" : "UNKNOWN_INDUSTRY", "industryCode"));
        }
        var q = valid(); q.set("dongCode", "00000000"); q.set("industryCode", "MISSING");
        cases.add(Arguments.of(q, "UNKNOWN_DONG", "dongCode"));
        return cases.build();
    }

    @ParameterizedTest
    @MethodSource("unsupportedQueries")
    void supportValidationPreservesDongIndustryPriority(MultiValueMap<String, String> query, String code, String field) throws Exception {
        mvc.perform(get("/api/admin-dong-trends").params(query)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(field));
        verify(repository).lookup(); verifyNoMoreInteractions(repository);
    }

    @Test
    void quarterCodeHasTheExistingUndefinedQueryMessage() throws Exception {
        mvc.perform(get("/api/admin-dong-trends").params(valid()).param("quarterCode", "20251"))
            .andExpect(status().isBadRequest()).andExpect(content().json("""
                {"code":"INVALID_PARAMETER","message":"정의되지 않은 요청 파라미터입니다.","field":"quarterCode"}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void integrityErrorIsAtomicEvenBeforeSupportChecks() throws Exception {
        when(repository.lookup()).thenThrow(new DataIntegrityException());
        mvc.perform(get("/api/admin-dong-trends").params(valid()).param("dongCode", "00000000"))
            .andExpect(status().isBadRequest()); // duplicate query is checked before lookup
        var q = valid(); q.set("dongCode", "00000000");
        mvc.perform(get("/api/admin-dong-trends").params(q)).andExpect(status().isInternalServerError())
            .andExpect(content().json("""
                {"code":"DATA_INTEGRITY_ERROR","message":"데이터 무결성 오류입니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void databaseFailureDoesNotLeakConnectionDetails() throws Exception {
        when(repository.lookup()).thenThrow(new IllegalStateException("secret credential SQL"));
        mvc.perform(get("/api/admin-dong-trends").params(valid())).andExpect(status().isInternalServerError())
            .andExpect(content().json("""
                {"code":"INTERNAL_ERROR","message":"서버 오류가 발생했습니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }
}
