package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DataPublicationTests {
    @Test void legacyModeDoesNotTouchCatalogAndNeverLabelsLegacyAsVerified() {
        var jdbc=mock(JdbcClient.class);var p=new DataPublication(jdbc,false);
        assertThat(p.metadata()).isNull();assertThat(p.sql("SELECT * FROM sales_dong")).contains("FROM sales_dong");
        assertThatThrownBy(()->p.requireVersion("a".repeat(64))).isInstanceOf(DataVersionChangedException.class);
        verifyNoInteractions(jdbc);
    }
    @Test @SuppressWarnings("unchecked") void apiModeRejectsMissingPointerWithoutLegacyFallback() {
        var jdbc=mock(JdbcClient.class); var stmt=mock(JdbcClient.StatementSpec.class);
        var rows=mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(stmt);when(stmt.query(any(RowMapper.class))).thenReturn(rows);
        when(rows.list()).thenReturn(List.of()); var p=new DataPublication(jdbc,true);
        assertThatThrownBy(p::metadata).isInstanceOf(DataIntegrityException.class);
        assertThat(p.sql("SELECT * FROM sales_dong JOIN store_stats_dong USING(dong_code)"))
            .contains("FROM published_sales_dong","JOIN published_store_stats_dong");
    }
    @Test void statsPinMismatchReturns409BeforeFetchingAnyMetric() throws Exception {
        var repo=mock(AdminDongRepository.class);
        when(repo.lookup()).thenReturn(new AdminDongRepository.Lookup(
            List.of(new ApiResponses.NamedCode("11110515","합성동")),
            List.of(new AdminDongRepository.Industry(1,"CAFE","카페","CS100010",true)),
            List.of(new ApiResponses.Quarter("20261","2026년 1분기"))));
        when(repo.requireVersion(anyString())).thenThrow(new DataVersionChangedException());
        var mvc=MockMvcBuilders.standaloneSetup(new AdminDongController(new AdminDongService(repo)))
            .setControllerAdvice(new ApiExceptionHandler()).build();
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","11110515").param("industryCode","CAFE")
                .param("quarterCode","20261").param("dataVersion","a".repeat(64)))
            .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DATA_VERSION_CHANGED"));
        verify(repo,never()).store(anyString(),anyString(),anyString());
        verify(repo,never()).sales(anyString(),anyString(),anyString());
    }
    @Test void queryVersionMustBeSingleAndCanonical() {
        var q=AdminDongTrendRequestTests.valid();q.add("dataVersion","a".repeat(64));
        assertThat(QueryValidator.trends(q).dataVersion()).isEqualTo("a".repeat(64));
        q.add("dataVersion","b".repeat(64));
        assertThatThrownBy(()->QueryValidator.trends(q)).isInstanceOf(InvalidQueryException.class);
    }
}
