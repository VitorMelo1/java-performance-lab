package br.edu.benchmark;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
public record OrderInput(UUID requestId, Long productId, Integer quantity) {
    void validate() {
        if(requestId == null || productId == null || productId <= 0 || quantity == null || quantity < 1 || quantity > 100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid_order");
    }
    OrderRecord record(InventoryItem item) {
        if(item == null || item.id() != productId || item.priceCents() < 0 || item.priceCents() > Long.MAX_VALUE / 100 || item.stock() < 0)
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "invalid_inventory_response");
        if(item.stock() < quantity) throw new ResponseStatusException(HttpStatus.CONFLICT, "insufficient_stock");
        return new OrderRecord(requestId,productId,quantity,item.priceCents(),quantity*item.priceCents(),"RECORDED");
    }
}
