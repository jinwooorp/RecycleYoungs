package kr.ac.recycleyoungs.score;

import java.util.List;
import java.util.Set;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import org.springframework.context.annotation.Profile;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 승인 전 점수 공개 차단 경로. DB·내부 계산·승인 도구 의존성을 갖지 않는다. */
@RestController
@Profile("db")
public class ScoreController {

  @GetMapping("/api/v1/districts/{districtCode}/score")
  public void districtScore(
      @PathVariable("districtCode") String districtCode,
      @RequestParam MultiValueMap<String, String> parameters) {
    rejectUnapproved(districtCode, "[0-9]{5}", parameters);
  }

  @GetMapping("/api/v1/dongs/{dongCode}/score")
  public void dongScore(
      @PathVariable("dongCode") String dongCode,
      @RequestParam MultiValueMap<String, String> parameters) {
    rejectUnapproved(dongCode, "[0-9]{8}", parameters);
  }

  private void rejectUnapproved(
      String regionCode, String codePattern, MultiValueMap<String, String> parameters) {
    // 정확히 일치하는 값 목록만 허용해 형식·지원 값·필수·중복·추가 query를 검사한다. 원문은 보정하지 않는다.
    if (!regionCode.matches(codePattern)
        || !parameters.keySet().equals(Set.of("quarterCode", "industryCode"))
        || !List.of("20262").equals(parameters.get("quarterCode"))
        || !List.of("CS100010").equals(parameters.get("industryCode"))) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    // 실제 승인 게이트가 없으므로 지역 존재 확인이나 내부 계산에 진입하지 않고 항상 차단한다.
    throw new ApiException(ApiErrorCode.DATA_NOT_READY);
  }
}
