package br.edu.benchmark;
import org.springframework.r2dbc.core.DatabaseClient;
import org.springframework.stereotype.Repository;
import reactor.core.publisher.Mono;

@Repository
class ProductRepository {
    private final DatabaseClient database;
    ProductRepository(DatabaseClient database) { this.database = database; }

    Mono<Product> find(long id) {
        return database.sql("SELECT id, name, price_cents, stock FROM products WHERE id = :id")
            .bind("id", id).map((row, metadata) -> new Product(row.get("id", Long.class),
                row.get("name", String.class), row.get("price_cents", Long.class), row.get("stock", Integer.class))).one();
    }
    Mono<Product> updateStock(long id, int stock) {
        return database.sql("UPDATE products SET stock = :stock WHERE id = :id RETURNING id, name, price_cents, stock")
            .bind("id", id).bind("stock", stock).map((row, metadata) -> new Product(row.get("id", Long.class),
                row.get("name", String.class), row.get("price_cents", Long.class), row.get("stock", Integer.class))).one();
    }
}

