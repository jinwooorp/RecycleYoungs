package com.example.backend.location;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;

class LocationRepositoryTests {
    @Test @SuppressWarnings("unchecked")
    void bindsCoordinatesAndKeepsBothKindsInOneReadOnlyStatement() {
        var jdbc = mock(JdbcClient.class);
        var statement = mock(JdbcClient.StatementSpec.class);
        var query = mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(statement);
        when(statement.param(anyString(), any())).thenReturn(statement);
        when(statement.query(any(RowMapper.class))).thenReturn(query);
        var rows = List.of(LocationServiceTests.row("ADMIN_DONG", "1", null), LocationServiceTests.row("COMMERCIAL_AREA", "2", null));
        when(query.list()).thenReturn(rows);
        assertThat(new LocationRepository(jdbc).resolve(LocationServiceTests.COORDINATE)).isEqualTo(rows);
        verify(statement).param("lng", 126.978);
        verify(statement).param("lat", 37.5665);
        verify(statement).param("projectionSupported", true);
        var sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(1)).sql(sql.capture());
        assertThat(sql.getValue()).contains("ST_Transform(ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 5181)",
            "WHERE is_current", "v.load_status = 'READY'", "v.validation_status IN ('PASSED', 'PASSED_WITH_LIMITATIONS')",
            "ST_Covers(b.operational_geometry, p.geom)", "ST_Touches(b.operational_geometry, p.geom)",
            "UNION ALL", "LEFT JOIN matches", "b.operational_geometry IS NOT NULL",
            "CASE WHEN :projectionSupported", "ELSE NULL::geometry END AS geom");
        assertThat(sql.getValue()).doesNotContainPattern("\\bLIMIT\\b");
        assertThat(sql.getValue()).doesNotContain("ST_Contains", "ST_Transform(b.", "ST_Buffer", "ST_Snap", "UPDATE ", "INSERT ", "DELETE ");
        verifyNoMoreInteractions(jdbc);
    }

    @Test void projectionSupportIncludesSeoulAndExcludesSingularitiesAndPoles() {
        assertThat(LocationRepository.supportsProjection(LocationServiceTests.COORDINATE)).isTrue();
        assertThat(LocationRepository.supportsProjection(new LocationResponses.Coordinate(33.96, 126))).isTrue();
        assertThat(LocationRepository.supportsProjection(new LocationResponses.Coordinate(38.33, 128))).isTrue();
        for (var coordinate : List.of(new LocationResponses.Coordinate(0, 37), new LocationResponses.Coordinate(90, 180),
            new LocationResponses.Coordinate(-90, -180), new LocationResponses.Coordinate(37, 125.999),
            new LocationResponses.Coordinate(33.95, 127), new LocationResponses.Coordinate(38.34, 127))) {
            assertThat(LocationRepository.supportsProjection(coordinate)).isFalse();
        }
    }

    @Test @SuppressWarnings("unchecked")
    void unsupportedProjectionStillReadsVersionsAndBindsFalseInsteadOfRetryingDatabaseErrors() {
        var jdbc = mock(JdbcClient.class);
        var statement = mock(JdbcClient.StatementSpec.class);
        var query = mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(statement);
        when(statement.param(anyString(), any())).thenReturn(statement);
        when(statement.query(any(RowMapper.class))).thenReturn(query);
        when(query.list()).thenReturn(List.of());
        new LocationRepository(jdbc).resolve(new LocationResponses.Coordinate(0, 37));
        verify(statement).param("projectionSupported", false);
        verify(statement).param("lng", 37.0);
        verify(statement).param("lat", 0.0);
        verify(jdbc, times(1)).sql(anyString());
    }
}
