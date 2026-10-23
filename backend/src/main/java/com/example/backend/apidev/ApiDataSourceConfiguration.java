package com.example.backend.apidev;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.datasource.AbstractDataSource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import tools.jackson.databind.json.JsonMapper;

/** API Compose reader only; no migration, URL/actor overrides or legacy fallback. */
@Configuration(proxyBeanMethods=false)
@Profile("api-dev")
public class ApiDataSourceConfiguration {
    @Bean DataSource apiDataSource() throws Exception {
        var target=JsonMapper.builder().build().readTree(Files.readString(Path.of("/api-control/target.json")));
        String sid=target.path("sid").asText(),owner=target.path("owner").asText();
        boolean local=target.path("runtime").asText().equals("local-dev")
            && target.path("project").asText().matches("recycleyoungs-dev(?:-check-[0-9a-f]{8})?");
        String expectedVolume=target.path("project").asText()+"-db";
        if (!local || !sid.matches("[0-9]+") || sid.equals("7692329130053947430") || !owner.matches("[0-9a-f]{24}")
            || !target.path("dbname").asText().equals("recycleyoungs_api_dev") || !target.path("host").asText().equals("api-postgres")
            || !target.path("volume").asText().equals(expectedVolume)
            || !target.path("container_id").asText().matches("[0-9a-f]{64}")
            || !target.path("network_id").asText().matches("[0-9a-f]{64}")) throw new IllegalStateException("API routing proof rejected");
        var delegate=new DriverManagerDataSource("jdbc:postgresql://api-postgres:5432/recycleyoungs_api_dev?connectTimeout=5&socketTimeout=600",
            "api_reader",Files.readString(Path.of("/api-control/reader-password")).strip());
        DataSource ds=new AbstractDataSource(){
            @Override public Connection getConnection() throws SQLException{return verify(delegate.getConnection(),sid,owner);}
            @Override public Connection getConnection(String u,String p) throws SQLException{throw new SQLException("API credential overrides forbidden");}
        };
        try(var ignored=ds.getConnection()){}
        return ds;
    }
    static Connection verify(Connection c,String sid,String owner) throws SQLException {
        try(var s=c.createStatement()){
            s.execute("SET default_transaction_read_only=on; SET lock_timeout='5s'; SET statement_timeout='10min'");
            try(var r=s.executeQuery("""
                SELECT current_database(),current_user,session_user,
                (SELECT system_identifier::text FROM pg_control_system()),current_setting('data_directory'),
                current_setting('port'),current_setting('lock_timeout'),current_setting('statement_timeout'),
                current_setting('transaction_read_only'),current_setting('recycleyoungs.api_owner',true),
                EXISTS(SELECT 1 FROM api_current_release c JOIN api_releases r ON r.release_id=c.release_id
                    JOIN api_runtime.artifacts a ON a.release_id=r.release_id WHERE c.singleton AND r.status='READY')
                """)){
                String[] wanted={"recycleyoungs_api_dev","api_reader","api_reader",sid,"/var/lib/postgresql/data/api","5432","5s","10min","on",owner};
                if(!r.next())throw new SQLException("API reader not ready");
                for(int i=0;i<wanted.length;i++)if(!wanted[i].equals(r.getString(i+1)))throw new SQLException("API reader identity rejected");
                if(!r.getBoolean(11))throw new SQLException("API publication not ready");
            }
            return c;
        }catch(SQLException e){c.close();throw e;}
    }
}
