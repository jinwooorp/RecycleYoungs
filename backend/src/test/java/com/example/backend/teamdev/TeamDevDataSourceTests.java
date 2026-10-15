package com.example.backend.teamdev;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.Test;

class TeamDevDataSourceTests {
    private static final String SID = "123456789", OWNER = "a".repeat(32), CONTRACT = "b".repeat(64), SPATIAL = "c".repeat(64);

    private Connection fixture(String changed, int column) throws SQLException {
        var connection = mock(Connection.class);
        var statement = mock(Statement.class);
        var rs = mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery(anyString())).thenReturn(rs);
        when(rs.next()).thenReturn(true);
        String[] values = {"recycleyoungs_team_dev", "ry_team_reader", "ry_team_reader", SID,
            "/var/lib/postgresql/data/team", OWNER, "on", "real-data-v1", CONTRACT, "READY", OWNER};
        for (int i = 0; i < values.length; i++) when(rs.getString(i + 1)).thenReturn(i + 1 == column ? changed : values[i]);
        when(rs.getBoolean(12)).thenReturn(column != 12);
        when(rs.getString(13)).thenReturn(column == 13 ? changed : SPATIAL);
        return connection;
    }

    @Test void safeConnectionIsReadOnlyAndAccepted() throws SQLException {
        var connection = fixture("", 0);
        assertSame(connection, TeamDevDataSourceConfiguration.verify(connection, SID, OWNER, CONTRACT, "real-data-v1", SPATIAL));
        verify(connection.createStatement()).execute("SET default_transaction_read_only=on");
        verify(connection, never()).close();
        assertTrue(TeamDevDataSourceConfiguration.URL.startsWith("jdbc:postgresql://127.0.0.1:55432/recycleyoungs_team_dev?"));
    }

    @Test void wrongIdentityVersionReadinessAndCountsCloseConnection() throws SQLException {
        for (int column = 1; column <= 13; column++) {
            var connection = fixture(column == 1 ? "startup_analysis" : "mismatch", column);
            assertThrows(SQLException.class, () -> TeamDevDataSourceConfiguration.verify(connection, SID, OWNER, CONTRACT, "real-data-v1", SPATIAL));
            verify(connection).close();
        }
    }

    @Test void unavailableReadyStateClosesConnection() throws SQLException {
        var connection = mock(Connection.class);
        when(connection.createStatement()).thenThrow(new SQLException("fixture"));
        assertThrows(SQLException.class, () -> TeamDevDataSourceConfiguration.verify(connection, SID, OWNER, CONTRACT, "real-data-v1", SPATIAL));
        verify(connection).close();
    }

    @Test void explicitV2ProofAcceptsV2AndRejectsV1Mixing() throws SQLException {
        var v2 = fixture("real-data-v2", 8);
        assertSame(v2, TeamDevDataSourceConfiguration.verify(v2, SID, OWNER, CONTRACT, "real-data-v2", SPATIAL));
        var v1 = fixture("", 0);
        assertThrows(SQLException.class, () -> TeamDevDataSourceConfiguration.verify(v1, SID, OWNER, CONTRACT, "real-data-v2", SPATIAL));
        verify(v1).close();
    }

    @Test void unknownDatasetVersionIsRejected() throws SQLException {
        var connection = fixture("", 0);
        assertThrows(SQLException.class, () -> TeamDevDataSourceConfiguration.verify(connection, SID, OWNER, CONTRACT, "latest", SPATIAL));
        verify(connection).close();
    }
}
