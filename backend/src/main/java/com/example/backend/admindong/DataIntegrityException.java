package com.example.backend.admindong;

public class DataIntegrityException extends RuntimeException {
    public DataIntegrityException() {
        super("행정동 통계 데이터의 연결 또는 식별자가 일치하지 않습니다.");
    }
}
