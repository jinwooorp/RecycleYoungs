package kr.ac.recycleyoungs.store;

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
import kr.ac.recycleyoungs.region.RegionResponse.PublishedBatch;
import kr.ac.recycleyoungs.store.StoreStatResponse.StoreData;
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

/** 요청 원문을 엄격하게 검증하고 수치 문자열·명시적 null·ProblemDetail을 유지한다. */
@WebMvcTest(StoreStatController.class)
@ActiveProfiles("db")
class StoreStatControllerTests {

  @Autowired private MockMvc mvc;
  @MockitoBean private StoreStatService service;

  @ParameterizedTest
  @MethodSource("invalidParameters")
  void rejectsInvalidFormatBeforeService(String dong, String quarter, String industry)
      throws Exception {
    mvc.perform(
            get("/api/v1/dongs/{dong}/stats/stores", dong)
                .param("quarterCode", quarter)
                .param("industryCode", industry))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  static Stream<Arguments> invalidParameters() {
    return Stream.of(
        Arguments.of("0011000", "20262", "CS100010"),
        Arguments.of("001100001", "20262", "CS100010"),
        Arguments.of("0011000１", "20262", "CS100010"),
        Arguments.of("0011000A", "20262", "CS100010"),
        Arguments.of("00110001 ", "20262", "CS100010"),
        Arguments.of("00110001", "", "CS100010"),
        Arguments.of("00110001", " ", "CS100010"),
        Arguments.of("00110001", "20260", "CS100010"),
        Arguments.of("00110001", "20265", "CS100010"),
        Arguments.of("00110001", "2026", "CS100010"),
        Arguments.of("00110001", "202612", "CS100010"),
        Arguments.of("00110001", "２０２６2", "CS100010"),
        Arguments.of("00110001", "20262\n", "CS100010"),
        Arguments.of("00110001", "20262,20262", "CS100010"),
        Arguments.of("00110001", "20262", ""),
        Arguments.of("00110001", "20262", " "),
        Arguments.of("00110001", "20262", "cs100010"),
        Arguments.of("00110001", "20262", "CS10001"),
        Arguments.of("00110001", "20262", "CS1000100"),
        Arguments.of("00110001", "20262", "CS10001０"),
        Arguments.of("00110001", "20262", "CS100010 "),
        Arguments.of("00110001", "20262", "CS100010,CS100010"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"quarterCode", "industryCode"})
  void rejectsMissingAndRepeatedParametersEvenWithIdenticalValues(String name) throws Exception {
    var other = name.equals("quarterCode") ? "industryCode" : "quarterCode";
    var value = name.equals("quarterCode") ? "20262" : "CS100010";
    var otherValue = name.equals("quarterCode") ? "CS100010" : "20262";
    mvc.perform(get("/api/v1/dongs/00110001/stats/stores").param(other, otherValue))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/stores")
                .param(other, otherValue)
                .param(name, value, value))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    verifyNoInteractions(service);
  }

  @Test
  void serializesMeasurementsAsStringsAndKeepsExplicitNulls() throws Exception {
    when(service.getStores("00110001", "20262", "CS100010"))
        .thenReturn(
            new StoreStatResponse(
                "00110001",
                "20262",
                "CS100010",
                new StoreData(
                    "9007199254740993",
                    null,
                    "0",
                    "1",
                    "2",
                    "123.45678901234567890",
                    null,
                    new PublishedBatch(
                        new UUID(0, 2), OffsetDateTime.parse("2026-10-02T00:00:00Z")))));
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/stores")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.dongCode").value("00110001"))
        .andExpect(jsonPath("$.quarterCode").value("20262"))
        .andExpect(jsonPath("$.industryCode").value("CS100010"))
        .andExpect(jsonPath("$.data.storeCount").isString())
        .andExpect(jsonPath("$.data.storeCount").value("9007199254740993"))
        .andExpect(jsonPath("$.data.generalStoreCount").value(nullValue()))
        .andExpect(jsonPath("$.data.franchiseStoreCount").value("0"))
        .andExpect(jsonPath("$.data.openingRate").value("123.45678901234567890"))
        .andExpect(jsonPath("$.data.closureRate").value(nullValue()))
        .andExpect(jsonPath("$.data.sourceBatch.batchId").value(new UUID(0, 2).toString()));
  }

  @Test
  void returnsDataNullWithoutRemovingRequestedIdentifiers() throws Exception {
    when(service.getStores("00110001", "20262", "CS100010"))
        .thenReturn(new StoreStatResponse("00110001", "20262", "CS100010", null));
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/stores")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(nullValue()))
        .andExpect(jsonPath("$.quarterCode").value("20262"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"REGION_NOT_FOUND", "DATA_NOT_READY"})
  void reusesCommonProblemDetail(String code) throws Exception {
    var error = ApiErrorCode.valueOf(code);
    when(service.getStores("00110001", "20262", "CS100010")).thenThrow(new ApiException(error));
    mvc.perform(
            get("/api/v1/dongs/00110001/stats/stores")
                .param("quarterCode", "20262")
                .param("industryCode", "CS100010"))
        .andExpect(status().is(error.status().value()))
        .andExpect(jsonPath("$.code").value(code));
  }
}
