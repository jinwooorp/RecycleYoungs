package kr.ac.recycleyoungs.sales;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 현행 행정동과 추정매출 준비 여부를 판정하고 게시 중에도 동일 스냅샷을 사용한다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class SalesStatService {

  private final RegionRepository regions;
  private final SalesStatRepository repository;

  public SalesStatService(RegionRepository regions, SalesStatRepository repository) {
    this.regions = regions;
    this.repository = repository;
  }

  public SalesStatResponse getSales(String dongCode, String quarterCode, String industryCode) {
    var boundary =
        regions
            .findLatestPublishedBatch()
            .orElseThrow(() -> new ApiException(ApiErrorCode.DATA_NOT_READY));
    if (!regions.existsDong(boundary.batchId(), dongCode)) {
      throw new ApiException(ApiErrorCode.REGION_NOT_FOUND);
    }
    if (!repository.hasPublishedData()) {
      throw new ApiException(ApiErrorCode.DATA_NOT_READY);
    }
    // 데이터셋 미준비와 조건별 미존재를 구분하며 다른 분기·0·환산값으로 대체하지 않는다.
    return new SalesStatResponse(
        dongCode,
        quarterCode,
        industryCode,
        repository.findSales(dongCode, quarterCode, industryCode).orElse(null));
  }
}
