package br.edu.benchmark;
import feign.Client;
import feign.hc5.ApacheHttp5Client;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.*;

@Configuration
@ConditionalOnProperty(name="lab.http-client", havingValue="feign")
@EnableFeignClients(clients={FeignCatalogConfiguration.CatalogClient.class, FeignCatalogConfiguration.StockClient.class})
class FeignCatalogConfiguration {
    // Fixa o cliente Feign no mesmo Apache HttpClient 5 (pool lab.http-pool-size) usado pelo
    // RestTemplate. Sem este bean a autoconfiguracao HC5 do OpenFeign recua, porque ja existe
    // um CloseableHttpClient no contexto (@ConditionalOnMissingBean), e o Feign cai no
    // Client.Default (HttpURLConnection) — outro transporte e sem o pool. Declarar o Client
    // explicitamente garante o mesmo transporte nos dois modos, sem depender da ordem da autoconfig.
    @Bean
    Client feignHttpClient(CloseableHttpClient httpClient) {
        return new ApacheHttp5Client(httpClient);
    }

    @FeignClient(name="inventory", url="${lab.inventory-url}")
    interface StockClient extends InventoryClient {
        @Override @GetMapping("/inventory/{id}") InventoryItem get(@PathVariable("id") long id);
    }
    @FeignClient(name="catalog", url="${lab.remote-url}")
    interface CatalogClient extends RemoteCatalog {
        @Override
        @GetMapping("/catalog/{id}")
        RemoteProduct get(@PathVariable("id") long id, @RequestParam("delayMs") int delayMs);
    }
}

