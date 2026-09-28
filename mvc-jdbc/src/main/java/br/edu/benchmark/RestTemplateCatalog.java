package br.edu.benchmark;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.client.HttpComponentsClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

@Component
@ConditionalOnProperty(name="lab.http-client", havingValue="resttemplate", matchIfMissing=true)
class RestTemplateCatalog implements RemoteCatalog {
    private final RestTemplate client;
    private final String base;
    RestTemplateCatalog(CloseableHttpClient httpClient, @Value("${lab.remote-url}") String base) {
        this.client = new RestTemplate(new HttpComponentsClientHttpRequestFactory(httpClient));
        this.base = base;
    }
    public RemoteProduct get(long id, int delayMs) {
        return client.getForObject(base + "/catalog/{id}?delayMs={delay}", RemoteProduct.class, id, delayMs);
    }
}

