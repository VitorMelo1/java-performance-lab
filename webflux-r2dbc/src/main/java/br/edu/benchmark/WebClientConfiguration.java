package br.edu.benchmark;
import io.netty.channel.ChannelOption;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.*;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.resources.ConnectionProvider;
import java.time.Duration;

@Configuration
class WebClientConfiguration {
    @Bean(destroyMethod="dispose")
    ConnectionProvider remoteConnections(@Value("${lab.http-pool-size}") int size) {
        return ConnectionProvider.builder("remote").maxConnections(size)
            .pendingAcquireMaxCount(1000).pendingAcquireTimeout(Duration.ofSeconds(2)).build();
    }
    @Bean
    WebClient inventoryClient(ConnectionProvider remoteConnections, @Value("${lab.inventory-url}") String base) {
        return client(remoteConnections, base);
    }
    @Bean
    WebClient remoteClient(ConnectionProvider remoteConnections, @Value("${lab.remote-url}") String base) {
        return client(remoteConnections, base);
    }
    private WebClient client(ConnectionProvider remoteConnections, String base) {
        var http = HttpClient.create(remoteConnections).disableRetry(true).followRedirect(false)
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 1000).responseTimeout(Duration.ofSeconds(2));
        return WebClient.builder().baseUrl(base).clientConnector(new ReactorClientHttpConnector(http)).build();
    }
}

