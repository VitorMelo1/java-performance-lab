package br.edu.benchmark;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
@RestController @RequestMapping("/api/orders")
class OrderController {
    private final OrderRepository orders; private final WebClient inventory;
    OrderController(OrderRepository orders,@Qualifier("inventoryClient") WebClient inventory){this.orders=orders;this.inventory=inventory;}
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    Mono<OrderRecord> create(@RequestBody OrderInput input){
        input.validate();
        return inventory.get().uri("/inventory/{id}",input.productId()).retrieve().bodyToMono(InventoryItem.class)
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.BAD_GATEWAY,"empty_inventory_response")))
            .onErrorMap(e->new ResponseStatusException(HttpStatus.BAD_GATEWAY,"upstream_failure",e))
            .map(input::record).flatMap(orders::insert)
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.CONFLICT,"duplicate_request")));
    }
    @GetMapping("/{id}") Mono<OrderRecord> get(@PathVariable UUID id){
        return orders.find(id).switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND)));
    }
}
