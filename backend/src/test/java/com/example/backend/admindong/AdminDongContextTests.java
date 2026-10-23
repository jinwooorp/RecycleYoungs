package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;

class AdminDongContextTests {
    @Test void contextSqlParsesNamedParametersBeforeOpeningAnyConnection() throws Exception {
        var dataSource=mock(javax.sql.DataSource.class);
        when(dataSource.getConnection()).thenThrow(new java.sql.SQLException("offline parser check"));
        var actual=new AdminDongContextRepository(org.springframework.jdbc.core.simple.JdbcClient.create(dataSource));
        assertThatThrownBy(()->actual.rows("a".repeat(64),"11110515","20251"))
            .isInstanceOf(org.springframework.jdbc.CannotGetJdbcConnectionException.class);
    }
    private final AdminDongRepository lookup = mock(AdminDongRepository.class);
    private final AdminDongContextRepository repository = mock(AdminDongContextRepository.class);
    private final AdminDongContextService service = new AdminDongContextService(lookup, repository);
    private QueryValidator.StatsQuery query(String version) {
        return new QueryValidator.StatsQuery("11110515", "CAFE", "20251", version);
    }
    private void supported() {
        when(lookup.lookup()).thenReturn(new AdminDongRepository.Lookup(
            List.of(new ApiResponses.NamedCode("11110515", "청운효자동")),
            List.of(new AdminDongRepository.Industry(1,"CAFE","카페","CS100010",true)),
            List.of(new ApiResponses.Quarter("20251","2025년 1분기"))));
    }
    @Test void contextRequiresExactVersionAndRejectsIndustryAndDuplicates() {
        var params = new LinkedMultiValueMap<String,String>();
        params.setAll(Map.of("dongCode","11110515","quarterCode","20251","dataVersion","legacy-unversioned"));
        assertThat(QueryValidator.context(params).industryCode()).isEqualTo("CAFE");
        params.add("industryCode","CAFE");
        assertThatThrownBy(()->QueryValidator.context(params)).isInstanceOf(InvalidQueryException.class);
        params.remove("industryCode"); params.add("quarterCode","20251");
        assertThatThrownBy(()->QueryValidator.context(params)).isInstanceOf(InvalidQueryException.class);
        params.remove("quarterCode"); params.set("quarterCode","20251"); params.remove("dataVersion");
        assertThatThrownBy(()->QueryValidator.context(params)).isInstanceOf(InvalidQueryException.class);
    }
    @Test void unknownDongWinsBeforeVersionAndUnavailable() {
        supported();
        assertThatThrownBy(()->service.context(new QueryValidator.StatsQuery("11110530","CAFE","20251","a".repeat(64))))
            .isInstanceOf(InvalidQueryException.class);
        verify(lookup,never()).requireVersion(any()); verifyNoInteractions(repository);
    }
    @Test void changedVersionWinsBeforeContextAvailability() {
        supported(); when(lookup.requireVersion("a".repeat(64))).thenThrow(new DataVersionChangedException());
        assertThatThrownBy(()->service.context(query("a".repeat(64)))).isInstanceOf(DataVersionChangedException.class);
        verifyNoInteractions(repository);
    }
    @Test void legacyContextUnavailableAfterVersionCheck() {
        supported();
        assertThatThrownBy(()->service.context(query("legacy-unversioned"))).isInstanceOf(ContextUnavailableException.class);
        verify(lookup).requireVersion("legacy-unversioned"); verifyNoInteractions(repository);
    }
    @Test void projectionKeepsNullZeroDecimalAndHidesExcludedFields() {
        var policy = ContextPolicy.document();
        var source = policy.path("policy").path("sections").path("population");
        var metrics = new java.util.LinkedHashMap<String,String>();
        source.path("fields").forEach(f->metrics.put(f.asText(),"0"));
        metrics.put("TOT_FLPOP_CO","9007199254740993.25"); metrics.put("ML_FLPOP_CO",null);
        var section = ContextPolicy.project("population", "REFERENCE", "b".repeat(64), "20251",
            "2026-10-22T10:00:00Z", metrics, Map.of());
        assertThat(section.metrics().get("TOT_FLPOP_CO").value()).isEqualTo("9007199254740993.25");
        assertThat(section.metrics().get("ML_FLPOP_CO").valueState()).isEqualTo("SOURCE_NULL");
        assertThat(section.metrics().get("FML_FLPOP_CO").value()).isEqualTo("0");
        assertThat(section.scoreReady()).isFalse();
        assertThat(section.provenance().observedAt()).isNull();
        assertThat(ContextPolicy.project("consumption","WITHHELD",null,null,null,null,null).metrics()).isNull();
        assertThatThrownBy(()->ContextPolicy.project("population","REFERENCE", "b".repeat(64),"20251","stamp",Map.of(),Map.of()))
            .isInstanceOf(DataIntegrityException.class);
    }
    @Test void nullChangeCodeIsIntegrityFailure() {
        var metrics=new java.util.LinkedHashMap<String,String>();
        ContextPolicy.document().path("policy").path("sections").path("change").path("fields").forEach(f->metrics.put(f.asText(),"0"));
        var attributes=new java.util.HashMap<String,String>();attributes.put("TRDAR_CHNGE_IX",null);attributes.put("TRDAR_CHNGE_IX_NM",null);
        assertThatThrownBy(()->ContextPolicy.project("change","REFERENCE","b".repeat(64),"20251","stamp",metrics,attributes))
            .isInstanceOf(DataIntegrityException.class);
    }
}
