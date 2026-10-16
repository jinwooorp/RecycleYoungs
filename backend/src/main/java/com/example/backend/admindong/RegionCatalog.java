package com.example.backend.admindong;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

@Component
public class RegionCatalog {
    record Dong(String code, String name, String districtCode, String districtName) {}
    private final List<Dong> dongs;
    public RegionCatalog() {
        try (var reader = new BufferedReader(new InputStreamReader(new ClassPathResource("regions/seoul-admin-dongs.tsv").getInputStream(), StandardCharsets.UTF_8))) {
            dongs = reader.lines().map(line -> {
                var fields = line.split("\t", -1);
                if (fields.length != 4 || !fields[0].matches("11[0-9]{6}") || !fields[2].equals(fields[0].substring(0, 5)))
                    throw new IllegalStateException("Invalid region catalog");
                return new Dong(fields[0], fields[1], fields[2], fields[3]);
            }).toList();
            if (dongs.size() != 425 || dongs.stream().map(Dong::code).distinct().count() != 425
                || dongs.stream().map(Dong::districtCode).distinct().count() != 25) throw new IllegalStateException("Invalid region inventory");
        } catch (java.io.IOException ex) { throw new IllegalStateException("Region catalog unavailable", ex); }
    }
    List<Dong> dongs() { return dongs; }
}
