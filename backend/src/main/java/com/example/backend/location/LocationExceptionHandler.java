package com.example.backend.location;

import com.example.backend.admindong.ApiResponses;
import com.example.backend.admindong.DataIntegrityException;
import com.example.backend.admindong.InvalidQueryException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = LocationController.class)
public class LocationExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(LocationExceptionHandler.class);

    @ExceptionHandler(InvalidQueryException.class)
    ResponseEntity<ApiResponses.Error> invalid(InvalidQueryException ex) {
        return ResponseEntity.badRequest().body(new ApiResponses.Error(ex.code(), ex.getMessage(), ex.field()));
    }

    @ExceptionHandler(BoundaryDataUnavailableException.class)
    ResponseEntity<ApiResponses.Error> unavailable() {
        return ResponseEntity.status(503).body(new ApiResponses.Error("BOUNDARY_DATA_UNAVAILABLE",
            "행정동·상권 경계 데이터가 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.", null));
    }

    @ExceptionHandler(DataIntegrityException.class)
    ResponseEntity<ApiResponses.Error> integrity() {
        return ResponseEntity.internalServerError().body(
            new ApiResponses.Error("DATA_INTEGRITY_ERROR", "데이터 무결성 오류입니다.", null));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponses.Error> unexpected(Exception ex) {
        LOG.error("위치 판정 API 내부 오류", ex);
        return ResponseEntity.internalServerError().body(
            new ApiResponses.Error("INTERNAL_ERROR", "서버 오류가 발생했습니다.", null));
    }
}
