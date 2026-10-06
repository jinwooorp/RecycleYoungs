package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class AdminDongTrendTests {
    private MockMvc mvc;
    private JdbcClient jdbc;
    private AdminDongRepository repository;
    private JdbcClient.StatementSpec storeStatement;
    private JdbcClient.StatementSpec salesStatement;
    private List<Map.Entry<String, AdminDongRepository.StoreRow>> stores;
    private List<Map.Entry<String, AdminDongRepository.SalesRow>> sales;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setup() {
        stores = List.of(); sales = List.of();
        jdbc = mock(JdbcClient.class);
        storeStatement = mock(JdbcClient.StatementSpec.class);
        salesStatement = mock(JdbcClient.StatementSpec.class);
        var storeResult = mock(JdbcClient.MappedQuerySpec.class);
        var salesResult = mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(argThat(sql -> sql != null && sql.contains("FROM store_stats_dong")))).thenReturn(storeStatement);
        when(jdbc.sql(argThat(sql -> sql != null && sql.contains("FROM sales_dong")))).thenReturn(salesStatement);
        when(storeStatement.param(anyString(), any())).thenReturn(storeStatement);
        when(salesStatement.param(anyString(), any())).thenReturn(salesStatement);
        when(storeStatement.query(any(RowMapper.class))).thenReturn(storeResult);
        when(salesStatement.query(any(RowMapper.class))).thenReturn(salesResult);
        when(storeResult.list()).thenAnswer(invocation -> stores);
        when(salesResult.list()).thenAnswer(invocation -> sales);
        repository = spy(new AdminDongRepository(jdbc));
        doReturn(new AdminDongRepository.Lookup(List.of(new ApiResponses.NamedCode("11110515", "최신 이름")),
            List.of(new AdminDongRepository.Industry(1, "CAFE", "카페", "CS100010", true)),
            List.of(new ApiResponses.Quarter("20261", "2026년 1분기")))).when(repository).lookup();
        mvc = MockMvcBuilders.standaloneSetup(new AdminDongController(new AdminDongService(repository)))
            .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void fixedAxisIsOrderedDespiteUnorderedRowsAndFutureLookup() throws Exception {
        var row = new AdminDongRepository.StoreRow(10, 11, 0, 1, 2);
        stores = List.of(Map.entry("20254", row), Map.entry("20251", row));
        sales = List.of(Map.entry("20252", new AdminDongRepository.SalesRow(123L, 0L, null, -123L)));
        mvc.perform(get("/api/admin-dong-trends").params(AdminDongTrendRequestTests.valid()))
            .andExpect(status().isOk()).andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)))
            .andExpect(jsonPath("$.dong.name").value("최신 이름"))
            .andExpect(jsonPath("$.industry.code").value("CAFE"))
            .andExpect(jsonPath("$.quarters.length()").value(4))
            .andExpect(jsonPath("$.quarters[0].quarter.code").value("20251"))
            .andExpect(jsonPath("$.quarters[1].quarter.code").value("20252"))
            .andExpect(jsonPath("$.quarters[2].quarter.code").value("20253"))
            .andExpect(jsonPath("$.quarters[3].quarter.code").value("20254"))
            .andExpect(jsonPath("$.quarters[0].quarter.label").value("2025년 1분기"))
            .andExpect(jsonPath("$.quarters[1].quarter.label").value("2025년 2분기"))
            .andExpect(jsonPath("$.quarters[2].quarter.label").value("2025년 3분기"))
            .andExpect(jsonPath("$.quarters[3].quarter.label").value("2025년 4분기"))
            .andExpect(jsonPath("$.quarters[0].storeStats.storeCount").value(10))
            .andExpect(jsonPath("$.quarters[0].salesStats").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[0].missingReasons.salesStats").value("NO_ROW"))
            .andExpect(jsonPath("$.quarters[1].storeStats").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[1].missingReasons.storeStats").value("NO_ROW"))
            .andExpect(jsonPath("$.quarters[1].salesStats.estimatedSalesAmount").value("123"))
            .andExpect(jsonPath("$.quarters[2].storeStats").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[2].salesStats").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[2].missingReasons.storeStats").value("NO_ROW"))
            .andExpect(jsonPath("$.quarters[2].missingReasons.salesStats").value("NO_ROW"))
            .andExpect(jsonPath("$.quarters[3].storeStats.storeCount").value(10));
        verify(repository).lookup();
        verify(repository, never()).store(anyString(), anyString(), anyString());
        verify(repository, never()).sales(anyString(), anyString(), anyString());
        var sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).sql(sql.capture());
        assertThat(sql.getAllValues()).allSatisfy(value -> {
            assertThat(value).contains("quarter_code IN (:quarters)", "ORDER BY quarter_code");
        });
        verify(storeStatement).param("quarters", List.of(20251, 20252, 20253, 20254));
        verify(salesStatement).param("quarters", List.of(20251, 20252, 20253, 20254));
    }

    @Test
    void allMissingRowsAreAValidFourItemResource() throws Exception {
        var result = mvc.perform(get("/api/admin-dong-trends").params(AdminDongTrendRequestTests.valid()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.quarters.length()").value(4));
        for (int i = 0; i < 4; i++) {
            result.andExpect(jsonPath("$.quarters[" + i + "].storeStats").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.quarters[" + i + "].salesStats").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.quarters[" + i + "].missingReasons.storeStats").value("NO_ROW"))
                .andExpect(jsonPath("$.quarters[" + i + "].missingReasons.salesStats").value("NO_ROW"));
        }
    }

    @Test
    void nullableMetricsZeroAndSignedBigintsKeepTheirTypes() throws Exception {
        stores = List.of(Map.entry("20251", new AdminDongRepository.StoreRow(null, 0, null, null, null)));
        sales = List.of(Map.entry("20251", new AdminDongRepository.SalesRow(Long.MAX_VALUE, Long.MIN_VALUE, 0L, null)));
        mvc.perform(get("/api/admin-dong-trends").params(AdminDongTrendRequestTests.valid()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.quarters[0].storeStats").value(org.hamcrest.Matchers.aMapWithSize(5)))
            .andExpect(jsonPath("$.quarters[0].storeStats.storeCount").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[0].storeStats.similarStoreCount").value(0))
            .andExpect(jsonPath("$.quarters[0].salesStats").value(org.hamcrest.Matchers.aMapWithSize(4)))
            .andExpect(jsonPath("$.quarters[0].salesStats.estimatedSalesAmount").value("9223372036854775807"))
            .andExpect(jsonPath("$.quarters[0].salesStats.transactionCount").value("-9223372036854775808"))
            .andExpect(jsonPath("$.quarters[0].salesStats.weekdayEstimatedSalesAmount").value("0"))
            .andExpect(jsonPath("$.quarters[0].salesStats.weekendEstimatedSalesAmount").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[0].missingReasons.storeStats").value(org.hamcrest.Matchers.nullValue()))
            .andExpect(jsonPath("$.quarters[0].missingReasons.salesStats").value(org.hamcrest.Matchers.nullValue()));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void duplicateQueryRowsFailTheWholeResourceWithoutSchemaBypass(boolean store) throws Exception {
        if (store) {
            var row = new AdminDongRepository.StoreRow(1, 1, 0, 0, 0);
            stores = List.of(Map.entry("20252", row), Map.entry("20252", row));
        } else {
            var row = new AdminDongRepository.SalesRow(1L, 1L, 0L, 0L);
            sales = List.of(Map.entry("20252", row), Map.entry("20252", row));
        }
        mvc.perform(get("/api/admin-dong-trends").params(AdminDongTrendRequestTests.valid()))
            .andExpect(status().isInternalServerError()).andExpect(content().json("""
                {"code":"DATA_INTEGRITY_ERROR","message":"데이터 무결성 오류입니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    @SuppressWarnings("unchecked")
    void failureInSecondStatisticsQueryNeverReturnsTheFirstHalf() throws Exception {
        when(salesStatement.query(any(RowMapper.class))).thenThrow(new IllegalStateException("secret query"));
        mvc.perform(get("/api/admin-dong-trends").params(AdminDongTrendRequestTests.valid()))
            .andExpect(status().isInternalServerError()).andExpect(content().json("""
                {"code":"INTERNAL_ERROR","message":"서버 오류가 발생했습니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }
}
