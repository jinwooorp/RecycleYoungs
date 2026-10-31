package kr.ac.recycleyoungs.sales;

import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import org.springframework.context.annotation.Profile;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** db 프로필에서 행정동별 분기·업종 추정매출을 제공하고 요청 원문을 검증한다. */
@RestController
@Profile("db")
public class SalesStatController {

  private final SalesStatService service;

  public SalesStatController(SalesStatService service) {
    this.service = service;
  }

  @GetMapping("/api/v1/dongs/{dongCode}/stats/sales")
  public SalesStatResponse sales(
      @PathVariable("dongCode") String dongCode,
      @RequestParam MultiValueMap<String, String> parameters) {
    if (!dongCode.matches("[0-9]{8}")) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    var quarterCode = requiredParameter(parameters, "quarterCode", "[0-9]{4}[1-4]");
    var industryCode = requiredParameter(parameters, "industryCode", "CS[0-9]{6}");
    return service.getSales(dongCode, quarterCode, industryCode);
  }

  private String requiredParameter(
      MultiValueMap<String, String> parameters, String name, String pattern) {
    var values = parameters.get(name);
    // 원문을 보정하지 않고 동일 값 중복도 거부해 점포 통계와 같은 입력 계약을 유지한다.
    if (values == null || values.size() != 1 || !values.getFirst().matches(pattern)) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    return values.getFirst();
  }
}
