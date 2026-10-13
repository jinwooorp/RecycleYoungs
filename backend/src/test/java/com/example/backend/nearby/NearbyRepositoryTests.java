package com.example.backend.nearby;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;

class NearbyRepositoryTests {
    @Test @SuppressWarnings("unchecked")
    void bindsCoordinatesAndUsesOneSnapshotWithSeparateGeometryPrefilter() {
        var jdbc = mock(JdbcClient.class); var statement = mock(JdbcClient.StatementSpec.class);
        var result = mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(statement); when(statement.param(anyString(), any())).thenReturn(statement);
        when(statement.query(any(RowMapper.class))).thenReturn(result); when(result.list()).thenReturn(List.of());
        new NearbyRepository(jdbc).find(NearbyServiceTests.QUERY);
        verify(jdbc).sql(NearbyRepository.SQL); verify(statement).param("lng", 126.978); verify(statement).param("lat", 37.5665);
        verify(statement).param("radius", 500); verify(statement).param("listLimit", 100);
        verify(statement).param("candidateRadius", 501);
        assertThat(NearbyRepository.SQL).contains("ST_MakePoint(:lng, :lat)", "source = 'SEMAS'", "source_code = 'I21201'",
            "s.source_small_category_code = 'I21201'", "s.industry_id = m.cafe_id", "s.location && p.envelope",
            "ST_DWithin(s.location::geography, p.geog, :candidateRadius, true)", "ST_Distance(s.location::geography, p.geog, true)",
            "SELECT * FROM candidates WHERE distance_meters <= :radius",
            "LIMIT :listLimit", "count(*) AS total_count", "source_store_id COLLATE \"C\"");
        assertThat(NearbyRepository.SQL).doesNotContain("CS100010", "ST_Transform", "dong_code", "commercial_area", "INSERT", "UPDATE", "DELETE");
    }
    @Test void bboxIsConservativeAndFallsBackAtPolesAndDateLine() {
        var b = NearbyRepository.bounds(NearbyServiceTests.QUERY);
        assertThat(b.maxLat() - 37.5665).isGreaterThan(0.0045);
        assertThat(b.maxLng() - 126.978).isGreaterThan(0.0056);
        for (var c : List.of(new NearbyResponses.Coordinate(90, 0), new NearbyResponses.Coordinate(-90, 180),
            new NearbyResponses.Coordinate(0, 179.999), new NearbyResponses.Coordinate(0, -179.999)))
            assertThat(NearbyRepository.bounds(new NearbyResponses.Query(c, 500, "CAFE")))
                .isEqualTo(new NearbyRepository.Bounds(-180, -90, 180, 90));
    }
}
