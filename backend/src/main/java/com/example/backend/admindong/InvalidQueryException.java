package com.example.backend.admindong;

public class InvalidQueryException extends RuntimeException {
    private final String code;
    private final String field;

    public InvalidQueryException(String code, String message, String field) {
        super(message);
        this.code = code;
        this.field = field;
    }

    public String code() { return code; }
    public String field() { return field; }
}
