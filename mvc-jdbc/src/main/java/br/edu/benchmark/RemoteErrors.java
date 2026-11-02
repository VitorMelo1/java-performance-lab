package br.edu.benchmark;
import feign.FeignException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClientException;
import java.util.Map;

@RestControllerAdvice
class RemoteErrors {
    private static final Logger log = LoggerFactory.getLogger(RemoteErrors.class);

    @ExceptionHandler({RestClientException.class, FeignException.class})
    ResponseEntity<Map<String,String>> upstream(Exception exception) {
        // Registra a causa real antes de devolver o 502. Sem este log a resposta inválida
        // nao distinguia timeout de aquisicao, conexao recusada ou reset de keep-alive,
        // distincoes necessarias para diagnosticar as falhas concentradas por cliente.
        log.warn("upstream_failure: {}", exception.toString(), exception);
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", "upstream_failure"));
    }
}

