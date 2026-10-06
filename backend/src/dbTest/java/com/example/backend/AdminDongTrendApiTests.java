package com.example.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
class AdminDongTrendApiTests {
    @Autowired MockMvc mvc;

    private JsonNode trend(String dong, String industry) throws Exception {
        var result = mvc.perform(get("/api/admin-dong-trends").param("dongCode", dong).param("industryCode", industry))
            .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("application/json")).andReturn();
        return JsonMapper.builder().build().readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private static void axis(JsonNode body) {
        assertThat(body.size()).isEqualTo(3);
        var quarters = body.get("quarters");
        assertThat(quarters.size()).isEqualTo(4);
        for (int i = 0; i < 4; i++) {
            assertThat(quarters.get(i).size()).isEqualTo(4);
            assertThat(quarters.get(i).get("quarter").size()).isEqualTo(2);
            assertThat(quarters.get(i).get("quarter").get("code").asString()).isEqualTo("2025" + (i + 1));
            assertThat(quarters.get(i).get("quarter").get("label").asString()).isEqualTo("2025년 " + (i + 1) + "분기");
        }
    }

    @Test
    void cheongunAllNineMetricsMatchTheContractAndSingleQuarterApi() throws Exception {
        var body = trend("11110515", "CAFE");
        axis(body);
        assertThat(body.get("dong").get("name").asString()).isEqualTo("청운효자동");
        String[] storeFields = {"storeCount", "similarStoreCount", "openingStoreCount", "closingStoreCount", "franchiseStoreCount"};
        int[][] stores = {{114,115,2,4,1}, {114,115,2,2,1}, {115,116,2,2,1}, {118,119,5,2,1}};
        String[] salesFields = {"estimatedSalesAmount", "transactionCount", "weekdayEstimatedSalesAmount", "weekendEstimatedSalesAmount"};
        String[][] sales = {
            {"4535266422","302642","2853077729","1682188693"},
            {"4603714789","356622","2868971210","1734743579"},
            {"4195134430","293013","2897027346","1298107084"},
            {"4724282512","340786","2941978790","1782303722"}
        };
        for (int i = 0; i < 4; i++) {
            var row = body.get("quarters").get(i);
            assertThat(row.get("storeStats").size()).isEqualTo(5);
            assertThat(row.get("salesStats").size()).isEqualTo(4);
            for (int j = 0; j < storeFields.length; j++) {
                assertThat(row.get("storeStats").get(storeFields[j]).asInt()).isEqualTo(stores[i][j]);
            }
            for (int j = 0; j < salesFields.length; j++) {
                var value = row.get("salesStats").get(salesFields[j]);
                assertThat(value.isString()).isTrue();
                assertThat(value.asString()).isEqualTo(sales[i][j]);
            }
            assertThat(row.get("missingReasons").get("storeStats").isNull()).isTrue();
            assertThat(row.get("missingReasons").get("salesStats").isNull()).isTrue();
            var single = mvc.perform(get("/api/admin-dong-stats").param("dongCode","11110515")
                .param("industryCode","CAFE").param("quarterCode","2025" + (i + 1)))
                .andExpect(status().isOk()).andReturn();
            var json = JsonMapper.builder().build().readTree(single.getResponse().getContentAsString(StandardCharsets.UTF_8));
            for (var field : new String[]{"quarter", "storeStats", "salesStats", "missingReasons"}) {
                assertThat(row.get(field)).isEqualTo(json.get(field));
            }
        }
    }

    @Test
    void duncheonFirstQuarterZeroAndMissingSalesDoNotHideLaterRows() throws Exception {
        var body = trend("11740690", "CAFE"); axis(body);
        int[] stores = {0,3,7,8};
        String[] amounts = {null,"452140306","452142858","452142858"};
        String[] counts = {null,"82613","70594","70417"};
        for (int i = 0; i < 4; i++) {
            var row = body.get("quarters").get(i);
            assertThat(row.get("storeStats").get("storeCount").asInt()).isEqualTo(stores[i]);
            assertThat(row.get("missingReasons").get("storeStats").isNull()).isTrue();
            if (i == 0) {
                assertThat(row.get("salesStats").isNull()).isTrue();
                assertThat(row.get("missingReasons").get("salesStats").asString()).isEqualTo("NO_ROW");
            } else {
                assertThat(row.get("salesStats").get("estimatedSalesAmount").asString()).isEqualTo(amounts[i]);
                assertThat(row.get("salesStats").get("transactionCount").asString()).isEqualTo(counts[i]);
                assertThat(row.get("missingReasons").get("salesStats").isNull()).isTrue();
            }
        }
    }

    @Test
    void myeonmokKeepsFourStoreRowsAndFourMissingSalesSections() throws Exception {
        var body = trend("11260550", "CAFE"); axis(body);
        int[] counts = {17,16,16,15};
        for (int i = 0; i < 4; i++) {
            var row = body.get("quarters").get(i);
            assertThat(row.get("storeStats").get("storeCount").asInt()).isEqualTo(counts[i]);
            assertThat(row.get("missingReasons").get("storeStats").isNull()).isTrue();
            assertThat(row.get("salesStats").isNull()).isTrue();
            assertThat(row.get("missingReasons").get("salesStats").asString()).isEqualTo("NO_ROW");
        }
    }

    @Test
    void sinjeongPubAllMissingIsStillHttp200WithFourItems() throws Exception {
        var body = trend("11470670", "PUB"); axis(body);
        assertThat(body.get("dong").get("name").asString()).isEqualTo("신정6동");
        assertThat(body.get("industry").get("code").asString()).isEqualTo("PUB");
        for (var row : body.get("quarters")) {
            assertThat(row.get("storeStats").isNull()).isTrue();
            assertThat(row.get("salesStats").isNull()).isTrue();
            assertThat(row.get("missingReasons").get("storeStats").asString()).isEqualTo("NO_ROW");
            assertThat(row.get("missingReasons").get("salesStats").asString()).isEqualTo("NO_ROW");
        }
    }
}
