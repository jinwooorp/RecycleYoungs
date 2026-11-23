package kr.ac.recycleyoungs.api;

/** 후속 조회 서비스에서 명시적으로 판정한 오류 코드를 공통 응답 처리기에 전달한다. */
public class ApiException extends RuntimeException {

  private final ApiErrorCode errorCode;

  public ApiException(ApiErrorCode errorCode) {
    super(errorCode.detail());
    this.errorCode = errorCode;
  }

  public ApiErrorCode errorCode() {
    return errorCode;
  }
}
