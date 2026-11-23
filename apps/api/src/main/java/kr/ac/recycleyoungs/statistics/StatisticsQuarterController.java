package kr.ac.recycleyoungs.statistics;

import org.springframework.context.annotation.Profile;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("db")
public class StatisticsQuarterController {

  private final StatisticsQuarterService service;

  public StatisticsQuarterController(StatisticsQuarterService service) {
    this.service = service;
  }

  @GetMapping("/api/v1/statistics/quarters")
  public StatisticsQuarterResponse quarters() {
    return service.getQuarters();
  }
}
