package kr.ac.recycleyoungs.cafe;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.cafe.CafeResponse.Cafe;
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 좌표·반경·반복 구 코드·페이징 검증과 외부 응답 계약을 확인한다. */
@WebMvcTest(CafeController.class)
@ActiveProfiles("db")
class CafeControllerTests {

  @Autowired private MockMvc mvc;
  @MockitoBean private CafeService service;

  @Test
  void appliesDefaultsAndKeepsSourceIdentifiersAndOptionalFields() throws Exception {
    var batch = new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z"));
    when(service.getNearby(127, 37, 500, List.of(), 100, 0))
        .thenReturn(
            new CafeResponse(
                List.of(new Cafe("000001", "예시카페", null, "I21201", "카페", null, "예시주소", 127, 37, 0)),
                1,
                100,
                0,
                false,
                batch));
    mvc.perform(request())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].bizesId").value("000001"))
        .andExpect(jsonPath("$.items[0].branchName").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.items[0].semasIndustryCode").value("I21201"))
        .andExpect(jsonPath("$.items[0].roadAddress").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.items[0].lotAddress").value("예시주소"))
        .andExpect(jsonPath("$.items[0].longitude").value(127))
        .andExpect(jsonPath("$.items[0].latitude").value(37))
        .andExpect(jsonPath("$.items[0].distanceM").value(0))
        .andExpect(jsonPath("$.totalCount").value(1))
        .andExpect(jsonPath("$.limit").value(100))
        .andExpect(jsonPath("$.offset").value(0))
        .andExpect(jsonPath("$.hasMore").value(false))
        .andExpect(jsonPath("$.sourceBatch.batchId").value(batch.batchId().toString()))
        .andExpect(jsonPath("$.sourceBatch.sourceReference").doesNotExist());
  }

  @Test
  void normalizesOnlyRepeatedDistrictCodesAndAcceptsFractionalRadius() throws Exception {
    var batch = new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z"));
    when(service.getNearby(127, 37, 999.5, List.of("00110", "00140"), 500, 100000))
        .thenReturn(new CafeResponse(List.of(), 2, 500, 100000, false, batch));
    mvc.perform(
            request()
                .param("districtCodes", "00140", "00110", "00140")
                .param("radiusM", "999.5")
                .param("limit", "500")
                .param("offset", "100000"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.offset").value(100000));
  }

  @ParameterizedTest
  @MethodSource("validBounds")
  void acceptsCoordinateAndRadiusBoundsAndDecimalExponents(
      String longitude, String latitude, String radius, double x, double y, double meters)
      throws Exception {
    var batch = new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z"));
    when(service.getNearby(x, y, meters, List.of(), 1, 0))
        .thenReturn(new CafeResponse(List.of(), 0, 1, 0, false, batch));
    mvc.perform(
            get("/api/v1/cafes/nearby")
                .param("longitude", longitude)
                .param("latitude", latitude)
                .param("radiusM", radius)
                .param("limit", "1"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items").isEmpty());
  }

  static Stream<Arguments> validBounds() {
    return Stream.of(
        Arguments.of("180", "90", "1", 180d, 90d, 1d),
        Arguments.of("-180", "-90", "1000", -180d, -90d, 1000d),
        Arguments.of("1.27e2", "3.7E1", "5e2", 127d, 37d, 500d));
  }

  @ParameterizedTest
  @ValueSource(strings = {"longitude", "latitude"})
  void requiresBothCoordinates(String missing) throws Exception {
    var request = get("/api/v1/cafes/nearby");
    request.param(missing.equals("longitude") ? "latitude" : "longitude", "37");
    mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @ParameterizedTest
  @ValueSource(strings = {"longitude", "latitude", "radiusM", "limit", "offset"})
  void rejectsIdenticalRepeatedScalarParameters(String name) throws Exception {
    var request = request();
    // 필수 좌표는 기본값에 하나를 더 추가하고 선택 값은 동일한 값을 두 번 보낸다.
    if (name.equals("longitude")) request.param(name, "127");
    else if (name.equals("latitude")) request.param(name, "37");
    else request.param(name, "1", "1");
    mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @ParameterizedTest
  @MethodSource("invalidParameters")
  void rejectsMalformedOutOfRangeAndEmptyValues(String name, String value) throws Exception {
    var request = get("/api/v1/cafes/nearby");
    request.param("longitude", name.equals("longitude") ? value : "127");
    request.param("latitude", name.equals("latitude") ? value : "37");
    if (!name.equals("longitude") && !name.equals("latitude")) request.param(name, value);
    mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  static Stream<Arguments> invalidParameters() {
    return Stream.concat(
        Stream.of("longitude", "latitude", "radiusM", "limit", "offset", "districtCodes")
            .flatMap(
                name ->
                    Stream.of("", " ", "NaN", "Infinity", "1,2")
                        .map(value -> Arguments.of(name, value))),
        Stream.of(
            Arguments.of("longitude", "180.01"),
            Arguments.of("longitude", "-180.01"),
            Arguments.of("longitude", "1e309"),
            Arguments.of("longitude", "0x1.0p1"),
            Arguments.of("longitude", "127d"),
            Arguments.of("longitude", " 127"),
            Arguments.of("longitude", "１２７"),
            Arguments.of("latitude", "90.01"),
            Arguments.of("latitude", "-90.01"),
            Arguments.of("radiusM", "0.99"),
            Arguments.of("radiusM", "1000.01"),
            Arguments.of("radiusM", "-1"),
            Arguments.of("limit", "0"),
            Arguments.of("limit", "501"),
            Arguments.of("limit", "1.0"),
            Arguments.of("limit", "1e2"),
            Arguments.of("limit", "2147483648"),
            Arguments.of("offset", "-1"),
            Arguments.of("offset", "100001"),
            Arguments.of("offset", "+1"),
            Arguments.of("offset", "99999999999999999999"),
            Arguments.of("districtCodes", "1111"),
            Arguments.of("districtCodes", "111100"),
            Arguments.of("districtCodes", "１１１１０"),
            Arguments.of("districtCodes", "1111A"),
            Arguments.of("districtCodes", "11110 "),
            Arguments.of("districtCodes", "11110,11140")));
  }

  @Test
  void usesCommonRegionAndDataReadinessProblems() throws Exception {
    when(service.getNearby(127, 37, 500, List.of(), 100, 0))
        .thenThrow(new ApiException(ApiErrorCode.DATA_NOT_READY));
    mvc.perform(request())
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
    when(service.getNearby(127, 37, 500, List.of("99999"), 100, 0))
        .thenThrow(new ApiException(ApiErrorCode.REGION_NOT_FOUND));
    mvc.perform(request().param("districtCodes", "99999"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  private MockHttpServletRequestBuilder request() {
    return get("/api/v1/cafes/nearby").param("longitude", "127").param("latitude", "37");
  }
}
