package kr.ac.recycleyoungs.region;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.region.RegionResponse.District;
import kr.ac.recycleyoungs.region.RegionResponse.DistrictList;
import kr.ac.recycleyoungs.region.RegionResponse.Dong;
import kr.ac.recycleyoungs.region.RegionResponse.DongList;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyDistrict;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyDong;
import kr.ac.recycleyoungs.region.RegionResponse.NearbyRegions;
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
import tools.jackson.databind.json.JsonMapper;

/** DB에 접근하기 전 코드 형식 검증과 목록 DTO·공통 오류 응답을 확인한다. */
@WebMvcTest(RegionController.class)
@ActiveProfiles("db")
class RegionControllerTests {

  @Autowired private MockMvc mvc;
  @MockitoBean private RegionService service;

  @Test
  void returnsDistrictAndDongListDtosWithoutConvertingCodesToNumbers() throws Exception {
    var labelPoint =
        JsonMapper.builder()
            .build()
            .readTree("{\"type\":\"Point\",\"coordinates\":[127.002,37.003]}");
    when(service.getDistricts())
        .thenReturn(new DistrictList(List.of(new District("00001", "테스트구"))));
    when(service.getDongs("00001"))
        .thenReturn(new DongList(List.of(new Dong("00001001", "00001", "테스트동", labelPoint))));
    mvc.perform(get("/api/v1/districts"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].districtCode").value("00001"));
    mvc.perform(get("/api/v1/districts/00001/dongs"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.items[0].dongCode").value("00001001"))
        .andExpect(jsonPath("$.items[0].labelPoint.type").value("Point"))
        .andExpect(jsonPath("$.items[0].labelPoint.coordinates[0]").value(127.002))
        .andExpect(jsonPath("$.items[0].labelPoint.coordinates[1]").value(37.003));
  }

  @ParameterizedTest
  @ValueSource(strings = {"1111", "111100", "1111A", "11１10", "-1111", "11110 "})
  void rejectsNonAsciiOrWrongLengthDistrictCodesBeforeService(String code) throws Exception {
    for (var suffix : List.of("dongs", "boundary")) {
      mvc.perform(get("/api/v1/districts/{code}/{suffix}", code, suffix))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    }
    verifyNoInteractions(service);
  }

  @ParameterizedTest
  @ValueSource(strings = {"1111000", "111100001", "1111000A", "1111000１", "-1111001", "11110001 "})
  void rejectsNonAsciiOrWrongLengthDongCodesBeforeService(String code) throws Exception {
    mvc.perform(get("/api/v1/dongs/{code}/boundary", code))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @Test
  void reusesCommonProblemDetailForMissingPublicationAndRegion() throws Exception {
    when(service.getDistricts()).thenThrow(new ApiException(ApiErrorCode.DATA_NOT_READY));
    when(service.getDistrictBoundary("99999"))
        .thenThrow(new ApiException(ApiErrorCode.REGION_NOT_FOUND));
    mvc.perform(get("/api/v1/districts"))
        .andExpect(status().isServiceUnavailable())
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
    mvc.perform(get("/api/v1/districts/99999/boundary"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.code").value("REGION_NOT_FOUND"));
  }

  @ParameterizedTest
  @MethodSource("invalidNearbyParameters")
  void rejectsInvalidNearbyParametersBeforeService(String name, String value) throws Exception {
    var request = get("/api/v1/regions/nearby");
    request.param("longitude", name.equals("longitude") ? value : "127");
    request.param("latitude", name.equals("latitude") ? value : "37");
    if (!name.equals("longitude") && !name.equals("latitude")) {
      request.param(name, value);
    }
    mvc.perform(request)
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  static java.util.stream.Stream<Arguments> invalidNearbyParameters() {
    return java.util.stream.Stream.of(
        Arguments.of("longitude", "NaN"),
        Arguments.of("longitude", "Infinity"),
        Arguments.of("longitude", "-Infinity"),
        Arguments.of("longitude", "180.01"),
        Arguments.of("longitude", "-180.01"),
        Arguments.of("longitude", "1e309"),
        Arguments.of("longitude", ""),
        Arguments.of("longitude", "not-a-number"),
        Arguments.of("latitude", "NaN"),
        Arguments.of("latitude", "90.01"),
        Arguments.of("latitude", "-90.01"),
        Arguments.of("radiusM", "0"),
        Arguments.of("radiusM", "0.99"),
        Arguments.of("radiusM", "1000.01"),
        Arguments.of("radiusM", "NaN"),
        Arguments.of("radiusM", "Infinity"),
        Arguments.of("radiusM", ""),
        Arguments.of("radiusM", " "),
        Arguments.of("districtCodes", "1111"),
        Arguments.of("districtCodes", "111100"),
        Arguments.of("districtCodes", "1111A"),
        Arguments.of("districtCodes", "１１１１０"),
        Arguments.of("districtCodes", "11110 "),
        Arguments.of("districtCodes", ""),
        Arguments.of("districtCodes", "11110,11140"));
  }

  @Test
  void requiresCoordinatesAndRejectsRepeatedScalarParameters() throws Exception {
    mvc.perform(get("/api/v1/regions/nearby").param("latitude", "37"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(get("/api/v1/regions/nearby").param("longitude", "127"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(
            get("/api/v1/regions/nearby")
                .param("longitude", "127")
                .param("latitude", "37")
                .param("radiusM", "500", "1000"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @Test
  void returnsNearbyDtoWithDefaultRadiusAndNormalizedRepeatedCodes() throws Exception {
    var publication =
        new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z"));
    when(service.getNearby(127, 37, 500, List.of("00001", "11110")))
        .thenReturn(
            new NearbyRegions(
                publication,
                List.of(new NearbyDistrict("00001", "테스트구", true)),
                List.of(new NearbyDong("00001001", "00001", "테스트동", true))));
    mvc.perform(
            get("/api/v1/regions/nearby")
                .param("longitude", "127")
                .param("latitude", "37")
                .param("districtCodes", "11110", "00001", "11110"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.boundaryBatch.batchId").value(publication.batchId().toString()))
        .andExpect(jsonPath("$.districts[0].districtCode").value("00001"))
        .andExpect(jsonPath("$.districts[0].containsCenter").value(true))
        .andExpect(jsonPath("$.dongs[0].dongCode").value("00001001"));
  }

  @Test
  void acceptsCoordinateLimitsAndFractionalMeterRadius() throws Exception {
    when(service.getNearby(180, -90, 1.5, List.of()))
        .thenReturn(
            new NearbyRegions(
                new PublishedBatch(new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z")),
                List.of(),
                List.of()));
    mvc.perform(
            get("/api/v1/regions/nearby")
                .param("longitude", "180")
                .param("latitude", "-90")
                .param("radiusM", "1.5"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.districts").isEmpty());
  }
}
