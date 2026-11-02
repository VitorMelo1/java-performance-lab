package br.edu.benchmark;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;

@Repository
class ProductRepository {
    private final JdbcClient jdbc;
    ProductRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    // Mapeamento escrito a mao para simetria com o braco reativo. query(Product.class)
    // usa SimplePropertyRowMapper, que resolve nomes por reflexao a cada linha; em
    // consulta por chave primaria de sub-milissegundo esse custo entra na medicao e
    // nao existe do outro lado, onde o mapeamento sempre foi explicito.
    private static Product map(ResultSet row) throws SQLException {
        return new Product(row.getLong("id"), row.getString("name"),
            row.getLong("price_cents"), row.getInt("stock"));
    }

    Optional<Product> find(long id) {
        return jdbc.sql("SELECT id, name, price_cents, stock FROM products WHERE id = :id")
            .param("id", id).query((row, number) -> map(row)).optional();
    }
    Optional<Product> updateStock(long id, int stock) {
        return jdbc.sql("UPDATE products SET stock = :stock WHERE id = :id RETURNING id, name, price_cents, stock")
            .param("id", id).param("stock", stock).query((row, number) -> map(row)).optional();
    }
}
