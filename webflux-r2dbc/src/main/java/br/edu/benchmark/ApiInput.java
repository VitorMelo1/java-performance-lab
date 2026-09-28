package br.edu.benchmark;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

final class ApiInput {
    private ApiInput() {}
    static void id(long value) {
        if (value <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "id must be positive");
    }
    static void stock(Integer value) {
        if (value == null || value < 0 || value > 1_000_000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid stock");
    }
    static void delay(int value) {
        if (value < 0 || value > 1000) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid delay");
    }
}

