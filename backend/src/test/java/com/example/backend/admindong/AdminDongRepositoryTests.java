package com.example.backend.admindong;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;

class AdminDongRepositoryTests {
    // The persistent DB's unique constraint prevents this state; simulate only the query boundary.
    @Test
    @SuppressWarnings("unchecked")
    void duplicateCompositeKeysAreNeverSilentlyChosen() {
        var jdbc=mock(JdbcClient.class);
        var statement=mock(JdbcClient.StatementSpec.class);
        var result=mock(JdbcClient.MappedQuerySpec.class);
        when(jdbc.sql(anyString())).thenReturn(statement);
        when(statement.param(anyString(),any())).thenReturn(statement);
        when(statement.query(any(RowMapper.class))).thenReturn(result);
        when(result.list()).thenReturn(List.of(
            new AdminDongRepository.StoreRow(1,2,0,0,0), new AdminDongRepository.StoreRow(3,4,0,0,0)));
        assertThatThrownBy(() -> new AdminDongRepository(jdbc).store("11110515","CS100010","20251"))
            .isInstanceOf(DataIntegrityException.class);
    }
}
