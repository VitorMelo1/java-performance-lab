package br.edu.benchmark;
import java.util.UUID;
public record OrderRecord(UUID requestId, long productId, int quantity, long unitPriceCents, long totalCents, String status) {}
