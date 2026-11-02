package br.edu.benchmark;
import java.util.UUID;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;
@Repository
class OrderRepository {
    private final DatabaseClient db;
    OrderRepository(DatabaseClient db){this.db=db;}
    private OrderRecord map(io.r2dbc.spi.Row r){return new OrderRecord(r.get("request_id",UUID.class),r.get("product_id",Long.class),r.get("quantity",Integer.class),r.get("unit_price_cents",Long.class),r.get("total_cents",Long.class),r.get("status",String.class));}
    Mono<OrderRecord> find(UUID id){return db.sql("SELECT request_id,product_id,quantity,unit_price_cents,total_cents,status FROM orders WHERE request_id=:id").bind("id",id).map((r,m)->map(r)).one();}
    Mono<OrderRecord> insert(OrderRecord order){return db.sql("INSERT INTO orders(request_id,product_id,quantity,unit_price_cents,total_cents,status) VALUES(:id,:product,:quantity,:price,:total,'RECORDED') ON CONFLICT(request_id) DO NOTHING RETURNING request_id,product_id,quantity,unit_price_cents,total_cents,status")
        .bind("id",order.requestId()).bind("product",order.productId()).bind("quantity",order.quantity()).bind("price",order.unitPriceCents()).bind("total",order.totalCents()).map((r,m)->map(r)).one();}
}
