package com.playops.api.exception;

public class ApiException extends RuntimeException {
    private final int status;
    private final String code;

    public ApiException(int status, String message) {
        this(status, defaultCode(status), message);
    }

    public ApiException(int status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code != null ? code : defaultCode(status);
    }

    public int getStatus() {
        return status;
    }

    public String getCode() {
        return code;
    }

    public static String defaultCode(int status) {
        return switch (status) {
            case 400 -> "VALIDATION_ERROR";
            case 401 -> "UNAUTHENTICATED";
            case 403 -> "FORBIDDEN";
            case 404 -> "NOT_FOUND";
            case 409 -> "STATE_CONFLICT";
            case 422 -> "UNSUPPORTED_FRAMEWORK";
            case 429 -> "RATE_LIMITED";
            case 502, 503 -> "UPSTREAM_ERROR";
            case 504 -> "UPSTREAM_TIMEOUT";
            default -> "INTERNAL_ERROR";
        };
    }
}
