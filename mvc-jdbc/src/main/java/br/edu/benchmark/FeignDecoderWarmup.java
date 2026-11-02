package br.edu.benchmark;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.cloud.openfeign.FeignClientFactory;
import org.springframework.cloud.openfeign.support.FeignHttpMessageConverters;
import org.springframework.stereotype.Component;
import java.util.List;

// Inicializa os conversores de mensagem de cada contexto filho do OpenFeign antes de o servidor
// aceitar conexoes. FeignHttpMessageConverters guarda a lista de conversores num campo nao final
// e nao volatil, preenchido preguicosamente na primeira chamada a getConverters(); o SpringDecoder
// chama esse metodo a cada resposta decodificada. Sob carga concorrente a primeira chamada acontece
// em varias threads ao mesmo tempo, sem barreira de publicacao, e parte delas le a lista ainda
// vazia — o que a biblioteca converte em DecodeException: 'messageConverters' must not be empty.
// Executar a inicializacao uma vez em afterSingletonsInstantiated fecha a janela: o campo ja esta
// escrito quando finishRefresh cria as threads do servidor, e a criacao das threads estabelece a
// relacao de precedencia que torna a escrita visivel a todas elas.
@Component
@ConditionalOnProperty(name="lab.http-client", havingValue="feign")
class FeignDecoderWarmup implements SmartInitializingSingleton {
    private final FeignClientFactory factory;

    FeignDecoderWarmup(FeignClientFactory factory) { this.factory = factory; }

    @Override
    public void afterSingletonsInstantiated() {
        for (String client : List.of("catalog", "inventory")) {
            FeignHttpMessageConverters converters = factory.getInstance(client, FeignHttpMessageConverters.class);
            if (converters != null) { converters.getConverters(); }
        }
    }
}
