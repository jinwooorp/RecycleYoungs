package com.example.backend.location;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LocationController {
    private final LocationService service;
    public LocationController(LocationService service) { this.service = service; }

    @GetMapping("/api/locations/resolve")
    public LocationResponses.Resolution resolve(@RequestParam MultiValueMap<String, String> query) {
        return service.resolve(LocationQueryValidator.coordinate(query));
    }
}
