package kr.ac.recycleyoungs.sales;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import org.springframework.context.annotation.Profile;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** db 프로필에서 자치구별 분기·업종 추정매출 통계를 제공하고 요청 원문을 검증한다. */
@RestController
@Profile("db")
public class DistrictSalesStatController {

  private final DistrictSalesStatService service;

  public DistrictSalesStatController(DistrictSalesStatService service) {
    this.service = service;
  }

  @GetMapping("/api/v1/districts/{districtCode}/stats/sales")
  public DistrictSalesStatResponse sales(
      @PathVariable("districtCode") String districtCode,
      @RequestParam MultiValueMap<String, String> parameters) {
    if (!districtCode.matches("[0-9]{5}")) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    var quarterCode = requiredParameter(parameters, "quarterCode", "[0-9]{4}[1-4]");
    var industryCode = requiredParameter(parameters, "industryCode", "CS[0-9]{6}");
    return service.getSales(districtCode, quarterCode, industryCode);
  }

  private String requiredParameter(
      MultiValueMap<String, String> parameters, String name, String pattern) {
    var values = parameters.get(name);
    // 중복 값이 같더라도 거부한다. trim·숫자 변환·쉼표 분할로 잘못된 입력을 보정하지 않는다.
    if (values == null || values.size() != 1 || !values.getFirst().matches(pattern)) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    return values.getFirst();
  }
}
