package kr.ac.recycleyoungs.region;

import java.util.List;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionResponse.BoundaryFeature;
import kr.ac.recycleyoungs.region.RegionResponse.DistrictList;
import kr.ac.recycleyoungs.region.RegionResponse.DongList;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyRegions;
import org.springframework.context.annotation.Profile;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** db 프로필에서만 행정구역 조회 API를 제공하고 DB 접근 전에 조회 조건을 검증한다. */
@RestController
@RequestMapping("/api/v1")
@Profile("db")
public class RegionController {

  private final RegionService service;

  public RegionController(RegionService service) {
    this.service = service;
  }

  @GetMapping("/districts")
  public DistrictList districts() {
    return service.getDistricts();
  }

  @GetMapping("/districts/{districtCode}/dongs")
  public DongList dongs(@PathVariable("districtCode") String districtCode) {
    validateCode(districtCode, 5);
    return service.getDongs(districtCode);
  }

  @GetMapping(value = "/districts/{districtCode}/boundary", produces = "application/geo+json")
  public BoundaryFeature districtBoundary(@PathVariable("districtCode") String districtCode) {
    validateCode(districtCode, 5);
    return service.getDistrictBoundary(districtCode);
  }

  @GetMapping(value = "/dongs/{dongCode}/boundary", produces = "application/geo+json")
  public BoundaryFeature dongBoundary(@PathVariable("dongCode") String dongCode) {
    validateCode(dongCode, 8);
    return service.getDongBoundary(dongCode);
  }

  @GetMapping("/regions/nearby")
  public NearbyRegions nearby(
      @RequestParam("longitude") double longitude,
      @RequestParam("latitude") double latitude,
      @RequestParam(value = "radiusM", defaultValue = "500") double radiusM,
      @RequestParam MultiValueMap<String, String> parameters) {
    if (!Double.isFinite(longitude)
        || longitude < -180
        || longitude > 180
        || !Double.isFinite(latitude)
        || latitude < -90
        || latitude > 90
        || !Double.isFinite(radiusM)
        || radiusM < 1
        || radiusM > 1000) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
    for (var name : List.of("longitude", "latitude", "radiusM")) {
      var values = parameters.get(name);
      // 기본 반경은 파라미터 생략에만 적용하고 빈 값·중복 단일값은 거부한다.
      if (values != null && (values.size() != 1 || values.getFirst().isBlank())) {
        throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
      }
    }
    // 원문 반복 파라미터를 읽어 쉼표 목록의 묵시적 분할이나 빈 코드 허용을 피한다.
    var codes = parameters.getOrDefault("districtCodes", List.of());
    codes.forEach(code -> validateCode(code, 5));
    return service.getNearby(
        longitude, latitude, radiusM, codes.stream().distinct().sorted().toList());
  }

  private void validateCode(String code, int length) {
    // 숫자 변환·trim·Unicode 숫자 허용 없이 원본 문자열의 길이와 ASCII 형식을 검증한다.
    if (!code.matches("[0-9]{" + length + "}")) {
      throw new ApiException(ApiErrorCode.INVALID_PARAMETER);
    }
  }
}
