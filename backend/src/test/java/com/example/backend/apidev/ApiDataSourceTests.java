package com.example.backend.apidev;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ApiDataSourceTests {
    @Test void wrongActualReaderIdentityClosesConnection() throws Exception {
        var c=mock(Connection.class);var s=mock(Statement.class);var r=mock(ResultSet.class);
        when(c.createStatement()).thenReturn(s);when(s.executeQuery(anyString())).thenReturn(r);when(r.next()).thenReturn(true);
        assertThrows(java.sql.SQLException.class,()->ApiDataSourceConfiguration.verify(c,"123","a".repeat(24)));
        verify(c).close();
    }
    @Test void identityAndPublicationMustBothBeReady() throws Exception {
        var c=mock(Connection.class);var s=mock(Statement.class);var r=mock(ResultSet.class);
        when(c.createStatement()).thenReturn(s);when(s.executeQuery(anyString())).thenReturn(r);when(r.next()).thenReturn(true);
        String[] values={"recycleyoungs_api_dev","api_reader","api_reader","123","/var/lib/postgresql/data/api","5432","5s","10min","on","a".repeat(24)};
        for(int i=0;i<values.length;i++)when(r.getString(i+1)).thenReturn(values[i]);
        when(r.getBoolean(11)).thenReturn(true);
        assertSame(c,ApiDataSourceConfiguration.verify(c,"123","a".repeat(24)));
        when(r.getBoolean(11)).thenReturn(false);
        assertThrows(java.sql.SQLException.class,()->ApiDataSourceConfiguration.verify(c,"123","a".repeat(24)));
    }
}
