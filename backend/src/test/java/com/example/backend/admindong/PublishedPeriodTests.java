package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PublishedPeriodTests {
    @Test
    void publishedPeriodsCrossYearAndKeepMissingCalendarQuarter() {
        var repo=mock(AdminDongRepository.class);
        when(repo.lookup()).thenReturn(new AdminDongRepository.Lookup(
            List.of(new ApiResponses.NamedCode("11110515","합성동")),
            List.of(new AdminDongRepository.Industry(1,"CAFE","카페","CS100010",true)),
            List.of(new ApiResponses.Quarter("20254","2025년 4분기"),new ApiResponses.Quarter("20262","2026년 2분기"))));
        when(repo.stores(anyString(),anyString(),anyList())).thenReturn(Map.of());
        when(repo.salesByQuarter(anyString(),anyString(),anyList())).thenReturn(Map.of());
        var result=new AdminDongService(repo).trends(new QueryValidator.TrendQuery("11110515","CAFE"));
        assertThat(result.quarters()).extracting(q->q.quarter().code()).containsExactly("20254","20261","20262");
        assertThat(result.quarters()).allSatisfy(q->{
            assertThat(q.storeStats()).isNull(); assertThat(q.salesStats()).isNull();
            assertThat(q.missingReasons().salesStats()).isEqualTo("NO_ROW");
        });
        verify(repo).stores("11110515","CS100010",List.of("20254","20261","20262"));
    }
}
