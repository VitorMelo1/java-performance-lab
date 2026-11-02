CREATE TABLE IF NOT EXISTS orders (
 request_id uuid PRIMARY KEY,
 product_id bigint NOT NULL CHECK(product_id > 0),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100),
 unit_price_cents bigint NOT NULL CHECK(unit_price_cents >= 0),
 total_cents bigint NOT NULL CHECK(total_cents = quantity * unit_price_cents),
 status text NOT NULL CHECK(status = 'RECORDED')
);
