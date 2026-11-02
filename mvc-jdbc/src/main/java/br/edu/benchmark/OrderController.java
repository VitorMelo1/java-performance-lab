package br.edu.benchmark;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
@RestController @RequestMapping("/api/orders")
class OrderController {
    private final OrderRepository orders; private final InventoryClient inventory;
    OrderController(OrderRepository orders,InventoryClient inventory){this.orders=orders;this.inventory=inventory;}
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    OrderRecord create(@RequestBody OrderInput input){
        input.validate();
        var record=input.record(inventory.get(input.productId()));
        return orders.insert(record).orElseThrow(()->new ResponseStatusException(HttpStatus.CONFLICT,"duplicate_request"));
    }
    @GetMapping("/{id}") OrderRecord get(@PathVariable UUID id){
        return orders.find(id).orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
