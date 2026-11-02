package br.edu.benchmark;
import feign.Client;
import feign.hc5.ApacheHttp5Client;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cloud.openfeign.FeignAutoConfiguration;
import static org.assertj.core.api.Assertions.assertThat;

// Confirma em tempo de execucao a fiacao do braco Feign: com o CloseableHttpClient do
// RestTemplate ja no contexto, a autoconfiguracao HC5 do OpenFeign recua
// (@ConditionalOnMissingBean) e, sem o bean explicito, o Feign cairia no Client.Default
// (HttpURLConnection). O teste sobe o contexto real no modo feign e verifica que o unico
// feign.Client resolvido e o ApacheHttp5Client sobre o pool compartilhado.
class FeignClientWiringTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(FeignAutoConfiguration.class))
        .withUserConfiguration(HttpClientConfiguration.class, FeignCatalogConfiguration.class)
        .withPropertyValues(
            "lab.http-client=feign",
            "lab.http-pool-size=100",
            "lab.inventory-url=http://localhost:9",
            "lab.remote-url=http://localhost:9",
            "spring.cloud.openfeign.httpclient.hc5.enabled=true");

    @Test void feignUsesSharedApacheHttp5ClientNotTheDefault() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).hasSingleBean(Client.class);
            assertThat(context.getBean(Client.class)).isInstanceOf(ApacheHttp5Client.class);
        });
    }

    // Controle do mecanismo: com o CloseableHttpClient presente, mas sem o bean feign.Client
    // explicito, a autoconfiguracao HC5 do OpenFeign recua e nenhum feign.Client e registrado.
    // Nesse estado o Feign usa o Client.Default (HttpURLConnection) — a fiacao dos lotes publicados.
    @Test void withoutTheExplicitBeanTheHc5AutoconfigBacksOff() {
        new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(FeignAutoConfiguration.class))
            .withUserConfiguration(HttpClientConfiguration.class)
            .withPropertyValues(
                "lab.http-pool-size=100",
                "spring.cloud.openfeign.httpclient.hc5.enabled=true")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).doesNotHaveBean(Client.class);
            });
    }
}
