package br.edu.benchmark;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;

class ApiInputTest {
    @Test void rejectsNonPositiveIdsAndAcceptsLargePositiveIds() {
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> ApiInput.id(0)).getStatusCode().value());
        assertThrows(ResponseStatusException.class, () -> ApiInput.id(-1));
        assertDoesNotThrow(() -> ApiInput.id(Long.MAX_VALUE));
    }
    @Test void rejectsMissingNegativeAndExcessiveStock() {
        assertThrows(ResponseStatusException.class, () -> ApiInput.stock(null));
        assertThrows(ResponseStatusException.class, () -> ApiInput.stock(-1));
        assertThrows(ResponseStatusException.class, () -> ApiInput.stock(1_000_001));
        assertDoesNotThrow(() -> ApiInput.stock(0));
        assertDoesNotThrow(() -> ApiInput.stock(1_000_000));
    }
    @Test void boundsControlledRemoteDelay() {
        assertThrows(ResponseStatusException.class, () -> ApiInput.delay(-1));
        assertThrows(ResponseStatusException.class, () -> ApiInput.delay(1001));
        assertDoesNotThrow(() -> ApiInput.delay(0));
        assertDoesNotThrow(() -> ApiInput.delay(1000));
    }
}

