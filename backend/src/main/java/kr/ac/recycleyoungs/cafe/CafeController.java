package kr.ac.recycleyoungs.cafe;

import java.util.List;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import org.jspecify.annotations.Nullable;
import org.springframework.context.annotation.Profile;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** DB 조회 전에 WGS84 좌표·반경·지도 영역·반복 구 코드와 제한된 페이징을 검증한다. */
@RestController
@RequestMapping("/api/v1/cafes")
@Profile("db")
public class CafeController {

  private final CafeService service;

  public CafeController(CafeService service) {
    this.service = service;
  }

  @GetMapping("/nearby")
  public CafeResponse nearby(@RequestParam MultiValueMap<String, String> parameters) {
    var longitude = decimal(scalar(parameters, "longitude", null), -180, 180);
    var latitude = decimal(scalar(parameters, "latitude", null), -90, 90);
    var radiusM = decimal(scalar(parameters, "radiusM", "500"), 1, 1000);
    var limit = integer(scalar(parameters, "limit", "100"), 1, 500);
    var offset = integer(scalar(parameters, "offset", "0"), 0, 100000);
    return service.getNearby(
        longitude, latitude, radiusM, districtCodes(parameters), limit, offset);
  }

  @GetMapping("/viewport")
  public CafeViewportResponse viewport(@RequestParam MultiValueMap<String, String> parameters) {
    var west = decimal(scalar(parameters, "west", null), -180, 180);
    var south = decimal(scalar(parameters, "south", null), -90, 90);
    var east = decimal(scalar(parameters, "east", null), -180, 180);
    var north = decimal(scalar(parameters, "north", null), -90, 90);
    // 날짜변경선을 가로지르는 영역이나 면적이 0인 사각형을 묵시적으로 보정하지 않는다.
    if (west >= east || south >= north) throw invalid();
    var limit = integer(scalar(parameters, "limit", "100"), 1, 500);
    var offset = integer(scalar(parameters, "offset", "0"), 0, 100000);
    return service.getViewport(west, south, east, north, districtCodes(parameters), limit, offset);
  }

  private List<String> districtCodes(MultiValueMap<String, String> parameters) {
    var codes = parameters.getOrDefault("districtCodes", List.of());
    for (var code : codes) {
      if (code == null || !code.matches("[0-9]{5}")) throw invalid();
    }
    return codes.stream().distinct().sorted().toList();
  }

  private String scalar(
      MultiValueMap<String, String> parameters, String name, @Nullable String defaultValue) {
    var values = parameters.get(name);
    // 기본값은 생략에만 적용한다. 같은 값의 중복·빈 값도 묵시적으로 보정하지 않는다.
    if (values == null && defaultValue != null) return defaultValue;
    if (values == null
        || values.size() != 1
        || values.getFirst() == null
        || values.getFirst().isBlank()) throw invalid();
    return values.getFirst();
  }

  private double decimal(String value, double minimum, double maximum) {
    // Java 전용 16진수·타입 접미사·공백을 제외하고 십진수와 지수 표기만 허용한다.
    if (!value.matches("[+-]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?"))
      throw invalid();
    try {
      var number = Double.parseDouble(value);
      if (!Double.isFinite(number) || number < minimum || number > maximum) throw invalid();
      return number;
    } catch (NumberFormatException exception) {
      throw invalid();
    }
  }

  private int integer(String value, int minimum, int maximum) {
    if (!value.matches("[0-9]+")) throw invalid();
    try {
      var number = Integer.parseInt(value);
      if (number < minimum || number > maximum) throw invalid();
      return number;
    } catch (NumberFormatException exception) {
      throw invalid();
    }
  }

  private ApiException invalid() {
    return new ApiException(ApiErrorCode.INVALID_PARAMETER);
  }
}
