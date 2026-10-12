package com.example.backend.location;

import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import tools.jackson.databind.json.JsonMapper;

/** Narrow fixture-only controls used by the isolated Chrome verification. */
public final class LocationFixtureControl {
    public static void main(String[] args) {
        var jdbc = JdbcClient.create(LocationIntegrationRunner.guardedDataSource());
        var json = JsonMapper.builder().build();
        if (args.length == 3 && args[0].equals("coordinate")) {
            double x=Double.parseDouble(args[1]), y=Double.parseDouble(args[2]);
            if (!Double.isFinite(x) || !Double.isFinite(y) || x<199000 || x>205000 || y<498000 || y>506000) {
                throw new IllegalArgumentException("Only the synthetic fixture extent is permitted");
            }
            var coordinate=jdbc.sql("SELECT ST_Y(g) lat,ST_X(g) lng FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(:x,:y),5181),4326) g) p")
                .param("x",x).param("y",y).query((rs,n)->Map.of("lat",rs.getDouble("lat"),"lng",rs.getDouble("lng"))).single();
            System.out.println(json.writeValueAsString(coordinate));
        } else if(args.length==2 && args[0].equals("admin-current") && (args[1].equals("on")||args[1].equals("off"))) {
            int count=jdbc.sql("UPDATE spatial_dataset_versions SET is_current=:current WHERE id=9007199254740993 AND boundary_kind='ADMIN_DONG' AND load_status='READY'")
                .param("current",args[1].equals("on")).update();
            if(count!=1)throw new IllegalStateException("Synthetic current fixture identity differs");
            System.out.println(json.writeValueAsString(Map.of("updated",count,"adminCurrent",args[1])));
        } else throw new IllegalArgumentException("Unknown isolated fixture command");
    }
}
