package com.example.backend.openapi;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
        + "org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration"
})
@AutoConfigureMockMvc
class OpenApiDisabledTests {
    @Autowired MockMvc mvc;
    @MockitoBean JdbcClient jdbc;

    @Test void documentationEndpointsAreDisabledByDefault() throws Exception {
        for (var path : new String[]{"/api/docs", "/api/v3/api-docs", "/api/v3/api-docs.yaml", "/api/v3/api-docs/swagger-config",
            "/api/swagger-ui/index.html", "/swagger-ui/index.html", "/swagger-ui.html",
            "/v3/api-docs", "/v3/api-docs.yaml", "/v3/api-docs/swagger-config"})
            mvc.perform(get(path)).andExpect(status().isNotFound());
        verifyNoInteractions(jdbc);
    }
}
