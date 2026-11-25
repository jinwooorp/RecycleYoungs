package kr.ac.recycleyoungs.statistics;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.foottraffic.DistrictFootTrafficStatRepository;
import kr.ac.recycleyoungs.foottraffic.FootTrafficStatRepository;
import kr.ac.recycleyoungs.region.RegionRepository;
import kr.ac.recycleyoungs.sales.DistrictSalesStatRepository;
import kr.ac.recycleyoungs.sales.SalesStatRepository;
import kr.ac.recycleyoungs.statistics.StatisticsQuarterResponse.Quarter;
import kr.ac.recycleyoungs.store.DistrictStoreStatRepository;
import kr.ac.recycleyoungs.store.StoreStatRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 현행 경계와 여섯 지표의 게시 분기를 한 스냅샷에서 조회한다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class StatisticsQuarterService {

  private static final String INDUSTRY = "CS100010";
  private static final List<String> METRICS = List.of("stores", "sales", "foot-traffic");

  private final RegionRepository regions;
  private final DistrictStoreStatRepository districtStores;
  private final DistrictSalesStatRepository districtSales;
  private final DistrictFootTrafficStatRepository districtFootTraffic;
  private final StoreStatRepository dongStores;
  private final SalesStatRepository dongSales;
  private final FootTrafficStatRepository dongFootTraffic;

  public StatisticsQuarterService(
      RegionRepository regions,
      DistrictStoreStatRepository districtStores,
      DistrictSalesStatRepository districtSales,
      DistrictFootTrafficStatRepository districtFootTraffic,
      StoreStatRepository dongStores,
      SalesStatRepository dongSales,
      FootTrafficStatRepository dongFootTraffic) {
    this.regions = regions;
    this.districtStores = districtStores;
    this.districtSales = districtSales;
    this.districtFootTraffic = districtFootTraffic;
    this.dongStores = dongStores;
    this.dongSales = dongSales;
    this.dongFootTraffic = dongFootTraffic;
  }

  public StatisticsQuarterResponse getQuarters() {
    var boundary =
        regions
            .findLatestPublishedBatch()
            .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY))
            .batchId();
    var districts =
        metricsByQuarter(
            districtStores.findPublishedQuarters(boundary, INDUSTRY),
            districtSales.findPublishedQuarters(boundary, INDUSTRY),
            districtFootTraffic.findPublishedQuarters(boundary));
    var dongs =
        metricsByQuarter(
            dongStores.findPublishedQuarters(boundary, INDUSTRY),
            dongSales.findPublishedQuarters(boundary, INDUSTRY),
            dongFootTraffic.findPublishedQuarters(boundary));
    var codes = new TreeSet<String>(Comparator.reverseOrder());
    codes.addAll(districts.keySet());
    codes.addAll(dongs.keySet());
    var quarters =
        codes.stream()
            .map(
                code ->
                    new Quarter(
                        code,
                        districts.getOrDefault(code, List.of()),
                        dongs.getOrDefault(code, List.of())))
            .toList();
    var defaultQuarter =
        quarters.stream()
            .filter(q -> q.districtMetrics().equals(METRICS) && q.dongMetrics().equals(METRICS))
            .findFirst()
            .or(() -> quarters.stream().findFirst())
            .map(Quarter::quarterCode)
            .orElse(null);
    return new StatisticsQuarterResponse(INDUSTRY, defaultQuarter, quarters);
  }

  private static Map<String, List<String>> metricsByQuarter(
      List<String> stores, List<String> sales, List<String> footTraffic) {
    var byQuarter = new HashMap<String, List<String>>();
    var quartersByMetric = List.of(stores, sales, footTraffic);
    for (int i = 0; i < METRICS.size(); i++) {
      var metric = METRICS.get(i);
      for (var quarter : quartersByMetric.get(i)) {
        byQuarter.computeIfAbsent(quarter, key -> new ArrayList<>()).add(metric);
      }
    }
    return byQuarter;
  }
}
