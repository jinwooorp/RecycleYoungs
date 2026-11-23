package kr.ac.recycleyoungs.sales;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 현행 자치구와 통계 준비 상태를 판정하고 배치·통계를 같은 스냅샷에서 읽는다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class DistrictSalesStatService {

  private final RegionRepository regions;
  private final DistrictSalesStatRepository repository;

  public DistrictSalesStatService(
      RegionRepository regions, DistrictSalesStatRepository repository) {
    this.regions = regions;
    this.repository = repository;
  }

  public DistrictSalesStatResponse getSales(
      String districtCode, String quarterCode, String industryCode) {
    var boundary =
        regions
            .findLatestPublishedBatch()
            .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
    if (regions.findDistrict(boundary.batchId(), districtCode).isEmpty()) {
      throw new ApiException(ApiErrorCode.REGION_NOT_FOUND);
    }
    if (!repository.hasPublishedData()) {
      throw new ApiException(ApiErrorCode.DATA_NOT_READY);
    }
    // 데이터셋 준비 이후 조건별 누락만 정상 null이다. 다른 분기나 0으로 대체하지 않는다.
    return new DistrictSalesStatResponse(
        districtCode,
        quarterCode,
        industryCode,
        repository.findSales(districtCode, quarterCode, industryCode).orElse(null));
  }
}
