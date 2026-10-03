package com.example.backend.admindong;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = AdminDongController.class)
public class ApiExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(InvalidQueryException.class)
    ResponseEntity<ApiResponses.Error> invalid(InvalidQueryException ex) {
        return ResponseEntity.badRequest().body(new ApiResponses.Error(ex.code(), ex.getMessage(), ex.field()));
    }

    @ExceptionHandler(DataIntegrityException.class)
    ResponseEntity<ApiResponses.Error> integrity(DataIntegrityException ex) {
        return ResponseEntity.internalServerError().body(
            new ApiResponses.Error("DATA_INTEGRITY_ERROR", "데이터 무결성 오류입니다.", null));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponses.Error> unexpected(Exception ex) {
        LOG.error("행정동 API 내부 오류", ex);
        return ResponseEntity.internalServerError().body(
            new ApiResponses.Error("INTERNAL_ERROR", "서버 오류가 발생했습니다.", null));
    }
}
