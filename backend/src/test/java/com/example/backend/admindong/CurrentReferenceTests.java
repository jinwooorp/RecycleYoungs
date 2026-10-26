package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.util.LinkedMultiValueMap;

class CurrentReferenceTests {
    @Test void catalogVersionMatchesTheEtlCanonicalHash() {
        assertThat(ReferencePolicy.version(Map.of("seoul-bus-stops","a".repeat(64),
            "seoul-public-parking","b".repeat(64),"seoul-metro-leases","c".repeat(64))))
            .isEqualTo("681a4ff6aa8decf35f4d4ecbeebde0ceb92e2f54a63078e8f33b95bdaf1cfed7");
        assertThatThrownBy(()->ReferencePolicy.version(Map.of("seoul-bus-stops","a".repeat(64))))
            .isInstanceOf(DataIntegrityException.class);
    }
    @Test void sourceListsCannotBeQueriedAsHistoricalOrNearbyData() {
        var q=new LinkedMultiValueMap<String,String>();
        q.setAll(Map.of("dataVersion","a".repeat(64),"referenceVersion","b".repeat(64),"sourceId","seoul-bus-stops"));
        assertThat(ReferenceQuery.records(q).page()).isEqualTo(1);
        for (String field:java.util.List.of("quarterCode","radius","latitude","industryCode")) {
            q.set(field,"20251");
            assertThatThrownBy(()->ReferenceQuery.records(q)).isInstanceOf(InvalidQueryException.class);
            q.remove(field);
        }
        q.add("sourceId","seoul-public-parking");
        assertThatThrownBy(()->ReferenceQuery.records(q)).isInstanceOf(InvalidQueryException.class);
        q.set("sourceId","seoul-bus-stops"); q.set("page","0");
        assertThatThrownBy(()->ReferenceQuery.records(q)).isInstanceOf(InvalidQueryException.class);
    }
    @Test void recordProjectionPreservesExactNumbersNullAndWithheldStates() {
        var row=new ReferenceRepository.RecordRow("1", "{\"STN_NM\":\"시험역\",\"STN_CD\":\"001\",\"TPBIZ\":null,\"CTRT_STRT_DD\":null,\"CTRT_END_DD\":null}",
            "{\"STN_NM\":\"REPORTED\",\"STN_CD\":\"REPORTED\",\"TPBIZ\":\"SOURCE_NULL\",\"CTRT_STRT_DD\":\"WITHHELD_FORMAT\",\"CTRT_END_DD\":\"SOURCE_NULL\"}",
            "{\"AREA\":{\"value\":\"9007199254740993.25\",\"valueState\":\"REPORTED\",\"unit\":\"SQUARE_METRE_SOURCE_REPORTED\"}}",1);
        var result=ReferencePolicy.record("seoul-metro-leases",row);
        assertThat(result.metrics().get("AREA").value()).isEqualTo("9007199254740993.25");
        assertThat(result.attributes()).containsEntry("TPBIZ",null);
        assertThat(result.attributeStates()).containsEntry("CTRT_STRT_DD","WITHHELD_FORMAT");
        assertThatThrownBy(()->ReferencePolicy.record("seoul-metro-leases",new ReferenceRepository.RecordRow(
            "1",row.attributes(),row.attributeStates(),row.metrics().replace("9007199254740993.25","-1"),1)))
            .isInstanceOf(DataIntegrityException.class);
        assertThatThrownBy(()->ReferencePolicy.record("seoul-metro-leases",new ReferenceRepository.RecordRow(
            "1",row.attributes().replace("\"TPBIZ\":null","\"TPBIZ\":null,\"MM_RTFE\":\"100\""),row.attributeStates(),row.metrics(),1)))
            .isInstanceOf(DataIntegrityException.class);
    }
    @Test void staleDataVersionIsRejectedBeforeCheckingReferenceAvailability() {
        var lookup=mock(AdminDongRepository.class); var repository=mock(ReferenceRepository.class);
        when(lookup.requireVersion("a".repeat(64))).thenThrow(new DataVersionChangedException());
        assertThatThrownBy(()->new ReferenceService(lookup,repository).catalog("a".repeat(64)))
            .isInstanceOf(DataVersionChangedException.class);
        verifyNoInteractions(repository);
    }
}
