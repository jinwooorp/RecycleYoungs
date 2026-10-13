package com.example.backend.nearby;

final class NearbyDataUnavailableException extends RuntimeException {
    private final String code;
    NearbyDataUnavailableException(String code) { this.code = code; }
    String code() { return code; }
}
