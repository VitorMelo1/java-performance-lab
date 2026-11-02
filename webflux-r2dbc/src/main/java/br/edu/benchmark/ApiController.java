package br.edu.benchmark;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/api")
class ApiController {
    private final ProductRepository products;
    private final WebClient remote;
    ApiController(ProductRepository products, @org.springframework.beans.factory.annotation.Qualifier("remoteClient") WebClient remoteClient) { this.products=products; this.remote=remoteClient; }

    @GetMapping("/products/{id}")
    Mono<Product> product(@PathVariable long id) {
        ApiInput.id(id);
        return products.find(id).switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND)));
    }
    @PutMapping("/products/{id}/stock")
    Mono<Product> stock(@PathVariable long id, @RequestBody StockUpdate body) {
        ApiInput.id(id); ApiInput.stock(body.stock());
        return products.updateStock(id, body.stock()).switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND)));
    }
    @GetMapping("/remote/{id}")
    Mono<RemoteProduct> remote(@PathVariable long id, @RequestParam(defaultValue="0") int delayMs) {
        ApiInput.id(id); ApiInput.delay(delayMs);
        return remote.get().uri(builder -> builder.path("/catalog/{id}").queryParam("delayMs", delayMs).build(id))
            .retrieve().bodyToMono(RemoteProduct.class)
            .onErrorMap(error -> new ResponseStatusException(HttpStatus.BAD_GATEWAY, "upstream_failure", error));
    }
}

