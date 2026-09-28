package br.edu.benchmark;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
class ApiController {
    private final ProductRepository products;
    private final RemoteCatalog remote;
    ApiController(ProductRepository products, RemoteCatalog remote) { this.products=products; this.remote=remote; }

    @GetMapping("/products/{id}")
    Product product(@PathVariable long id) {
        ApiInput.id(id);
        return products.find(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
    @PutMapping("/products/{id}/stock")
    Product stock(@PathVariable long id, @RequestBody StockUpdate body) {
        ApiInput.id(id); ApiInput.stock(body.stock());
        return products.updateStock(id, body.stock()).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
    @GetMapping("/remote/{id}")
    RemoteProduct remote(@PathVariable long id, @RequestParam(defaultValue="0") int delayMs) {
        ApiInput.id(id); ApiInput.delay(delayMs);
        return remote.get(id, delayMs);
    }
}

