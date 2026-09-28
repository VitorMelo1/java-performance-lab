package br.edu.benchmark;
import feign.Retryer;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.util.Timeout;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class HttpClientConfiguration {
    @Bean
    CloseableHttpClient httpClient(@Value("${lab.http-pool-size}") int size) {
        var manager = PoolingHttpClientConnectionManagerBuilder.create()
            .setMaxConnTotal(size).setMaxConnPerRoute(size)
            .setDefaultConnectionConfig(ConnectionConfig.custom()
                .setConnectTimeout(Timeout.ofSeconds(1)).setSocketTimeout(Timeout.ofSeconds(2)).build())
            .build();
        return HttpClients.custom().setConnectionManager(manager)
            .disableAutomaticRetries().disableRedirectHandling()
            .setDefaultRequestConfig(RequestConfig.custom()
                .setConnectionRequestTimeout(Timeout.ofSeconds(2))
                .setResponseTimeout(Timeout.ofSeconds(2)).build())
            .build();
    }
    @Bean Retryer noRetries() { return Retryer.NEVER_RETRY; }
}

