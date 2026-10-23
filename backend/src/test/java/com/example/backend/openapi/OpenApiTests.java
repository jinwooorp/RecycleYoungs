package com.example.backend.openapi;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.HashSet;
import java.util.Set;
import java.util.Arrays;
import com.example.backend.admindong.ApiResponses;
import com.example.backend.location.LocationResponses;
import com.example.backend.nearby.NearbyResponses;
import io.swagger.v3.oas.annotations.media.Schema;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "spring.autoconfigure.exclude=org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration,"
        + "org.springframework.boot.flyway.autoconfigure.FlywayAutoConfiguration",
    "OPENAPI_ENABLED=true", "server.address=127.0.0.1"
})
@AutoConfigureMockMvc
class OpenApiTests {
    @Autowired MockMvc mvc;
    @Autowired ApplicationContext context;
    @MockitoBean JdbcClient jdbc;
    @LocalServerPort int port;
    private JsonNode document;

    @BeforeEach void loadDocument() throws Exception {
        var json = mvc.perform(get("/api/v3/api-docs")).andExpect(status().isOk())
            .andReturn().getResponse().getContentAsString();
        document = JsonMapper.builder().build().readTree(json);
    }

    @Test void loadsWithoutDatabaseOrFlyway() {
        assertThat(context.getBeansOfType(DataSource.class)).isEmpty();
        assertThat(context.getBeansOfType(Flyway.class)).isEmpty();
        verifyNoInteractions(jdbc);
    }

    @Test void generatesExactlyThirteenGetOperationsAndValidSchemaReferences() {
        assertThat(document.path("openapi").asText()).startsWith("3.1.");
        assertThat(document.path("info").path("title").asText()).isEqualTo("RecycleYoungs API");
        assertThat(names(document.path("paths"))).containsExactlyInAnyOrder(
            "/api/admin-dongs", "/api/industries", "/api/quarters", "/api/admin-dong-stats",
            "/api/admin-dong-trends", "/api/locations/resolve", "/api/nearby-stores", "/api/regions",
            "/api/regions/admin-dongs/{dongCode}/boundary", "/api/cafe-consumption-scores", "/api/cafe-change-scores",
            "/api/admin-dong-context", "/api/admin-dong-sales-breakdown");
        document.path("paths").properties().forEach(entry -> {
            assertThat(names(entry.getValue())).containsExactly("get");
            var operation = entry.getValue().path("get");
            assertThat(operation.path("summary").asText()).isNotBlank();
            assertThat(operation.path("description").asText()).isNotBlank();
            assertThat(operation.has("requestBody")).isFalse();
        });
        checkReferences(document);
    }

    @Test void documentsRequiredQueriesWithoutSyntheticMapParameter() {
        assertQueries("/api/admin-dongs"); assertQueries("/api/industries"); assertQueries("/api/quarters");
        assertQueries("/api/admin-dong-stats", "dongCode", "industryCode", "quarterCode");
        assertQueries("/api/admin-dong-trends", "dongCode", "industryCode");
        assertQueries("/api/admin-dong-context", "dongCode", "quarterCode", "dataVersion");
        assertQueries("/api/admin-dong-sales-breakdown", "dongCode", "industryCode", "quarterCode", "dataVersion");
        assertQueries("/api/locations/resolve", "lat", "lng");
        assertQueries("/api/nearby-stores", "lat", "lng", "radius", "industryCode");
        assertThat(parameter("/api/admin-dong-stats", "dongCode").path("pattern").asText()).isEqualTo("^[0-9]{8}$");
        assertThat(parameter("/api/admin-dong-stats", "quarterCode").path("pattern").asText())
            .isEqualTo("^[1-9][0-9]{3}[1-4]$");
    }

