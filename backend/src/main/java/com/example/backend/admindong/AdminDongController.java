package com.example.backend.admindong;

import java.util.List;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class AdminDongController {
    private final AdminDongService service;
    public AdminDongController(AdminDongService service) { this.service = service; }

    @GetMapping("/api/admin-dongs")
    public List<ApiResponses.NamedCode> dongs(@RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query);
        return service.dongs();
    }
    @GetMapping("/api/industries")
    public List<ApiResponses.NamedCode> industries(@RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query);
        return service.industries();
    }
    @GetMapping("/api/quarters")
    public List<ApiResponses.Quarter> quarters(@RequestParam MultiValueMap<String, String> query) {
        QueryValidator.noQuery(query);
        return service.quarters();
    }

    @GetMapping("/api/admin-dong-stats")
    public ApiResponses.Stats stats(@RequestParam MultiValueMap<String, String> query) {
        return service.stats(QueryValidator.stats(query));
    }
}
