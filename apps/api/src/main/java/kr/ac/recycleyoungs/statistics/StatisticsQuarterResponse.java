package kr.ac.recycleyoungs.statistics;

import java.util.List;
import org.jspecify.annotations.Nullable;

public record StatisticsQuarterResponse(
    String industryCode, @Nullable String defaultQuarterCode, List<Quarter> quarters) {

  public record Quarter(
      String quarterCode, List<String> districtMetrics, List<String> dongMetrics) {}
}
