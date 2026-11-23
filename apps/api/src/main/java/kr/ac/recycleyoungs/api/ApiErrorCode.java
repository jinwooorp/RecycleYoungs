package kr.ac.recycleyoungs.api;

import org.springframework.http.HttpStatus;

/** 서비스 오류의 HTTP 상태와 외부에 공개해도 되는 고정 안내 문구를 정의한다. */
public enum ApiErrorCode {
  INVALID_PARAMETER(HttpStatus.BAD_REQUEST, "요청 파라미터를 확인해 주세요."),
  REGION_NOT_FOUND(HttpStatus.NOT_FOUND, "행정구역을 찾을 수 없습니다."),
  DATA_NOT_READY(HttpStatus.SERVICE_UNAVAILABLE, "조회할 데이터가 아직 준비되지 않았습니다."),
  DATABASE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "데이터베이스에 일시적으로 접근할 수 없습니다."),
  INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "요청 처리 중 오류가 발생했습니다.");

  private final HttpStatus status;
  private final String detail;

  ApiErrorCode(HttpStatus status, String detail) {
    this.status = status;
    this.detail = detail;
  }

  public HttpStatus status() {
    return status;
  }

  public String detail() {
    return detail;
  }
}
