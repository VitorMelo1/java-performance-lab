package br.edu.benchmark;
import feign.FeignException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import java.util.Map;

@RestControllerAdvice
class RemoteErrors {
    @ExceptionHandler({RestClientException.class, FeignException.class})
    ResponseEntity<Map<String,String>> upstream(Exception exception) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", "upstream_failure"));
    }
}

