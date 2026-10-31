package kr.ac.recycleyoungs.foottraffic;

import static org.hamcrest.Matchers.nullValue;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.stream.Stream;
import kr.ac.recycleyoungs.api.ApiErrorCode;
import kr.ac.recycleyoungs.api.ApiException;
import kr.ac.recycleyoungs.foottraffic.FootTrafficStatResponse.FootTrafficData;
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

/** 동·분기 입력과 업종 파라미터 거부, 소수 문자열·NULL·공통 오류 계약을 확인한다. */
@WebMvcTest(FootTrafficStatController.class)
@ActiveProfiles("db")
class FootTrafficStatControllerTests {

  @Autowired private MockMvc mvc;
  @MockitoBean private FootTrafficStatService service;

  @ParameterizedTest
  @MethodSource("invalidParameters")
  void rejectsInvalidFormatBeforeService(String dong, String quarter) throws Exception {
    mvc.perform(get("/api/v1/dongs/{dong}/stats/foot-traffic", dong).param("quarterCode", quarter))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  static Stream<Arguments> invalidParameters() {
    return Stream.of(
        Arguments.of("0011000", "20262"),
        Arguments.of("001100001", "20262"),
        Arguments.of("0011000１", "20262"),
        Arguments.of("0011000A", "20262"),
        Arguments.of("00110001 ", "20262"),
        Arguments.of("00110001", ""),
        Arguments.of("00110001", " "),
        Arguments.of("00110001", "20260"),
        Arguments.of("00110001", "20265"),
        Arguments.of("00110001", "2026"),
        Arguments.of("00110001", "202612"),
        Arguments.of("00110001", "２０２６2"),
        Arguments.of("00110001", "20262\n"),
        Arguments.of("00110001", "20262,20262"));
  }

  @Test
  void rejectsMissingAndRepeatedQuarterIncludingIdenticalValues() throws Exception {
    mvc.perform(get("/api/v1/dongs/00110001/stats/foot-traffic"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    for (var second : new String[] {"20262", "20261"}) {
      mvc.perform(
              get("/api/v1/dongs/00110001/stats/foot-traffic")
                  .param("quarterCode", "20262", second))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    }
    verifyNoInteractions(service);
  }

  @ParameterizedTest
  @ValueSource(strings = {"CS100010", "", " ", "invalid"})
  void rejectsAnyIndustryParameterIncludingEmptyAndRepeatedValues(String industry)
      throws Exception {
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/foot-traffic")
                .param("quarterCode", "20262")
                .param("industryCode", industry))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/foot-traffic")
                .param("quarterCode", "20262")
                .param("industryCode", industry, industry))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @Test
  void rejectsIndustryParameterWithNoEqualsSign() throws Exception {
    mvc.perform(get("/api/v1/dongs/00110001/stats/foot-traffic?quarterCode=20262&industryCode"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @Test
  void serializesNumericScaleAndExplicitNullWithoutIndustryKey() throws Exception {
    when(service.getFootTraffic("00110001", "20262"))
        .thenReturn(
            new FootTrafficStatResponse(
                "00110001",
                "20262",
                new FootTrafficData(
                    "9007199254740993.123456789012345678900",
                    null,
                    "0.0000",
                    new PublishedBatch(
                        new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z")))));
    mvc.perform(get("/api/v1/dongs/00110001/stats/foot-traffic").param("quarterCode", "20262"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dongCode").value("00110001"))
        .andExpect(jsonPath("$.quarterCode").value("20262"))
        .andExpect(jsonPath("$.industryCode").doesNotExist())
        .andExpect(jsonPath("$.data.totalFootTraffic").isString())
        .andExpect(
            jsonPath("$.data.totalFootTraffic").value("9007199254740993.123456789012345678900"))
        .andExpect(jsonPath("$.data.maleFootTraffic").value(nullValue()))
        .andExpect(jsonPath("$.data.femaleFootTraffic").value("0.0000"))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(new UUID(0, 2).toString()));
  }

  @Test
  void returnsDataNullWithRequestedIdentifiers() throws Exception {
    when(service.getFootTraffic("00110001", "20262"))
        .thenReturn(new FootTrafficStatResponse("00110001", "20262", null));
    mvc.perform(get("/api/v1/dongs/00110001/stats/foot-traffic").param("quarterCode", "20262"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(nullValue()))
        .andExpect(jsonPath("$.quarterCode").value("20262"))
        .andExpect(jsonPath("$.industryCode").doesNotExist());
  }

  @ParameterizedTest
  @ValueSource(strings = {"REGION_NOT_FOUND", "DATA_NOT_READY"})
  void reusesCommonProblemDetail(String code) throws Exception {
    var error = ApiErrorCode.valueOf(code);
    when(service.getFootTraffic("00110001", "20262")).thenThrow(new ApiException(error));
    mvc.perform(get("/api/v1/dongs/00110001/stats/foot-traffic").param("quarterCode", "20262"))
        .andExpect(status().is(error.status().value()))
        .andExpect(jsonPath("$.code").value(code));
  }
}
