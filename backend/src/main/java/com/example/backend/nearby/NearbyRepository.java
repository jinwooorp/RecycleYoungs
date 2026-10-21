package com.example.backend.nearby;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class NearbyRepository {
    public static final int LIST_LIMIT = 100;
    // One statement keeps inventory, mapping, count and list in the same MVCC snapshot.
    public static final String SQL = """
        WITH mapping AS (
            SELECT (SELECT id FROM industries WHERE code = 'CAFE') AS cafe_id,
                (SELECT industry_id FROM industry_mappings WHERE source = 'SEMAS' AND source_code = 'I21201') AS mapped_id
        ), inventory AS (
            SELECT count(*) AS total_stores,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201') AS cafe_sources,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201' AND s.industry_id IS NULL) AS unclassified,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201' AND s.industry_id <> m.cafe_id) AS conflicting,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201' AND s.location IS NULL) AS missing_location,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201' AND s.location IS NOT NULL
                    AND NOT (NOT ST_IsEmpty(s.location) AND ST_X(s.location) BETWEEN -180 AND 180
                        AND ST_Y(s.location) BETWEEN -90 AND 90)) AS invalid_location,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201' AND s.industry_id = m.cafe_id
                    AND NOT ST_IsEmpty(s.location) AND ST_X(s.location) BETWEEN -180 AND 180
                    AND ST_Y(s.location) BETWEEN -90 AND 90) AS usable_cafes,
                count(*) FILTER (WHERE s.source_small_category_code = 'I21201' AND
                    (s.longitude IS NULL OR s.latitude IS NULL OR NOT (s.longitude BETWEEN -180 AND 180
                        AND s.latitude BETWEEN -90 AND 90))) AS incomplete_source_coordinates
            FROM stores s CROSS JOIN mapping m
        ), point AS (
            SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS geog,
                ST_MakeEnvelope(:minLng, :minLat, :maxLng, :maxLat, 4326) AS envelope
        ), candidates AS MATERIALIZED (
            SELECT s.source_store_id, NULLIF(btrim(s.name), '') AS name, ST_Y(s.location) AS lat,
                ST_X(s.location) AS lng, ST_Distance(s.location::geography, p.geog, true) AS distance_meters
            FROM stores s CROSS JOIN mapping m CROSS JOIN point p
            WHERE m.cafe_id = m.mapped_id AND s.industry_id = m.cafe_id AND s.source_small_category_code = 'I21201'
                AND s.location && p.envelope
                AND CASE WHEN NOT ST_IsEmpty(s.location) AND ST_X(s.location) BETWEEN -180 AND 180
                    AND ST_Y(s.location) BETWEEN -90 AND 90
                    THEN ST_DWithin(s.location::geography, p.geog, :candidateRadius, true) ELSE false END
        ), matches AS MATERIALIZED (
            SELECT * FROM candidates WHERE distance_meters <= :radius
        ), total AS (SELECT count(*) AS total_count FROM matches), limited AS (
            SELECT * FROM matches ORDER BY distance_meters, source_store_id COLLATE "C" LIMIT :listLimit
        )
        SELECT m.*, i.*, t.total_count, l.*
        FROM mapping m CROSS JOIN inventory i CROSS JOIN total t LEFT JOIN limited l ON true
        ORDER BY l.distance_meters, l.source_store_id COLLATE "C"
        """;

    public record Inventory(Long cafeId, Long mappedId, long totalStores, long cafeSources, long usableCafes,
        long unclassified, long conflicting, long missingLocation, long invalidLocation, long incompleteSourceCoordinates) {}
    public record Row(Inventory inventory, long totalCount, NearbyResponses.Store store) {}
    public record Bounds(double minLng, double minLat, double maxLng, double maxLat) {}
    private final JdbcClient jdbc;
    private final com.example.backend.admindong.DataPublication publication;
    public NearbyRepository(JdbcClient jdbc) { this(jdbc,new com.example.backend.admindong.DataPublication(jdbc,false)); }
    @org.springframework.beans.factory.annotation.Autowired
    public NearbyRepository(JdbcClient jdbc, com.example.backend.admindong.DataPublication publication) { this.jdbc=jdbc; this.publication=publication; }
    public com.example.backend.admindong.DataPublication.Metadata metadata() { return publication.metadata(); }

    public static Bounds bounds(NearbyResponses.Query query) {
        var c = query.coordinate();
        // WGS84 meridional and parallel radii exceed 100,000 m/degree (parallel scaled by cos).
        // Use the maximum latitude along the path. At poles/date line use the entire world.
        double dy = query.radius() / 100_000.0;
        double dx = dy / Math.cos(Math.toRadians(Math.abs(c.lat()) + dy));
        if (Math.abs(c.lat()) >= 80 || Math.abs(c.lng()) + dx >= 180)
            return new Bounds(-180, -90, 180, 90);
        return new Bounds(c.lng() - dx, c.lat() - dy, c.lng() + dx, c.lat() + dy);
    }

    public List<Row> find(NearbyResponses.Query query) {
        var b = bounds(query);
        return jdbc.sql(publication.sql(SQL)).param("lng", query.coordinate().lng()).param("lat", query.coordinate().lat())
            // ST_DWithin is an intentionally wider candidate filter. ST_Distance <= radius is final.
            // This avoids dropping a measured 500.00000000m point through predicate rounding differences.
            .param("radius", query.radius()).param("candidateRadius", query.radius() + 1).param("listLimit", LIST_LIMIT)
            .param("minLng", b.minLng()).param("minLat", b.minLat()).param("maxLng", b.maxLng()).param("maxLat", b.maxLat())
            .query((rs, row) -> new Row(new Inventory(rs.getObject("cafe_id", Long.class), rs.getObject("mapped_id", Long.class),
                rs.getLong("total_stores"), rs.getLong("cafe_sources"), rs.getLong("usable_cafes"), rs.getLong("unclassified"),
                rs.getLong("conflicting"), rs.getLong("missing_location"), rs.getLong("invalid_location"),
                rs.getLong("incomplete_source_coordinates")), rs.getLong("total_count"),
                rs.getString("source_store_id") == null ? null : new NearbyResponses.Store(rs.getString("source_store_id"),
                    rs.getString("name"), new NearbyResponses.Coordinate(rs.getDouble("lat"), rs.getDouble("lng")), rs.getDouble("distance_meters"))))
            .list();
    }
}
