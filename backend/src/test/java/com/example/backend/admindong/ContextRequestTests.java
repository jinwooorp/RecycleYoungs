package com.example.backend.admindong;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class ContextRequestTests {
    private MockMvc mvc;
    private AdminDongContextService context;
    private AdminDongSalesBreakdownService breakdown;
    @BeforeEach void setup() {
        context=mock(AdminDongContextService.class);breakdown=mock(AdminDongSalesBreakdownService.class);
        mvc=MockMvcBuilders.standaloneSetup(new AdminDongContextController(context),new AdminDongSalesBreakdownController(breakdown))
            .setControllerAdvice(new ApiExceptionHandler()).build();
    }
    @Test void contextMissingVersionAndDuplicateQueriesNeverReachService() throws Exception {
        mvc.perform(get("/api/admin-dong-context").param("dongCode","11110515").param("quarterCode","20251"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.field").value("dataVersion"));
        mvc.perform(get("/api/admin-dong-context").param("dongCode","11110515").param("quarterCode","20251","20251")
            .param("dataVersion","legacy-unversioned")).andExpect(status().isBadRequest());
        verifyNoInteractions(context);
    }
    @Test void contextUnavailableChangedAndIntegrityHaveStableCommonErrors() throws Exception {
        for (var test:Map.of(503,new ContextUnavailableException(),409,new DataVersionChangedException(),500,new DataIntegrityException()).entrySet()) {
            doThrow(test.getValue()).when(context).context(any());
            String code=test.getKey()==503?"CONTEXT_UNAVAILABLE":test.getKey()==409?"DATA_VERSION_CHANGED":"DATA_INTEGRITY_ERROR";
            mvc.perform(get("/api/admin-dong-context").param("dongCode","11110515").param("quarterCode","20251").param("dataVersion","legacy-unversioned"))
                .andExpect(status().is(test.getKey())).andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").isEmpty())
                .andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)));
        }
    }
    @Test void breakdownRejectsMissingDuplicateAndExtraScopeQueries() throws Exception {
        mvc.perform(get("/api/admin-dong-sales-breakdown").param("dongCode","11110515").param("quarterCode","20251")
            .param("dataVersion","legacy-unversioned")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.field").value("industryCode"));
        mvc.perform(get("/api/admin-dong-sales-breakdown").param("dongCode","11110515").param("industryCode","CAFE")
            .param("quarterCode","20251").param("dataVersion","legacy-unversioned").param("lat","37.5"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.field").value("lat"));
        verifyNoInteractions(breakdown);
    }
    @Test void legacyBreakdownNoRowKeepsNullAndOmitsPublicationMetadata() throws Exception {
        when(breakdown.breakdown(any())).thenReturn(new ContextResponses.Breakdown(
            new ApiResponses.NamedCode("11110515","청운효자동"),new ApiResponses.NamedCode("CAFE","카페"),
            new ApiResponses.Quarter("20251","2025년 1분기"),null,"NO_ROW",null));
        mvc.perform(get("/api/admin-dong-sales-breakdown").param("dongCode","11110515").param("industryCode","CAFE")
            .param("quarterCode","20251").param("dataVersion","legacy-unversioned"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.sales").isEmpty()).andExpect(jsonPath("$.missingReason").value("NO_ROW"))
            .andExpect(jsonPath("$.metadata").doesNotExist());
    }
}
