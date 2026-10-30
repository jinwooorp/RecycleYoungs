package kr.ac.recycleyoungs.api;

import java.sql.SQLException;
import org.jspecify.annotations.Nullable;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.support.SQLExceptionSubclassTranslator;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/** MVC·서비스 오류를 ProblemDetail로 변환하며 예외 원문·SQL·접속 정보를 공개하지 않는다. */
@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

  @ExceptionHandler(ApiException.class)
  public ResponseEntity<ProblemDetail> handleApiException(ApiException exception) {
    return response(exception.errorCode());
  }

  @ExceptionHandler({
    DataAccessResourceFailureException.class,
    TransientDataAccessResourceException.class,
    QueryTimeoutException.class
  })
  public ResponseEntity<ProblemDetail> handleDatabaseUnavailable() {
    // 연결·자원 접근 실패와 시간 초과만 재시도 가능한 DB 장애로 분류한다.
    return response(ApiErrorCode.DATABASE_UNAVAILABLE);
  }

  @ExceptionHandler(CannotCreateTransactionException.class)
  public ResponseEntity<ProblemDetail> handleTransactionFailure(
      CannotCreateTransactionException exception) {
    // 트랜잭션 시작 시에는 원본 SQLException이 감싸지므로 JDBC와 같은 변환 규칙으로 판정한다.
    if (exception.getCause() instanceof SQLException sqlException) {
      var translated =
          new SQLExceptionSubclassTranslator().translate("begin transaction", null, sqlException);
      if (translated instanceof DataAccessResourceFailureException
          || translated instanceof TransientDataAccessResourceException
          || translated instanceof QueryTimeoutException) {
        return response(ApiErrorCode.DATABASE_UNAVAILABLE);
      }
    }
    return response(ApiErrorCode.INTERNAL_ERROR);
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ProblemDetail> handleUnexpectedException() {
    // SQL 문법·매핑·무결성 오류와 일반 IllegalArgumentException은 구현 오류로 남긴다.
    return response(ApiErrorCode.INTERNAL_ERROR);
  }

  @Override
  protected @Nullable ResponseEntity<Object> handleExceptionInternal(
      Exception exception,
      @Nullable Object body,
      HttpHeaders headers,
      HttpStatusCode statusCode,
      WebRequest request) {
    ProblemDetail problem;
    if (statusCode.value() == HttpStatus.BAD_REQUEST.value()) {
      problem = problem(ApiErrorCode.INVALID_PARAMETER);
    } else if (statusCode.value() == HttpStatus.INTERNAL_SERVER_ERROR.value()) {
      problem = problem(ApiErrorCode.INTERNAL_ERROR);
    } else {
      // 미등록 경로의 404는 지역 미존재와 구분하고, 405의 Allow 등 MVC 상태·헤더를 유지한다.
      problem = ProblemDetail.forStatus(statusCode);
    }
    // 바인딩 오류에 포함된 입력값과 본문도 고정 응답으로 대체한다.
    return super.handleExceptionInternal(exception, problem, headers, statusCode, request);
  }

  private ResponseEntity<ProblemDetail> response(ApiErrorCode code) {
    return ResponseEntity.status(code.status()).body(problem(code));
  }

  private ProblemDetail problem(ApiErrorCode code) {
    var problem = ProblemDetail.forStatusAndDetail(code.status(), code.detail());
    problem.setProperty("code", code.name());
    return problem;
  }
}
