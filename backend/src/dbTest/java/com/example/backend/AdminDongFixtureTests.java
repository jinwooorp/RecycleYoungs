package com.example.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

// Opt-in, disposable DB only. Test writes are rolled back and must never target the populated DB.
@SpringBootTest(properties = "spring.flyway.enabled=false")
@AutoConfigureMockMvc
@EnabledIfEnvironmentVariable(named = "API_FIXTURE_TEST", matches = "true")
@EnabledIfEnvironmentVariable(named = "DB_NAME", matches = "recycleyoungs_api_fixture_.*")
@Transactional
class AdminDongFixtureTests {
    @Autowired MockMvc mvc;
    @Autowired JdbcClient jdbc;

    @BeforeEach
    void rejectPersistentDbBeforeAnyFixtureWrite() {
        assertThat(jdbc.sql("SELECT current_database()").query(String.class).single())
            .startsWith("recycleyoungs_api_fixture_");
        assertThat(jdbc.sql("SELECT count(*) FROM store_stats_dong").query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT count(*) FROM sales_dong").query(Long.class).single()).isZero();
    }

    private void store(int quarter, String dong, String name, String source) {
        jdbc.sql("""
            INSERT INTO store_stats_dong(quarter_code,dong_code,dong_name,source_industry_code,industry_id)
            SELECT :quarter,:dong,:name,im.source_code,im.industry_id
            FROM industry_mappings im WHERE im.source='SEOUL' AND im.source_code=:source
            """).param("quarter",quarter).param("dong",dong).param("name",name).param("source",source).update();
    }

    private void sales() {
        jdbc.sql("""
            INSERT INTO sales_dong(quarter_code,dong_code,dong_name,source_industry_code,industry_id,
                sales_amount,transaction_count,weekday_sales_amount,weekend_sales_amount)
            SELECT 20251,'11110515','매출 이름',source_code,industry_id,9007199254740993,0,NULL,-9007199254740993
            FROM industry_mappings WHERE source='SEOUL' AND source_code='CS100010'
            """).update();
    }

    @Test
    void emptyDatabaseProvidesEmptyLookupArrays() throws Exception {
        for (var path : new String[]{"/api/admin-dongs","/api/industries","/api/quarters"}) {
            mvc.perform(get(path)).andExpect(status().isOk()).andExpect(content().json("[]"));
        }
    }

    @Test
    void nullMetricsZeroAndBigintRemainDifferentInHttpJson() throws Exception {
        store(20251,"11110515","점포 이름","CS100010");
        jdbc.sql("UPDATE store_stats_dong SET similar_store_count=0").update();
        sales();
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","11110515")
            .param("industryCode","CAFE").param("quarterCode","20251"))
            .andExpect(status().isOk()).andExpect(content().json("""
                {"dong":{"code":"11110515","name":"점포 이름"},"industry":{"code":"CAFE","name":"카페"},
                 "quarter":{"code":"20251","label":"2025년 1분기"},
                 "storeStats":{"storeCount":null,"similarStoreCount":0,"openingStoreCount":null,
                    "closingStoreCount":null,"franchiseStoreCount":null},
                 "salesStats":{"estimatedSalesAmount":"9007199254740993","transactionCount":"0",
                    "weekdayEstimatedSalesAmount":null,"weekendEstimatedSalesAmount":"-9007199254740993"},
                 "missingReasons":{"storeStats":null,"salesStats":null}}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void latestQuarterNameWinsAndStoresWinWithinSameQuarter() throws Exception {
        store(20244,"11110515","옛 이름","CS100010");
        sales();
        mvc.perform(get("/api/admin-dongs")).andExpect(content().json("""
            [{"code":"11110515","name":"매출 이름"}]
            """));
        store(20251,"11110515","점포 이름","CS100010");
        mvc.perform(get("/api/admin-dongs")).andExpect(content().json("""
            [{"code":"11110515","name":"점포 이름"}]
            """));
    }

    @Test
    void ambiguousSeoulMappingIsNotSelectedOrAggregated() throws Exception {
        store(20251,"11110515","이름","CS100010");
        jdbc.sql("""
            INSERT INTO industry_mappings(source,source_code,industry_id)
            SELECT 'SEOUL','EXTRA_CAFE',id FROM industries WHERE code='CAFE'
            """).update();
        integrityForAllEndpoints();
    }

    @Test
    void mismatchedIndustryLinkIsRejected() throws Exception {
        store(20251,"11110515","이름","CS100010");
        jdbc.sql("UPDATE store_stats_dong SET industry_id=(SELECT id FROM industries WHERE code='PUB')").update();
        integrityForAllEndpoints();
    }

    @Test
    void nullIndustryLinkForMappedSourceIsRejected() throws Exception {
        store(20251,"11110515","이름","CS100010");
        jdbc.sql("UPDATE store_stats_dong SET industry_id=NULL").update();
        integrityForAllEndpoints();
    }

    @Test
    void conflictingDongNamesWithinOneTableAndQuarterAreRejected() throws Exception {
        store(20251,"11110515","이름","CS100010");
        store(20251,"11110515","충돌","CS100009");
        integrityForAllEndpoints();
    }

    @Test
    void conflictingSalesNamesAreAlsoRejected() throws Exception {
        sales();
        jdbc.sql("""
            INSERT INTO sales_dong(quarter_code,dong_code,dong_name,source_industry_code,industry_id)
            SELECT 20251,'11110515','충돌',source_code,industry_id
            FROM industry_mappings WHERE source='SEOUL' AND source_code='CS100009'
            """).update();
        integrityForAllEndpoints();
    }

    @Test
    void unmappedStatisticsDoNotExpandLookupScope() throws Exception {
        jdbc.sql("""
            INSERT INTO store_stats_dong(quarter_code,dong_code,dong_name,source_industry_code)
            VALUES (20244,'99999999','미매핑','RAW_UNKNOWN')
            """).update();
        emptyDatabaseProvidesEmptyLookupArrays();
    }

    @Test
    void invalidStoredQuarterIsNotMadeIntoAValidLabel() throws Exception {
        store(20255,"11110515","이름","CS100010");
        integrityForAllEndpoints();
    }

    private void integrityForAllEndpoints() throws Exception {
        for (var path : new String[]{"/api/admin-dongs","/api/industries","/api/quarters","/api/admin-dong-stats"}) {
            var request=get(path);
            if (path.endsWith("stats")) request.param("dongCode","11110515").param("industryCode","CAFE").param("quarterCode","20251");
            mvc.perform(request).andExpect(status().isInternalServerError()).andExpect(content().json("""
                {"code":"DATA_INTEGRITY_ERROR","message":"데이터 무결성 오류입니다.","field":null}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
        }
    }
}
