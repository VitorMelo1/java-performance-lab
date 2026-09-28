package br.edu.benchmark;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.bind.annotation.*;

@Configuration
@ConditionalOnProperty(name="lab.http-client", havingValue="feign")
@EnableFeignClients(clients=FeignCatalogConfiguration.CatalogClient.class)
class FeignCatalogConfiguration {
    @FeignClient(name="catalog", url="${lab.remote-url}")
    interface CatalogClient extends RemoteCatalog {
        @Override
        @GetMapping("/catalog/{id}")
        RemoteProduct get(@PathVariable("id") long id, @RequestParam("delayMs") int delayMs);
    }
}