    @Test void documentsCoordinateAndCafeRadiusConstraints() {
        for (var path : new String[]{"/api/locations/resolve", "/api/nearby-stores"}) {
            assertThat(parameter(path, "lat").path("minimum").asInt()).isEqualTo(-90);
            assertThat(parameter(path, "lat").path("maximum").asInt()).isEqualTo(90);
            assertThat(parameter(path, "lng").path("minimum").asInt()).isEqualTo(-180);
            assertThat(parameter(path, "lng").path("maximum").asInt()).isEqualTo(180);
        }
        assertThat(parameter("/api/nearby-stores", "radius").path("type").asText()).isEqualTo("string");
        assertThat(parameter("/api/nearby-stores", "radius").path("enum").toString()).isEqualTo("[\"500\"]");
        assertThat(parameter("/api/nearby-stores", "industryCode").path("enum").toString()).isEqualTo("[\"CAFE\"]");
    }

    @Test void documentsActualResponsesAndCommonErrors() {
        for (var path : names(document.path("paths"))) {
            var responses = operation(path).path("responses");
            assertThat(names(responses)).containsExactlyInAnyOrderElementsOf(path.equals("/api/locations/resolve")
                || path.equals("/api/nearby-stores") ? Set.of("200", "400", "500", "503")
                : path.equals("/api/admin-dong-context") ? Set.of("200","400","409","500","503")
                : Set.of("/api/admin-dong-stats","/api/admin-dong-trends","/api/cafe-consumption-scores","/api/cafe-change-scores","/api/admin-dong-sales-breakdown").contains(path)
                    ? Set.of("200","400","409","500") : Set.of("200", "400", "500"));
            for (var code : new String[]{"400", "500"}) assertThat(responseSchema(path, code).path("$ref").asText())
                .isEqualTo("#/components/schemas/ApiError");
        }
        assertThat(responseSchema("/api/admin-dongs", "200").path("type").asText()).isEqualTo("array");
        assertThat(responseSchema("/api/admin-dongs", "200").path("items").path("$ref").asText())
            .isEqualTo("#/components/schemas/NamedCode");
        assertThat(responseSchema("/api/admin-dong-stats", "200").path("$ref").asText()).endsWith("/Stats");
        assertThat(responseSchema("/api/admin-dong-trends", "200").path("$ref").asText()).endsWith("/Trend");
        assertThat(responseSchema("/api/locations/resolve", "200").path("$ref").asText()).endsWith("/Resolution");
        assertThat(responseSchema("/api/nearby-stores", "200").path("$ref").asText()).endsWith("/NearbyStoresResult");
        assertThat(names(schema("ApiError").path("properties"))).containsExactlyInAnyOrder("code", "message", "field");
        assertNullable(schema("ApiError").path("properties").path("field"), "string");
    }

    @Test void distinguishesNullNoRowAndZeroAndPreservesNumericStrings() {
        for (var field : new String[]{"estimatedSalesAmount", "transactionCount", "weekdayEstimatedSalesAmount", "weekendEstimatedSalesAmount"})
            assertNullable(schema("SalesStats").path("properties").path(field), "string");
        assertNullable(schema("StoreStats").path("properties").path("storeCount"), "integer");
        assertNullable(schema("Stats").path("properties").path("storeStats"), "object");
        assertNullable(schema("Stats").path("properties").path("salesStats"), "object");
        assertThat(schema("MissingReasons").toString()).contains("NO_ROW");
        assertThat(schema("NearbyStoresResult").path("properties").path("totalCount").path("type").asText()).isEqualTo("string");
        for (var property : schema("NearbyQuality").path("properties").properties())
            assertThat(property.getValue().path("type").asText()).isEqualTo("string");
    }

    @Test void documentsBoundaryAmbiguityAndSnapshotLimitations() {
        assertThat(schema("AdminDongResult").toString()).contains("AMBIGUOUS_BOUNDARY", "OUTSIDE_OR_UNSUPPORTED");
        assertNullable(schema("AdminDongResult").path("properties").path("resolvedDong"), "object");
        assertThat(schema("DatasetVersion").toString()).contains("UNRESOLVED");
        assertThat(schema("NearbyData").toString()).contains("UNVERIFIED", "AVAILABLE_RECORDS");
    }

