package kr.ac.recycleyoungs.score;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.stream.Stream;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** 승인 전 점수 경로는 원문 검증 뒤 반드시 차단하고 DB·내부 계산에 접근하지 않는다. */
@WebMvcTest(ScoreController.class)
@ActiveProfiles("db")
// 테스트용 승인 주장이다. 실제 설정이나 승인 스위치를 추가하는 것이 아니다.
@TestPropertySource(properties = {"SCORE_APPROVAL_ENABLED=1", "score.approval.status=APPROVED"})
class ScoreControllerTests {
  private static final List<String> PATHS =
      List.of("/api/v1/districts/00001/score", "/api/v1/dongs/00001001/score");

  @Autowired private MockMvc mvc;
  @MockitoBean private ScoreService service;
  @MockitoBean private ScoreInputRepository repository;
  @MockitoBean private DataSource dataSource;

  @AfterEach
  void neverQueriesOrCalculatesScores() {
    verifyNoInteractions(service, repository, dataSource);
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "/api/v1/districts/00001/score", "/api/v1/districts/99999/score",
        "/api/v1/dongs/00001001/score", "/api/v1/dongs/99999999/score"
      })
  void validFormatsReturnOnlyTheFixedUnapprovedProblemIncludingUncheckedRegions(String path)
      throws Exception {
    // 지역 존재 여부는 확인하지 않는다. 기존 오류 응답의 다섯 필드만 허용해 내부 결과 노출도 검사한다.
    mvc.perform(validRequest(path))
        .andExpect(status().isServiceUnavailable())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.length()").value(5))
        .andExpect(jsonPath("$.title").value("Service Unavailable"))
        .andExpect(jsonPath("$.status").value(503))
        .andExpect(jsonPath("$.detail").value("조회할 데이터가 아직 준비되지 않았습니다."))
        .andExpect(jsonPath("$.instance").value(path))
        .andExpect(jsonPath("$.code").value("DATA_NOT_READY"));
  }

  @ParameterizedTest
  @MethodSource("invalidRegions")
  void rejectsInvalidAsciiRegionCodes(String unit, String code) throws Exception {
    mvc.perform(validRequest("/api/v1/" + unit + "/" + code + "/score"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  static Stream<Arguments> invalidRegions() {
    return Stream.concat(
        Stream.of("0001", "000001", "0000A", "００００１", "٠٠٠٠١", "00001 ", " 00001", "-0001")
            .map(code -> Arguments.of("districts", code)),
        Stream.of(
                "0000100",
                "000010001",
                "0000100A",
                "００００１００１",
                "٠٠٠٠١٠٠١",
                "00001001 ",
                " 00001001",
                "-0001001")
            .map(code -> Arguments.of("dongs", code)));
  }

  @ParameterizedTest
  @MethodSource("invalidQueries")
  void rejectsMalformedAndUnsupportedValuesWithoutTrimmingOrSubstitution(String name, String value)
      throws Exception {
    for (String path : PATHS) {
      String other = name.equals("quarterCode") ? "industryCode" : "quarterCode";
      mvc.perform(
              get(path)
                  .param(other, other.equals("industryCode") ? "CS100010" : "20262")
                  .param(name, value))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    }
  }

  static Stream<Arguments> invalidQueries() {
    return Stream.concat(
        Stream.of(
                "",
                " ",
                "20262 ",
                " 20262",
                "20262\n",
                "２０２６２",
                "20260",
                "20265",
                "2026",
                "202612",
                "20262,20262",
                "20261",
                "20251",
                "20263",
                "latest")
            .map(value -> Arguments.of("quarterCode", value)),
        Stream.of(
                "",
                " ",
                "cs100010",
                "CS10001",
                "CS1000100",
                "CS10001０",
                " CS100010",
                "CS100010 ",
                "CS100010,CS100010",
                "CS100001")
            .map(value -> Arguments.of("industryCode", value)));
  }

  @ParameterizedTest
  @ValueSource(strings = {"quarterCode", "industryCode"})
  void rejectsMissingRequiredQuery(String missing) throws Exception {
    for (String path : PATHS) {
      String other = missing.equals("quarterCode") ? "industryCode" : "quarterCode";
      mvc.perform(get(path).param(other, other.equals("industryCode") ? "CS100010" : "20262"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
    }
  }

  @ParameterizedTest
  @ValueSource(strings = {"quarterCode", "industryCode"})
  void rejectsBothIdenticalAndDifferentDuplicateValues(String name) throws Exception {
    String value = name.equals("quarterCode") ? "20262" : "CS100010";
    for (String path : PATHS)
      for (String second : List.of(value, "other")) {
        mvc.perform(validRequest(path).param(name, second))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
      }
  }

  @ParameterizedTest
  @ValueSource(
      strings = {
        "approved",
        "approval",
        "policyApprovalId",
        "inputSnapshotId",
        "algorithmVersion",
        "weight",
        "QuarterCode",
        "quarterCode[]",
        ""
      })
  void rejectsAnyAdditionalQueryIncludingApprovalClaims(String name) throws Exception {
    for (String path : PATHS)
      mvc.perform(validRequest(path).param(name, "synthetic-value"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/districts/00001/score", "/api/v1/dongs/00001001/score"})
  void rejectsDuplicatesFromTheRawQueryString(String path) throws Exception {
    mvc.perform(get(path + "?quarterCode=20262&quarterCode=20262&industryCode=CS100010"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
  }

  @Test
  void rejectsMissingQueriesAndIgnoresClaimedApprovalHeadersAndProperties() throws Exception {
    for (String path : PATHS) {
      mvc.perform(get(path))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
      mvc.perform(
              validRequest(path)
                  .header("X-Score-Approved", "true")
                  .header("X-Source-Trust", "ESTABLISHED"))
          .andExpect(status().isServiceUnavailable())
          .andExpect(jsonPath("$.code").value("DATA_NOT_READY"))
          .andExpect(jsonPath("$.length()").value(5));
    }
  }

  private static MockHttpServletRequestBuilder validRequest(String path) {
    return get(path).param("quarterCode", "20262").param("industryCode", "CS100010");
  }
}
