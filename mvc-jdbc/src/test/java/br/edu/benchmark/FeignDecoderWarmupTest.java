package br.edu.benchmark;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.http.converter.autoconfigure.HttpMessageConvertersAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cloud.openfeign.FeignAutoConfiguration;
import org.springframework.cloud.openfeign.FeignClientFactory;
import org.springframework.cloud.openfeign.support.FeignHttpMessageConverters;
import java.lang.reflect.Field;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

// Verifica que os conversores de cada contexto filho do Feign ja estao preenchidos quando o
// contexto termina de subir. A lista mora num campo nao volatil que FeignHttpMessageConverters
// so preenche na primeira chamada a getConverters(); se essa primeira chamada sobrar para as
// threads de requisicao, parte delas le a lista vazia sob concorrencia e a decodificacao falha
// com 'messageConverters' must not be empty. O teste le o campo por reflexao de proposito:
// chamar getConverters() aqui preencheria a lista e esconderia a condicao que se quer verificar.
class FeignDecoderWarmupTest {
    private static final List<String> CLIENTS = List.of("catalog", "inventory");

    private ApplicationContextRunner runner(Class<?>... userConfigurations) {
        return new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                HttpMessageConvertersAutoConfiguration.class, FeignAutoConfiguration.class))
            .withUserConfiguration(userConfigurations)
            .withPropertyValues(
                "lab.http-client=feign",
                "lab.http-pool-size=100",
                "lab.inventory-url=http://localhost:9",
                "lab.remote-url=http://localhost:9",
                "spring.cloud.openfeign.httpclient.hc5.enabled=true");
    }

    @Test void convertersArePopulatedBeforeTheServerAcceptsRequests() {
        runner(HttpClientConfiguration.class, FeignCatalogConfiguration.class, FeignDecoderWarmup.class)
            .run(context -> {
                assertThat(context).hasNotFailed();
                FeignClientFactory factory = context.getBean(FeignClientFactory.class);
                for (String client : CLIENTS) {
                    FeignHttpMessageConverters converters = factory.getInstance(client, FeignHttpMessageConverters.class);
                    assertThat(converters).as("FeignHttpMessageConverters de %s", client).isNotNull();
                    assertThat(lazyField(converters))
                        .as("conversores de %s preenchidos durante a inicializacao", client)
                        .isNotNull().isNotEmpty();
                }
            });
    }

    // Controle do mecanismo: sem o aquecimento, o campo continua nulo depois que o contexto sobe,
    // ou seja a primeira chamada a getConverters() so aconteceria ja sob carga, em concorrencia.
    @Test void withoutTheWarmupTheConvertersStayUninitialized() {
        runner(HttpClientConfiguration.class, FeignCatalogConfiguration.class)
            .run(context -> {
                assertThat(context).hasNotFailed();
                FeignClientFactory factory = context.getBean(FeignClientFactory.class);
                FeignHttpMessageConverters converters = factory.getInstance("catalog", FeignHttpMessageConverters.class);
                assertThat(converters).isNotNull();
                assertThat(lazyField(converters)).isNull();
            });
    }

    private static List<?> lazyField(FeignHttpMessageConverters converters) throws Exception {
        Field field = FeignHttpMessageConverters.class.getDeclaredField("converters");
        field.setAccessible(true);
        return (List<?>) field.get(converters);
    }
}