    @Test void schemaPropertiesMatchEveryPublishedRecordDto() {
        for (var owner : new Class<?>[]{ApiResponses.class, LocationResponses.class, NearbyResponses.class}) {
            for (var record : owner.getDeclaredClasses()) {
                if (!record.isRecord() || record == NearbyResponses.Query.class) continue;
                var annotation = record.getAnnotation(Schema.class);
                var name = annotation != null && !annotation.name().isEmpty() ? annotation.name() : record.getSimpleName();
                assertThat(names(schema(name).path("properties"))).as(name).containsExactlyInAnyOrderElementsOf(
                    Arrays.stream(record.getRecordComponents()).map(java.lang.reflect.RecordComponent::getName).toList());
            }
        }
    }

    @Test void salesSchemaAcceptsTheSignedBigintStringsReturnedByTheApi() {
        for (var field : schema("SalesStats").path("properties").properties()) {
            var pattern = java.util.regex.Pattern.compile(field.getValue().path("pattern").asText());
            for (var value : new String[]{"-1", "-9223372036854775808", "0", "9007199254740993"})
                assertThat(pattern.matcher(value).matches()).as(field.getKey() + "=" + value).isTrue();
        }
    }

    @Test void generatedDocumentParsesAsOpenApiModel() throws Exception {
        var parsed = io.swagger.v3.core.util.Json31.mapper().readValue(document.toString(), io.swagger.v3.oas.models.OpenAPI.class);
        assertThat(parsed.getOpenapi()).startsWith("3.1.");
        assertThat(parsed.getPaths()).hasSize(13);
        assertThat(parsed.getComponents().getSchemas()).hasSize(document.path("components").path("schemas").size());
    }

    @Test void servesSwaggerHtmlAssetsAndSpecificationOverRealLoopbackHttp() throws Exception {
        try (var client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build()) {
            var redirect = http(client, "/api/docs");
            assertThat(redirect.statusCode()).isEqualTo(302);
            var location = redirect.headers().firstValue("location").orElseThrow();
            assertThat(location).endsWith("/swagger-ui/index.html").doesNotContain("/api/api/");
            var html = http(client, location);
            assertThat(html.statusCode()).isEqualTo(200);
            assertThat(html.body()).contains("swagger-ui-bundle.js", "swagger-ui.css", "swagger-initializer.js");
            for (var resource : new String[]{"swagger-ui-bundle.js", "swagger-ui.css", "swagger-initializer.js"})
                assertThat(http(client, URI.create(location).resolve(resource).toString()).statusCode()).isEqualTo(200);
            var initializer = http(client, URI.create(location).resolve("swagger-initializer.js").toString());
            assertThat(initializer.body()).contains("/api/v3/api-docs/swagger-config").doesNotContain("petstore.swagger.io");
            var configResponse = http(client, "/api/v3/api-docs/swagger-config");
            assertThat(configResponse.statusCode()).isEqualTo(200);
            var config = JsonMapper.builder().build().readTree(configResponse.body());
            assertThat(config.path("url").asText()).isEqualTo("/api/v3/api-docs");
            var spec = http(client, config.path("url").asText());
            assertThat(spec.statusCode()).isEqualTo(200);
            var liveDocument = JsonMapper.builder().build().readTree(spec.body());
            assertThat(liveDocument.path("paths").size()).isEqualTo(13);
            assertThat(liveDocument.path("info").path("title").asText()).isEqualTo("RecycleYoungs API");
        }
        verifyNoInteractions(jdbc);
    }

    @Test void previousEntryAndSpecificationPathsDoNotExposeDocumentation() throws Exception {
        for (var path : new String[]{"/v3/api-docs", "/v3/api-docs.yaml", "/v3/api-docs/swagger-config", "/swagger-ui.html"})
            mvc.perform(get(path)).andExpect(status().isNotFound());
        verifyNoInteractions(jdbc);
    }

