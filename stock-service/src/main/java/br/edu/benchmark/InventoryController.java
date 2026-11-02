package br.edu.benchmark;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.sql.ResultSet;
import java.sql.SQLException;

@RestController
class InventoryController {
    private final JdbcClient jdbc;
    InventoryController(JdbcClient jdbc) { this.jdbc=jdbc; }
    public record Item(long id, String name, long priceCents, int stock) {}
    // Mapeamento explicito, igual ao dos dois bracos comparados.
    private static Item map(ResultSet row) throws SQLException {
        return new Item(row.getLong("id"), row.getString("name"),
            row.getLong("price_cents"), row.getInt("stock"));
    }
    @GetMapping("/inventory/{id}")
    Item get(@PathVariable long id) {
        if (id <= 0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        return jdbc.sql("SELECT id, name, price_cents, stock FROM inventory WHERE id=:id")
            .param("id",id).query((row, number) -> map(row)).optional()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }
}
