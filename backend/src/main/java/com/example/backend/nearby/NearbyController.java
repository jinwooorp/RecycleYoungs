package com.example.backend.nearby;

import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class NearbyController {
    private final NearbyService service;
    public NearbyController(NearbyService service) { this.service = service; }

    @GetMapping("/api/nearby-stores")
    public NearbyResponses.Result nearby(@RequestParam MultiValueMap<String, String> query) {
        return service.find(NearbyQueryValidator.validate(query));
    }
}