    @Test void businessApiRoutesKeepTheirOriginalPrefix() throws Exception {
        for (var path : names(document.path("paths"))) {
            var concrete = path.replace("{dongCode}", "11110515");
            var response = mvc.perform(get(concrete).param("undefined", "value"))
                .andExpect(status().isBadRequest()).andReturn().getResponse();
            assertThat(JsonMapper.builder().build().readTree(response.getContentAsString()).path("code").asText())
                .isEqualTo("INVALID_PARAMETER");
            mvc.perform(get(concrete.replaceFirst("/api/", "/api/api/"))).andExpect(status().isNotFound());
        }
        verifyNoInteractions(jdbc);
    }

    private HttpResponse<String> http(HttpClient client, String path) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).GET().build(),
            HttpResponse.BodyHandlers.ofString());
    }
    private JsonNode operation(String path) { return document.path("paths").path(path).path("get"); }
    private JsonNode schema(String name) { return document.path("components").path("schemas").path(name); }
    private JsonNode responseSchema(String path, String status) {
        return operation(path).path("responses").path(status).path("content").path("application/json").path("schema");
    }
    private JsonNode parameter(String path, String name) {
        for (var parameter : operation(path).path("parameters")) if (parameter.path("name").asText().equals(name))
            return parameter.path("schema");
        throw new AssertionError("Missing query: " + path + " " + name);
    }
    private void assertQueries(String path, String... expected) {
        var actual = new HashSet<String>();
        for (var parameter : operation(path).path("parameters")) {
            if (parameter.path("name").asText().equals("dataVersion")
                && !Set.of("/api/admin-dong-context","/api/admin-dong-sales-breakdown").contains(path)) {
                assertThat(parameter.path("required").asBoolean()).isFalse();
                assertThat(parameter.path("in").asText()).isEqualTo("query");
                assertThat(path).isIn("/api/admin-dong-stats","/api/admin-dong-trends","/api/cafe-consumption-scores","/api/cafe-change-scores");
                continue;
            }
            actual.add(parameter.path("name").asText());
            assertThat(parameter.path("in").asText()).isEqualTo("query");
            assertThat(parameter.path("required").asBoolean()).isTrue();
        }
        assertThat(actual).containsExactlyInAnyOrder(expected);
    }

    @Test void documentsOptionalPublicationPinAndConflictResponse() {
        for (String path : java.util.List.of("/api/admin-dong-stats","/api/admin-dong-trends","/api/cafe-consumption-scores","/api/cafe-change-scores")) {
            assertThat(parameter(path,"dataVersion").path("pattern").asText()).contains("[0-9a-f]{64}");
            assertThat(operation(path).path("responses").has("409")).isTrue();
        }
    }
    private static Set<String> names(JsonNode object) {
        var names = new HashSet<String>(); object.properties().forEach(entry -> names.add(entry.getKey())); return names;
    }
    private void assertNullable(JsonNode property, String type) {
        if (property.has("anyOf")) {
            assertThat(property.path("anyOf").size()).isEqualTo(2);
            var ref = property.path("anyOf").get(0).path("$ref").asText();
            assertThat(schema(ref.substring(ref.lastIndexOf('/') + 1)).path("type").asText()).isEqualTo(type);
            assertThat(property.path("anyOf").get(1).path("type").asText()).isEqualTo("null");
        } else {
            assertThat(property.path("type").toString()).contains("\"null\"", "\"" + type + "\"");
        }
        // A sibling type containing null does not bypass an object $ref in JSON Schema 2020-12.
        assertThat(property.has("$ref")).isFalse();
    }
    private void checkReferences(JsonNode node) {
        if (node.has("$ref")) {
            var ref = node.path("$ref").asText();
            assertThat(ref).startsWith("#/components/schemas/");
            assertThat(schema(ref.substring(ref.lastIndexOf('/') + 1)).isMissingNode()).isFalse();
        }
        if (node.isObject()) node.properties().forEach(entry -> checkReferences(entry.getValue()));
        else if (node.isArray()) node.forEach(this::checkReferences);
    }
}
