package kr.ac.recycleyoungs.foottraffic;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 현행 행정동·유동인구 준비 상태와 통계 출처를 하나의 읽기 스냅샷에서 확인한다. */
@Service
@Profile("db")
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class FootTrafficStatService {

  private final RegionRepository regions;
  private final FootTrafficStatRepository repository;

  public FootTrafficStatService(RegionRepository regions, FootTrafficStatRepository repository) {
    this.regions = regions;
    this.repository = repository;
  }

  public FootTrafficStatResponse getFootTraffic(String dongCode, String quarterCode) {
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
    // 조건별 미존재만 정상 null이며 다른 분기·0으로 보충하지 않는다.
    return new FootTrafficStatResponse(
        dongCode, quarterCode, repository.findFootTraffic(dongCode, quarterCode).orElse(null));
  }
}
