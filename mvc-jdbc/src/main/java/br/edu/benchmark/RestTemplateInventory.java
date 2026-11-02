package br.edu.benchmark;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
@Component
@ConditionalOnProperty(name="lab.http-client", havingValue="resttemplate", matchIfMissing=true)
class RestTemplateInventory implements InventoryClient {
    private final RestTemplate client; private final String base;
    RestTemplateInventory(CloseableHttpClient http, @Value("${lab.inventory-url}") String base) {
        this.client=new RestTemplate(new HttpComponentsClientHttpRequestFactory(http));this.base=base;
    }
    public InventoryItem get(long id) { return client.getForObject(base+"/inventory/{id}",InventoryItem.class,id); }
}
