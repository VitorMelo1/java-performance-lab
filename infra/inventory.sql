CREATE TABLE IF NOT EXISTS inventory (
 id bigint PRIMARY KEY, name text NOT NULL, price_cents bigint NOT NULL CHECK(price_cents >= 0),
 stock integer NOT NULL CHECK(stock >= 0)
);
TRUNCATE inventory;
INSERT INTO inventory SELECT i, 'Produto ' || i, 1000+i, CASE WHEN i=10000 THEN 0 ELSE 100 END
FROM generate_series(1,10000) AS i;
ALTER ROLE inventory SET statement_timeout='2s';
ANALYZE inventory;
