package com.example.backend.nearby;

import com.example.backend.admindong.ApiResponses;
import com.example.backend.admindong.DataIntegrityException;
import com.example.backend.admindong.InvalidQueryException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(assignableTypes = NearbyController.class)
public class NearbyExceptionHandler {
    private static final Logger LOG = LoggerFactory.getLogger(NearbyExceptionHandler.class);
    @ExceptionHandler(InvalidQueryException.class)
    ResponseEntity<ApiResponses.Error> invalid(InvalidQueryException ex) {
        return ResponseEntity.badRequest().body(new ApiResponses.Error(ex.code(), ex.getMessage(), ex.field()));
    }
    @ExceptionHandler(NearbyDataUnavailableException.class)
    ResponseEntity<ApiResponses.Error> unavailable(NearbyDataUnavailableException ex) {
        return ResponseEntity.status(503).body(new ApiResponses.Error(ex.code(),
            "경쟁 카페 분석에 필요한 점포 자료 또는 업종 매핑이 준비되지 않았습니다.", null));
    }
    @ExceptionHandler(DataIntegrityException.class)
    ResponseEntity<ApiResponses.Error> integrity() {
        return ResponseEntity.internalServerError().body(new ApiResponses.Error("DATA_INTEGRITY_ERROR", "데이터 무결성 오류입니다.", null));
    }
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponses.Error> unexpected(Exception ex) {
        LOG.error("경쟁 카페 API 내부 오류", ex);
        return ResponseEntity.internalServerError().body(new ApiResponses.Error("INTERNAL_ERROR", "서버 오류가 발생했습니다.", null));
    }
}
