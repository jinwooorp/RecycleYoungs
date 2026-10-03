package com.example.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.util.ArrayList;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional(readOnly = true)
class AdminDongApiTests {
    @Autowired MockMvc mvc;

    @Test
    void dongsAreAvailableMappedStatisticsSortedByStringCode() throws Exception {
        var result = mvc.perform(get("/api/admin-dongs"))
            .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("application/json"))
            .andReturn();
        var json = JsonMapper.builder().build().readTree(result.getResponse().getContentAsString());
        assertThat(json.size()).isEqualTo(425);
        var codes = new ArrayList<String>();
        json.forEach(row -> {
            assertThat(row.size()).isEqualTo(2);
            assertThat(row.get("code").isString()).isTrue();
            assertThat(row.get("name").isString()).isTrue();
            codes.add(row.get("code").asString());
        });
        assertThat(codes).isSorted().doesNotHaveDuplicates();
        assertThat(json.get(0).get("code").asString()).isEqualTo("11110515");
        assertThat(json.get(0).get("name").asString()).isEqualTo("청운효자동");
    }

    @Test
    void industriesOnlyExposeSupportedInternalCodes() throws Exception {
        mvc.perform(get("/api/industries")).andExpect(status().isOk()).andExpect(content().json("""
            [{"code":"CAFE","name":"카페"},{"code":"HAIR","name":"미용실"},
             {"code":"KFOOD","name":"한식"},{"code":"PUB","name":"주점"}]
            """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void quartersUseCodeAndLabelOnly() throws Exception {
        mvc.perform(get("/api/quarters")).andExpect(status().isOk()).andExpect(content().json("""
            [{"code":"20251","label":"2025년 1분기"},{"code":"20252","label":"2025년 2분기"},
             {"code":"20253","label":"2025년 3분기"},{"code":"20254","label":"2025년 4분기"}]
            """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void lookupEndpointsRejectUndefinedQueries() throws Exception {
        for (var path : new String[]{"/api/admin-dongs","/api/industries","/api/quarters"}) {
            mvc.perform(get(path).param("foo","bar")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
                .andExpect(jsonPath("$.message").isString()).andExpect(jsonPath("$.field").value("foo"));
        }
    }
    @Test
    void statisticsCombineExactStoreAndBigintValues() throws Exception {
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","11110515")
            .param("industryCode","CAFE").param("quarterCode","20251"))
            .andExpect(status().isOk()).andExpect(content().json("""
                {"dong":{"code":"11110515","name":"청운효자동"},
                 "industry":{"code":"CAFE","name":"카페"},
                 "quarter":{"code":"20251","label":"2025년 1분기"},
                 "storeStats":{"storeCount":114,"similarStoreCount":115,"openingStoreCount":2,
                    "closingStoreCount":4,"franchiseStoreCount":1},
                 "salesStats":{"estimatedSalesAmount":"4535266422","transactionCount":"302642",
                    "weekdayEstimatedSalesAmount":"2853077729","weekendEstimatedSalesAmount":"1682188693"},
                 "missingReasons":{"storeStats":null,"salesStats":null}}
                """, org.springframework.test.json.JsonCompareMode.STRICT))
            .andExpect(jsonPath("$.salesStats.estimatedSalesAmount").isString())
            .andExpect(jsonPath("$.salesStats.transactionCount").isString());
    }

    @Test
    void partialNoRowPreservesStoreValuesIncludingZero() throws Exception {
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","11260550")
            .param("industryCode","CAFE").param("quarterCode","20251"))
            .andExpect(status().isOk()).andExpect(content().json("""
                {"dong":{"code":"11260550","name":"면목5동"},
                 "industry":{"code":"CAFE","name":"카페"},
                 "quarter":{"code":"20251","label":"2025년 1분기"},
                 "storeStats":{"storeCount":17,"similarStoreCount":21,"openingStoreCount":0,
                    "closingStoreCount":0,"franchiseStoreCount":4},
                 "salesStats":null,"missingReasons":{"storeStats":null,"salesStats":"NO_ROW"}}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @Test
    void supportedIdentifiersWithNoCombinationReturnBothNoRows() throws Exception {
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","11470670")
            .param("industryCode","PUB").param("quarterCode","20251"))
            .andExpect(status().isOk()).andExpect(content().json("""
                {"dong":{"code":"11470670","name":"신정6동"},
                 "industry":{"code":"PUB","name":"주점"},
                 "quarter":{"code":"20251","label":"2025년 1분기"},
                 "storeStats":null,"salesStats":null,
                 "missingReasons":{"storeStats":"NO_ROW","salesStats":"NO_ROW"}}
                """, org.springframework.test.json.JsonCompareMode.STRICT));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
        "dongCode,00000000,UNKNOWN_DONG", "industryCode,MISSING,UNKNOWN_INDUSTRY",
        "industryCode,CS100010,UNKNOWN_INDUSTRY", "industryCode,GYM,UNSUPPORTED_INDUSTRY",
        "quarterCode,20261,UNSUPPORTED_QUARTER"
    })
    void invalidSupportIsNotNoRow(String field, String value, String code) throws Exception {
        var query = new org.springframework.util.LinkedMultiValueMap<String,String>();
        query.add("dongCode","11110515"); query.add("industryCode","CAFE"); query.add("quarterCode","20251");
        query.set(field,value);
        mvc.perform(get("/api/admin-dong-stats").params(query)).andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value(code)).andExpect(jsonPath("$.field").value(field))
            .andExpect(jsonPath("$.message").isString()).andExpect(jsonPath("$").value(org.hamcrest.Matchers.aMapWithSize(3)));
    }

    @Test
    void supportValidationUsesDongIndustryQuarterOrder() throws Exception {
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","00000000")
            .param("industryCode","MISSING").param("quarterCode","20261"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("UNKNOWN_DONG"));
        mvc.perform(get("/api/admin-dong-stats").param("dongCode","11110515")
            .param("industryCode","MISSING").param("quarterCode","20261"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("UNKNOWN_INDUSTRY"));
    }

}
