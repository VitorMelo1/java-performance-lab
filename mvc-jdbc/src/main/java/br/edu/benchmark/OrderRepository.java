package br.edu.benchmark;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.*;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
@Repository
class OrderRepository {
    private final JdbcClient jdbc;
    OrderRepository(JdbcClient jdbc){this.jdbc=jdbc;}
    // Mapeamento explicito, igual ao do braco reativo (ver ProductRepository).
    private static OrderRecord map(ResultSet row) throws SQLException {
        return new OrderRecord(row.getObject("request_id",UUID.class),row.getLong("product_id"),
            row.getInt("quantity"),row.getLong("unit_price_cents"),row.getLong("total_cents"),
            row.getString("status"));
    }
    Optional<OrderRecord> find(UUID id){return jdbc.sql("SELECT request_id,product_id,quantity,unit_price_cents,total_cents,status FROM orders WHERE request_id=:id").param("id",id).query((row,number)->map(row)).optional();}
    Optional<OrderRecord> insert(OrderRecord order){return jdbc.sql("INSERT INTO orders(request_id,product_id,quantity,unit_price_cents,total_cents,status) VALUES(:id,:product,:quantity,:price,:total,'RECORDED') ON CONFLICT(request_id) DO NOTHING RETURNING request_id,product_id,quantity,unit_price_cents,total_cents,status")
        .param("id",order.requestId()).param("product",order.productId()).param("quantity",order.quantity()).param("price",order.unitPriceCents()).param("total",order.totalCents()).query((row,number)->map(row)).optional();}
}
