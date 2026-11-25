package kr.ac.recycleyoungs.foottraffic;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import org.springframework.context.annotation.Profile;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** db 프로필에서 업종과 무관한 자치구·분기 유동인구를 조회하고 요청 원문을 검증한다. */
@RestController
@Profile("db")
public class DistrictFootTrafficStatController {

  private final DistrictFootTrafficStatService service;

  public DistrictFootTrafficStatController(DistrictFootTrafficStatService service) {
    this.service = service;
  }

  @GetMapping("/api/v1/districts/{districtCode}/stats/foot-traffic")
  public DistrictFootTrafficStatResponse footTraffic(
      @PathVariable("districtCode") String districtCode,
      @RequestParam MultiValueMap<String, String> parameters) {
    var quarters = parameters.get("quarterCode");
    // 유동인구에는 업종 차원이 없다. 빈 값이나 값 없는 키도 묵시적으로 무시하지 않는다.
    if (parameters.containsKey("industryCode")
        || !districtCode.matches("[0-9]{5}")
        || quarters == null
        || quarters.size() != 1
        || !quarters.getFirst().matches("[0-9]{4}[1-4]")) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    return service.getFootTraffic(districtCode, quarters.getFirst());
  }
}
