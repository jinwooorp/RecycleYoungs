package com.example.backend.admindong;

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

class AdminDongRequestTests {
    private MockMvc mvc;
    private AdminDongService service;

    @BeforeEach
    void setup() {
        service = mock(AdminDongService.class);
        mvc = MockMvcBuilders.standaloneSetup(new AdminDongController(service))
            .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    static MultiValueMap<String,String> valid() {
        var query = new LinkedMultiValueMap<String,String>();
        query.add("dongCode","11110515"); query.add("industryCode","CAFE"); query.add("quarterCode","20251");
        return query;
    }

    static Stream<Arguments> invalidQueries() {
        var cases = Stream.<Arguments>builder();
        for (var field : new String[]{"dongCode","industryCode","quarterCode"}) {
            var missing=valid(); missing.remove(field); cases.add(Arguments.of(missing,"INVALID_PARAMETER",field));
            var empty=valid(); empty.set(field,""); cases.add(Arguments.of(empty,"INVALID_PARAMETER",field));
            var duplicate=valid(); duplicate.add(field,duplicate.getFirst(field));
            cases.add(Arguments.of(duplicate,"INVALID_PARAMETER",field));
        }
        var unknown=valid(); unknown.add("foo","bar"); cases.add(Arguments.of(unknown,"INVALID_PARAMETER","foo"));
        for (var value : new String[]{"1111051","111105150"," 11110515","11110515 ","１２３４５６７８"}) {
            var q=valid(); q.set("dongCode",value); cases.add(Arguments.of(q,"INVALID_DONG_CODE","dongCode"));
        }
        for (var value : new String[]{"cafe"," CAFE","CAFE ","1CAFE","A".repeat(31)}) {
            var q=valid(); q.set("industryCode",value); cases.add(Arguments.of(q,"INVALID_INDUSTRY_CODE","industryCode"));
        }
        for (var value : new String[]{"20255","2025-Q1","02051","20251 ","202511"}) {
            var q=valid(); q.set("quarterCode",value); cases.add(Arguments.of(q,"INVALID_QUARTER","quarterCode"));
        }
        var structure=valid(); structure.add("quarterCode","20252"); structure.remove("dongCode");
        cases.add(Arguments.of(structure,"INVALID_PARAMETER","quarterCode"));
        var required=valid(); required.set("dongCode","bad"); required.remove("industryCode");
        cases.add(Arguments.of(required,"INVALID_PARAMETER","industryCode"));
        var formats=valid(); formats.set("dongCode","bad"); formats.set("industryCode","cafe");
        cases.add(Arguments.of(formats,"INVALID_DONG_CODE","dongCode"));
        var duplicates=valid(); duplicates.add("dongCode","11110530"); duplicates.add("industryCode","PUB");
        cases.add(Arguments.of(duplicates,"INVALID_PARAMETER","dongCode"));
        return cases.build();
    }

    @ParameterizedTest
    @MethodSource("invalidQueries")
    void strictQueriesFollowStructureRequiredFormatPriority(MultiValueMap<String,String> query, String code, String field)
        throws Exception {
        mvc.perform(get("/api/admin-dong-stats").params(query)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(field))
            .andExpect(jsonPath("$.message").isString()).andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)));
        verifyNoInteractions(service);
    }

    @Test
    void internalFailureDoesNotExposeDetails() throws Exception {
        when(service.dongs()).thenThrow(new IllegalStateException("secret credential SQL"));
        mvc.perform(get("/api/admin-dongs")).andExpect(status().isInternalServerError())
            .andExpect(content().json("""
                {"code":"INTERNAL_ERROR","message":"서버 오류가 발생했습니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void integrityFailureIsNotOverwrittenByGenericHandler() throws Exception {
        when(service.dongs()).thenThrow(new DataIntegrityException());
        mvc.perform(get("/api/admin-dongs")).andExpect(status().isInternalServerError())
            .andExpect(content().json("""
                {"code":"DATA_INTEGRITY_ERROR","message":"데이터 무결성 오류입니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }
}
