package kr.ac.recycleyoungs.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 테스트 전용 경로를 통해 실제 MVC 요청의 공통 오류 응답을 검증한다. */
@WebMvcTest(ApiExceptionHandlerTests.TestController.class)
@Import(ApiExceptionHandlerTests.TestController.class)
class ApiExceptionHandlerTests {

  @Autowired private MockMvc mvc;

  @Test
  void returnsInvalidParameterForMissingRequiredParameter() throws Exception {
    mvc.perform(get("/test/parameter"))
        .andExpect(status().isBadRequest())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.status").value(400))
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
        .andExpect(jsonPath("$.instance").value("/test/parameter"));
  }

  @Test
  void returnsInvalidParameterWithoutReflectingRejectedValue() throws Exception {
    mvc.perform(get("/test/parameter").param("count", "sensitive-input"))
        .andExpect(status().isBadRequest())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
        .andExpect(content().string(not(containsString("sensitive-input"))));
  }

  @Test
  void returnsInvalidParameterForMalformedJsonWithoutExposingBody() throws Exception {
    mvc.perform(
            post("/test/body").contentType(MediaType.APPLICATION_JSON).content("sensitive-input"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"))
        .andExpect(content().string(not(containsString("sensitive-input"))));
  }

  @ParameterizedTest
  @CsvSource({"INVALID_PARAMETER,400", "REGION_NOT_FOUND,404", "DATA_NOT_READY,503"})
  void returnsExplicitServiceError(String code, int expectedStatus) throws Exception {
    mvc.perform(get("/test/domain/{code}", code))
        .andExpect(status().is(expectedStatus))
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.status").value(expectedStatus))
        .andExpect(jsonPath("$.code").value(code));
  }

  @ParameterizedTest
  @CsvSource({
    "connection,503,DATABASE_UNAVAILABLE",
    "resource,503,DATABASE_UNAVAILABLE",
    "transient-resource,503,DATABASE_UNAVAILABLE",
    "timeout,503,DATABASE_UNAVAILABLE",
    "transaction-connection,503,DATABASE_UNAVAILABLE",
    "transaction-sql,500,INTERNAL_ERROR",
    "transaction-unknown,500,INTERNAL_ERROR",
    "sql,500,INTERNAL_ERROR",
    "mapping,500,INTERNAL_ERROR",
    "integrity,500,INTERNAL_ERROR",
    "illegal-argument,500,INTERNAL_ERROR",
    "unexpected,500,INTERNAL_ERROR"
  })
  void distinguishesDatabaseAvailabilityFromImplementationErrors(
      String kind, int expectedStatus, String code) throws Exception {
    mvc.perform(get("/test/failure/{kind}", kind))
        .andExpect(status().is(expectedStatus))
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.status").value(expectedStatus))
        .andExpect(jsonPath("$.code").value(code))
        .andExpect(content().string(not(containsString("internal-secret"))))
        .andExpect(content().string(not(containsString("SELECT"))))
        .andExpect(jsonPath("$.exception").doesNotExist())
        .andExpect(jsonPath("$.trace").doesNotExist());
  }

  @Test
  void preservesUnsupportedMethodStatusAndAllowHeader() throws Exception {
    mvc.perform(post("/test/parameter"))
        .andExpect(status().isMethodNotAllowed())
        .andExpect(header().string("Allow", containsString("GET")))
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON));
  }

  @Test
  void doesNotTreatUnknownRoutesAsMissingRegions() throws Exception {
    mvc.perform(get("/unknown-route"))
        .andExpect(status().isNotFound())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
        .andExpect(jsonPath("$.code").doesNotExist());
  }

  /** 실제 서비스 API를 추가하지 않고 MVC 바인딩만 실행하는 테스트용 컨트롤러. */
  @RestController
  static class TestController {
    @GetMapping("/test/parameter")
    int parameter(@RequestParam("count") int count) {
      return count;
    }

    @PostMapping("/test/body")
    java.util.Map<String, String> body(@RequestBody java.util.Map<String, String> body) {
      return body;
    }

    @GetMapping("/test/domain/{code}")
    void domain(@PathVariable("code") ApiErrorCode code) {
      throw new ApiException(code);
    }

    @GetMapping("/test/failure/{kind}")
    void failure(@PathVariable("kind") String kind) {
      // 실제 Spring 예외 타입을 사용하되 접속 정보·SQL을 가정한 문자열은 외부로 노출하지 않는다.
      throw switch (kind) {
        case "connection" -> new CannotGetJdbcConnectionException("internal-secret");
        case "resource" -> new DataAccessResourceFailureException("internal-secret");
        case "transient-resource" -> new TransientDataAccessResourceException("internal-secret");
        case "timeout" -> new QueryTimeoutException("internal-secret");
        case "transaction-connection" ->
            new CannotCreateTransactionException(
                "internal-secret", new SQLException("internal-secret", "08006"));
        case "transaction-sql" ->
            new CannotCreateTransactionException(
                "internal-secret", new SQLException("internal-secret", "42601"));
        case "transaction-unknown" -> new CannotCreateTransactionException("internal-secret");
        case "sql" ->
            new BadSqlGrammarException(
                "query", "SELECT internal-secret", new SQLException("internal-secret", "42601"));
        case "mapping" -> new InvalidDataAccessApiUsageException("internal-secret");
        case "integrity" -> new DataIntegrityViolationException("internal-secret");
        case "illegal-argument" -> new IllegalArgumentException("internal-secret");
        default -> new IllegalStateException("internal-secret");
      };
    }
  }
}
