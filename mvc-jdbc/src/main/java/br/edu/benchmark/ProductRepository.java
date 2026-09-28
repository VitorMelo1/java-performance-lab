package br.edu.benchmark;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
class ProductRepository {
    private final JdbcClient jdbc;
    ProductRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    Optional<Product> find(long id) {
        return jdbc.sql("SELECT id, name, price_cents, stock FROM products WHERE id = :id")
            .param("id", id).query(Product.class).optional();
    }
    Optional<Product> updateStock(long id, int stock) {
        return jdbc.sql("UPDATE products SET stock = :stock WHERE id = :id RETURNING id, name, price_cents, stock")
            .param("id", id).param("stock", stock).query(Product.class).optional();
    }
}

