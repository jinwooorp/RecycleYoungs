package kr.ac.recycleyoungs.store;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 현행 행정동과 통계 준비 상태를 판정하고 배치·통계를 같은 스냅샷에서 읽는다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class StoreStatService {

  private final RegionRepository regions;
  private final StoreStatRepository repository;

  public StoreStatService(RegionRepository regions, StoreStatRepository repository) {
    this.regions = regions;
    this.repository = repository;
  }

  public StoreStatResponse getStores(String dongCode, String quarterCode, String industryCode) {
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
    // 데이터셋 준비 이후 조건별 누락만 정상 null이다. 다른 분기나 0으로 대체하지 않는다.
    return new StoreStatResponse(
        dongCode,
        quarterCode,
        industryCode,
        repository.findStores(dongCode, quarterCode, industryCode).orElse(null));
  }
}
