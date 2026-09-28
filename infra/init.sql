CREATE TABLE products (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL,
    price_cents bigint NOT NULL CHECK (price_cents >= 0),
    stock integer NOT NULL CHECK (stock BETWEEN 0 AND 1000000)
);
INSERT INTO products(name, price_cents, stock)
SELECT 'Produto ' || i, 1000 + i, 100 FROM generate_series(1, 10000) AS i;
ALTER ROLE lab SET statement_timeout = '2s';
ANALYZE products;

