package com.playops.api.exception;

import jakarta.persistence.OptimisticLockException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, Object>> handleApiException(ApiException ex, HttpServletRequest request) {
        return buildErrorResponse(ex.getStatus(), ex.getCode(), ex.getMessage(), request);
    }

    @ExceptionHandler({OptimisticLockException.class, OptimisticLockingFailureException.class})
    public ResponseEntity<Map<String, Object>> handleOptimisticLock(Exception ex, HttpServletRequest request) {
        return buildErrorResponse(409, "VERSION_CONFLICT", "다른 요청에 의해 데이터가 먼저 변경되었습니다. 새로고침 후 다시 시도하세요.", request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex, HttpServletRequest request) {
        String message = ex.getMessage() != null ? ex.getMessage() : "Internal server error";
        return buildErrorResponse(500, "INTERNAL_ERROR", message, request);
    }

    private ResponseEntity<Map<String, Object>> buildErrorResponse(
            int status,
            String code,
            String message,
            HttpServletRequest request
    ) {
        String requestId = request != null && request.getHeader("X-Request-Id") != null
                ? request.getHeader("X-Request-Id")
                : "req-" + UUID.randomUUID();
        Map<String, Object> errorObj = new LinkedHashMap<>();
        errorObj.put("code", code);
        errorObj.put("message", message);
        errorObj.put("details", List.of());

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("message", message);
        body.put("error", errorObj);
        body.put("requestId", requestId);
        return ResponseEntity.status(status).body(body);
    }
}
