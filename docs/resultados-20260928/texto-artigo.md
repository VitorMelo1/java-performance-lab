ANÁLISE DE DESEMPENHO ENTRE PROGRAMAÇÃO REATIVA COM SPRING WEBFLUX/R2DBC E PROGRAMAÇÃO TRADICIONAL COM SPRING MVC/JDBC EM APIS JAVA SOB ALTA CONCORRÊNCIA

Vitor Martins Melo

Athos Lial Passos

Jonatan Mariano da Silva

RESUMO

Este artigo compara implementações de APIs Java com Spring MVC/JDBC e Spring WebFlux/R2DBC em um experimento local. Como cenário complementar, avalia chamadas externas com RestTemplate e OpenFeign no MVC e WebClient no WebFlux. Foram executadas 84 rodadas, combinando quatro taxas programadas, três repetições e operações de leitura SQL, escrita SQL e comunicação HTTP. Registraram-se tempos de resposta, vazão válida, falhas, iterações não iniciadas e utilização de recursos. Na leitura a 1.000 requisições por segundo, a mediana dos p95 foi de 10 ms no MVC e 618 ms no WebFlux; a variante reativa apresentou descarte nas três repetições dessa condição. A implementação reativa utilizou menos threads e menos memória em comparações selecionadas, mas não apresentou vantagem geral de latência. Vinte rodadas tiveram carga parcialmente entregue, e a variação temporal indica que o aquecimento adotado não assegurou regime estável em todos os cenários. Uma rodada complementar, com aquecimento na taxa alvo e medição mais longa, registrou 60.000 chamadas WebFlux HTTP a 500 req/s sem erros ou descartes. A discrepância reforça o caráter exploratório dos resultados e a necessidade de repetir a comparação sob protocolo controlado.

Palavras-chave: Spring MVC. Spring WebFlux. JDBC. R2DBC. Avaliação de desempenho.

1 INTRODUÇÃO

O atendimento de requisições simultâneas é um problema relevante no desenvolvimento de APIs Java que acessam bancos de dados. Durante uma requisição, a aplicação pode alternar entre processamento e espera por operações de entrada e saída, como a execução de uma consulta SQL. A maneira como essa espera é administrada influencia a ocupação das threads e dos recursos disponíveis. A documentação do Project Reactor explica que operações bloqueantes mantêm threads à espera de dados, enquanto o processamento assíncrono não bloqueante permite utilizar esses recursos em outras tarefas durante a espera (Project Reactor, s.d.).

No ecossistema Spring, esse problema pode ser examinado por meio de duas combinações tecnológicas: Spring MVC com JDBC e Spring WebFlux com R2DBC. A primeira permite construir uma aplicação imperativa com acesso bloqueante ao banco; a segunda combina processamento web reativo e acesso não bloqueante a dados relacionais. Essas diferenças tornam a comparação pertinente, mas não permitem presumir que a implementação reativa será sempre mais rápida. A documentação do Spring relaciona seus benefícios esperados à escalabilidade e ao uso de recursos em operações com espera por entrada e saída, e não a uma redução automática do tempo de cada operação (Spring, s.d.-a; Hale et al., 2022).

A literatura também apresenta resultados dependentes do cenário. Mochniej e Badurowicz (2023) observaram diferenças associadas às operações e aos atrasos de comunicação ao comparar microserviços com Spring Web e Spring WebFlux. Esses achados justificam avaliar cargas e configurações delimitadas, considerando a interação entre a camada HTTP, o acesso ao banco e os recursos de execução.

Diante disso, este trabalho investiga a seguinte questão: como as combinações Spring WebFlux/R2DBC e Spring MVC/JDBC diferem em tempo de resposta, vazão e consumo de recursos quando submetidas a níveis crescentes de concorrência? O objetivo geral é comparar o desempenho de duas implementações funcionalmente equivalentes de uma API Java, considerando o atendimento das requisições e a utilização de CPU e memória. A avaliação observa também erros e esgotamentos de tempo, pois a quantidade de respostas produzidas precisa ser interpretada em conjunto com sua correção.

Como avaliação complementar, comparam-se RestTemplate e OpenFeign no MVC e WebClient no WebFlux em chamadas a um serviço HTTP com atraso controlado. O recorte principal compreende operações de leitura e escrita em banco de dados relacional, com equivalência das regras de negócio, das consultas e dos recursos disponíveis. Neste estudo, a implementação tradicional é entendida como a combinação MVC/JDBC com processamento bloqueante e threads de plataforma. A alta concorrência é examinada em relação à capacidade do ambiente, mediante aumento da carga até a ocorrência de degradação mensurável, e não por um número universal de usuários. A contribuição é fornecer evidências reproduzíveis sobre os limites e as vantagens de cada combinação nas condições avaliadas, apoiando decisões de desenvolvimento de APIs.

Após esta introdução, apresenta-se o referencial teórico. A terceira seção descreve a metodologia; a quarta apresenta e discute os resultados; a quinta examina as limitações; e a sexta reúne as conclusões.

2 REFERENCIAL TEÓRICO

2.1 Concorrência e operações de entrada e saída

Concorrência corresponde à existência de tarefas cujos períodos de execução se sobrepõem; paralelismo corresponde à execução simultânea de tarefas em recursos de processamento distintos. Em uma API, várias requisições podem permanecer em andamento enquanto aguardam respostas do banco, mesmo que poucas estejam executando instruções naquele instante. Por isso, o número de requisições em andamento e a quantidade de núcleos de CPU representam aspectos diferentes da carga.

No processamento bloqueante, uma thread pode permanecer indisponível para outra requisição durante uma chamada de entrada e saída. Na abordagem não bloqueante, a conclusão da operação é sinalizada posteriormente, permitindo organizar a continuidade do processamento sem dedicar uma thread à espera. O Project Reactor apresenta esse mecanismo como uma forma de aproveitar os recursos existentes, particularmente quando parte do tempo de atendimento é consumida por espera externa (Project Reactor, s.d.).

Essa distinção exige separar cargas limitadas por processamento de cargas com predominância de espera. Neste trabalho, o acesso ao banco é parte explícita do recorte: consultas curtas e chamadas HTTP com atraso controlado podem expor limites diferentes. A interpretação deve considerar também a capacidade do próprio banco, para que uma restrição compartilhada pelas duas implementações não seja atribuída exclusivamente ao framework web.

2.2 Spring MVC e acesso a dados com JDBC

Spring MVC é um framework web construído sobre a API Servlet. Ele fornece a estrutura utilizada pela aplicação para receber requisições HTTP e encaminhá-las ao processamento correspondente (Spring, s.d.-d). Na implementação imperativa considerada neste estudo, o fluxo de atendimento executa as etapas necessárias à resposta por meio de chamadas bloqueantes.

JDBC, sigla de Java Database Connectivity, é a API de acesso a dados da plataforma Java. Seu conjunto de interfaces permite estabelecer conexões, executar instruções SQL, recuperar resultados e controlar transações. Elementos como Connection, PreparedStatement e ResultSet representam, respectivamente, a conexão com a fonte de dados, a instrução parametrizada e o resultado retornado pela consulta (Oracle, s.d.). No recorte MVC/JDBC, o atendimento da requisição aguarda a conclusão das chamadas ao banco para prosseguir.

Um pool de conexões permite reutilizar um conjunto limitado de conexões com o banco. O tamanho desse conjunto interfere na quantidade de operações que podem utilizar conexões simultaneamente; por isso, ele constitui uma variável relevante para a comparação. Para este estudo, o pool de conexões e o mecanismo de execução de threads devem ser tratados separadamente. Disponibilizar mais threads para a API não implica disponibilizar mais conexões ou aumentar a capacidade de execução de consultas do banco.

2.3 Programação reativa e Reactive Streams

Bainomugisha et al. (2013) descrevem a programação reativa como uma abordagem que oferece abstrações para representar valores que variam ao longo do tempo e gerenciar suas dependências. A revisão dos autores também mostra a diversidade de modelos existentes. Portanto, o termo reativo designa uma família de abordagens; seu uso em uma comparação exige identificar quais tecnologias e mecanismos são efetivamente empregados.

No contexto deste artigo, a implementação reativa é associada ao processamento de fluxos assíncronos e não bloqueantes. A especificação Reactive Streams estabelece interfaces e regras de interação entre produtores e consumidores, com suporte a backpressure. Esse mecanismo permite que o consumidor sinalize a quantidade de elementos que está preparado para receber, contribuindo para controlar a transmissão dos dados e a necessidade de armazenamento intermediário (Reactive Streams, s.d.).

A existência de backpressure em um fluxo não deve ser interpretada, por si só, como uma garantia de proteção de toda a API contra sobrecarga. A especificação delimita a interação entre componentes participantes do fluxo. Assim, controles de admissão de requisições HTTP, limites de conexões e políticas de tempo de espera continuam sendo aspectos próprios da configuração da aplicação e de suas dependências. Essa distinção evita atribuir ao modelo reativo capacidades que dependem de outras decisões de implementação.

2.4 Spring WebFlux e acesso relacional com R2DBC

Spring WebFlux foi desenvolvido para aplicações web não bloqueantes e utiliza o Project Reactor em sua base. Seu modelo pressupõe que as tarefas executadas nos event loops, responsáveis por processar eventos de entrada e saída, não bloqueiem essas threads. A introdução de chamadas bloqueantes nesse caminho pode comprometer o comportamento esperado da aplicação (Spring, s.d.-a).

R2DBC, sigla de Reactive Relational Database Connectivity, define uma interface de provedores de serviço para acesso reativo a bancos relacionais na JVM. Sua especificação contempla execução de instruções SQL, obtenção de resultados e operações transacionais por meio de contratos compatíveis com Reactive Streams. A finalidade é permitir que drivers e bibliotecas realizem esse acesso de forma adequada ao modelo reativo (Hale et al., 2022).

A combinação WebFlux/R2DBC permite que a camada web e o acesso ao banco adotem contratos não bloqueantes. Para a comparação proposta, essa característica precisa ser preservada ao longo do caminho de atendimento: inserir uma chamada JDBC no processamento reativo alteraria o objeto avaliado. Também é necessário reconhecer o limite da mudança de interface. A utilização de R2DBC não constitui, por si só, uma otimização da consulta SQL nem elimina o trabalho executado pelo banco; o efeito sobre o desempenho deverá ser medido nas condições do experimento.

2.5 Métricas de desempenho e caracterização da carga

A análise de desempenho exige definir o que será observado. O tempo de resposta representa a duração percebida pelo cliente entre o envio da requisição e o recebimento completo da resposta. A vazão corresponde à quantidade de operações concluídas por unidade de tempo e, neste estudo, distingue respostas válidas de falhas. CPU e memória complementam a avaliação ao permitir relacionar a quantidade de trabalho atendida aos recursos consumidos.

A média do tempo de resposta não descreve sozinha a distribuição das observações. Os percentis p95 e p99 indicam os valores até os quais se encontram, respectivamente, 95% e 99% dos tempos medidos. Dean e Barroso (2013) discutem como a variabilidade e as respostas mais lentas podem afetar serviços em escala. Essa discussão fundamenta a observação da cauda da distribuição, além de medidas de tendência central, no exame de APIs sob carga.

A forma de geração da carga também influencia o resultado. A documentação do k6 distingue modelos fechados, nos quais o início de uma nova iteração depende da conclusão da anterior, de modelos abertos, nos quais a chegada de trabalho é controlada independentemente dessa conclusão. No modelo fechado, a lentidão da aplicação pode reduzir a taxa de novas solicitações e modificar a pressão aplicada ao sistema. Por isso, a comparação deve informar tanto a carga oferecida quanto a efetivamente executada e as limitações do gerador de testes (Grafana Labs, s.d.-b).

No presente trabalho, alta concorrência é tratada como uma condição experimental vinculada ao ambiente avaliado. O crescimento da carga deverá permitir observar em que momento a vazão deixa de acompanhar a demanda, os tempos de resposta aumentam ou as falhas se tornam mais frequentes. Esse enquadramento permite comparar o comportamento de degradação das implementações, além de registrar seu desempenho em condições de menor utilização.

2.6 Estudos relacionados e delimitação da comparação

Mochniej e Badurowicz (2023) desenvolveram aplicações de microserviços com Spring Web e Spring WebFlux e utilizaram Gatling para avaliar acesso a dados, processamento e comunicação. Os resultados variaram entre os cenários: houve vantagens da abordagem reativa em determinadas operações com espera por entrada e saída, mas também situações com tempos comparáveis ou superiores aos da implementação convencional. O consumo de memória foi menor na maioria dos casos examinados. O estudo constitui uma referência para discutir resultados condicionados à carga; entretanto, seu conjunto de serviços e bancos não equivale a uma comparação isolada entre JDBC e R2DBC.

O presente estudo concentra a análise nas combinações WebFlux/R2DBC e MVC/JDBC em uma API com funcionalidades equivalentes. Como a substituição envolve componentes da camada web e do acesso a dados, os resultados deverão ser atribuídos ao conjunto testado. Atribuir uma diferença exclusivamente ao paradigma de programação exigiria isolar outros fatores, como drivers, servidores HTTP e configurações de execução.

A equivalência funcional deverá abranger o conteúdo das respostas, as regras de negócio e as operações realizadas no banco. A validade da comparação dependerá ainda do registro das versões das tecnologias, dos limites de recursos e das configurações dos pools, além do controle do aquecimento da JVM e da repetição das medições. Esses critérios sustentam uma interpretação restrita às condições observadas e orientam a etapa experimental apresentada a seguir.

2.7 Clientes HTTP e controle da carga

O experimento complementar considera três clientes HTTP. RestTemplate realiza chamadas síncronas, enquanto OpenFeign permite declarar clientes por interfaces e, na implementação adotada, utiliza execução bloqueante. WebClient fornece uma API não bloqueante integrada ao modelo reativo. A documentação do Spring Cloud OpenFeign não oferece suporte a clientes reativos; por isso, sua inclusão no MVC e o uso de WebClient no WebFlux preservam o comportamento esperado de cada implementação (Spring, s.d.-b; Spring, s.d.-c).

No executor de taxa constante do k6, uma iteração pode deixar de ser iniciada se todos os usuários virtuais disponíveis estiverem ocupados. O indicador dropped_iterations registra essa diferença entre a demanda programada e a carga iniciada. Seu crescimento pode refletir a configuração do gerador ou o aumento do tempo de atendimento, devendo ser examinado junto das demais métricas (Grafana Labs, s.d.-a).

3 METODOLOGIA

3.1 Delineamento e ambiente

Realizou-se um experimento quantitativo e exploratório em uma máquina Windows, utilizando Docker Desktop com Docker Engine 29.7.2 sobre WSL2, arquitetura x86-64. O computador possui processador Intel Core Ultra 7 255U, com 12 núcleos e 14 processadores lógicos. A identificação complementar do equipamento registrou aproximadamente 63,5 GiB de memória física; o ambiente Docker informou aproximadamente 31,1 GiB disponíveis. A revisão do script identificou que o filtro usado para contar containers externos era rejeitado pelo Docker, embora o metadado resultante fosse zero. Esse campo foi considerado não confiável; a coleta inicial não comprova ausência de outros containers ou processos no sistema operacional.

Foram utilizados Java Temurin 21, imagem de execução identificada como jdk-21.0.12.1+1, Spring Boot 4.0.3, Spring Cloud 2025.1.1, PostgreSQL 17.4, Node.js 22.14.0 no serviço auxiliar e k6 1.0.0. Os identificadores de imagem permaneceram constantes durante o lote. A conferência dos hashes não encontrou divergência entre os arquivos de código registrados no experimento e os arquivos disponíveis na primeira análise, anterior às correções do protocolo de coleta. As versões são as efetivamente usadas neste estudo, sem pretensão de representar as versões mais recentes.

Quadro 1 – Recursos e limites do ambiente

Fonte: configuração efetiva e inspeções dos containers do lote experimental.

3.2 Implementações e cargas

As aplicações foram organizadas em projetos independentes. O MVC executou SQL explícito por JDBC e permitiu selecionar RestTemplate ou OpenFeign para comunicação externa, ambos sobre Apache HttpClient 5. A aplicação WebFlux utilizou R2DBC para SQL e WebClient com Reactor Netty para HTTP. Foram mantidos o schema, as consultas e o conteúdo das respostas. Como a comparação altera servidor web, driver, pool e cliente HTTP, a unidade de comparação é a implementação completa, e não somente o paradigma de programação ou um mecanismo isolado.

O cenário de leitura executou SELECT por chave primária. O cenário de escrita executou UPDATE do estoque seguido de RETURNING na mesma instrução, com valor 100 e identificadores distribuídos deterministicamente entre os 10.000 produtos. A igualdade do valor gravado torna o conteúdo verificável, mas não elimina o trabalho de escrita do PostgreSQL. Antes de cada rodada SQL, a tabela foi restaurada e submetida a VACUUM ANALYZE. Não foi utilizado cache de aplicação nem ORM.

No cenário HTTP, cada requisição originou uma única chamada a um serviço auxiliar com atraso programado de 100 ms. Esse endpoint não acessou o banco. Foram comparados MVC/RestTemplate, MVC/OpenFeign e WebFlux/WebClient. Nos cenários SQL, compararam-se apenas MVC/JDBC e WebFlux/R2DBC, pois trocar o cliente HTTP não altera a operação SQL medida. Testes funcionais anteriores à coleta verificaram os contratos de sucesso, entradas inválidas, falhas externas, persistência e chamadas concorrentes.

3.3 Protocolo e tratamento das medições

O k6 utilizou o executor constant-arrival-rate, com taxas programadas de 50, 200, 500 e 1.000 requisições por segundo. Cada condição foi repetida três vezes. As sete combinações de implementação e cenário, multiplicadas por quatro taxas e três repetições, produziram 84 rodadas. Sua ordem foi embaralhada com semente 20260928. Cada rodada reiniciou a aplicação, realizou aquecimento separado de 15 segundos à taxa mínima entre a taxa da condição e 100 req/s e mediu os 45 segundos seguintes. O limite de usuários virtuais foi mantido em 500; ele não corresponde ao número efetivo de requisições simultâneas.

O tempo request_wall_ms foi medido em torno da chamada HTTP síncrona feita pelo k6 e inclui espera por conexão, envio e recebimento. O resultado foi validado pelo status e pelo conteúdo JSON. A vazão válida foi calculada como respostas corretas divididas pela duração efetiva informada pelo k6, incluindo a drenagem final. Por esse motivo, pequenas diferenças em relação à taxa nominal podem ocorrer mesmo sem descartes. O timeout de cada requisição do gerador foi de 8 segundos.

Foram preservados resumos JSON, amostras temporais compactadas, logs, configuração, hashes de código, identificadores de imagens e métricas de recursos. CPU e memória foram amostradas periodicamente com Docker; métricas JVM complementaram a coleta. Na análise, utilizaram-se as amostras de recursos cujos instantes estavam dentro da janela reconstruída das chamadas medidas. Os números de recursos representam resumos amostrais, não máximos contínuos nem médias ponderadas pelo tempo.

Para cada condição, apresentam-se a mediana de três medidas por rodada e a amplitude mínimo–máximo. A mediana de três p95 não é o p95 obtido ao unir todas as requisições. Não foram aplicados testes de significância estatística, pois o pequeno número de repetições e a instabilidade temporal limitam a inferência. Rodadas com descartes foram mantidas e assinaladas: sua vazão e latência descrevem a carga efetivamente atendida, sem equivaler a uma comparação sob carga integralmente entregue.

4 RESULTADOS E DISCUSSÃO

4.1 Integridade da coleta

As 84 rodadas produziram os artefatos esperados. A conferência das amostras brutas confirmou as contagens e os p95 dos resumos. Foram registradas 1.574.991 chamadas iniciadas, das quais 1.574.292 tiveram resposta válida e 699 falharam. Houve 78.818 iterações não iniciadas, distribuídas por 20 rodadas. Cinco rodadas tiveram falhas nas chamadas; todas também apresentaram descartes. Esses números agregados descrevem a coleta e não devem ser usados como uma taxa global comparativa entre implementações com cargas diferentes.

O critério automatizado de execução exigia zero descartes e menos de 1% de respostas inválidas. A ausência de aviso, portanto, não significaria necessariamente ausência de erros. Nesta coleta, as 64 rodadas sem descarte também não registraram falhas. Todos os aquecimentos encerraram com código de sucesso; isso confirma a execução do aquecimento, mas não comprova estabilização da JVM.

4.2 Como interpretar as medidas e os gráficos

A taxa programada representa a quantidade de requisições que o gerador tenta iniciar a cada segundo. Uma taxa de 500 req/s, por exemplo, significa tentar começar 500 chamadas por segundo; ela não indica 500 usuários simultâneos. A vazão válida representa quantas respostas corretas foram concluídas por segundo. Quando existem descartes, parte das chamadas planejadas nunca é iniciada e, portanto, não possui tempo de resposta medido.

O percentil 95, abreviado como p95, é o tempo dentro do qual terminaram 95% das chamadas medidas em uma rodada. Um p95 de 10 ms significa que 95% dessas chamadas levaram até aproximadamente 10 milissegundos; os 5% restantes demoraram mais. Mil milissegundos equivalem a um segundo. Neste artigo, cada ponto resume a mediana dos três p95 obtidos nas repetições, conforme descrito na metodologia.

Nas Figuras 1 a 3, o painel esquerdo apresenta o tempo de resposta: valores menores indicam menor latência. Seu eixo vertical é logarítmico; passar de 10 para 100 ms representa aumento de dez vezes, assim como passar de 100 para 1.000 ms. O painel direito apresenta a vazão de respostas válidas. As barras verticais delimitam o menor e o maior valor entre as três repetições e permitem observar sua variação. O símbolo × identifica uma condição em que pelo menos uma repetição não iniciou toda a carga programada; não representa necessariamente uma resposta de erro da API.

4.3 Leitura no banco de dados

Na leitura SQL, MVC/JDBC apresentou medianas dos p95 de 5, 3, 3 e 10 ms para 50, 200, 500 e 1.000 req/s. WebFlux/R2DBC apresentou 7, 7, 13 e 618 ms nas mesmas taxas programadas. A variante MVC entregou a carga sem descartes nas 12 rodadas de leitura. A variante reativa teve descarte em uma das três repetições de 500 req/s e nas três de 1.000 req/s. Assim, a comparação mais forte em favor do MVC é a combinação de menor latência observada e manutenção da demanda programada, e não uma suposta equivalência de cargas em todas as condições.

Figura 1 – Tempo de resposta e vazão nas leituras SQL

Fonte: elaboração dos autores a partir das medições de 28 set. 2026. Barras indicam mínimo e máximo entre três repetições. O símbolo × identifica condições com descarte em pelo menos uma rodada.

4.4 Escrita no banco de dados

Na escrita a 200 req/s, ambas as implementações tiveram p95 mediano de 7 ms. A 500 req/s, os valores foram 21 ms para MVC/JDBC e 237 ms para WebFlux/R2DBC, com carga entregue integralmente nas três repetições de cada implementação. Essa diferença foi observada em uma condição sem descartes e sem erros, embora a amplitude entre repetições e o comportamento transitório ainda limitem sua generalização.

A 1.000 req/s, ambas as implementações apresentaram descartes nas três repetições. As medianas de vazão válida foram 886,5 req/s para MVC e 842,7 req/s para WebFlux. Os p95 medianos foram, respectivamente, 1.066 e 793 ms. O menor p95 do WebFlux nessa condição não estabelece superioridade, pois os conjuntos de chamadas efetivamente atendidas diferiram. As três rodadas MVC tiveram, no total, 45 respostas HTTP 500; as rodadas reativas de escrita não registraram respostas inválidas.

Figura 2 – Tempo de resposta e vazão nas escritas SQL

Fonte: elaboração dos autores a partir das medições de 28 set. 2026. Barras indicam mínimo e máximo entre três repetições. O símbolo × identifica condições com descarte em pelo menos uma rodada.

4.5 Chamadas HTTP externas

Nas taxas de 50 e 200 req/s, as três alternativas apresentaram p95 medianos entre 104 e 107 ms, próximos do atraso de 100 ms configurado no serviço auxiliar. A 500 req/s, MVC/OpenFeign apresentou p95 mediano de 106 ms, enquanto MVC/RestTemplate apresentou 121 ms; ambas entregaram a carga sem erros ou descartes. WebFlux/WebClient apresentou p95 mediano de 1.507 ms e descarte em duas das três repetições, o que exige interpretar separadamente suas condições de atendimento.

A 1.000 req/s, as medianas de vazão válida foram 989,5 req/s para OpenFeign, 954,8 req/s para RestTemplate e 923,8 req/s para WebClient. Ocorreram descartes em duas das três rodadas com OpenFeign e nas três rodadas das demais alternativas. Com um pool de 100 conexões e espera remota de aproximadamente 0,1 s por chamada, a relação 100/0,1 sugere uma referência idealizada próxima de 1.000 chamadas por segundo, antes de custos adicionais. Esse cálculo explica por que o limite de conexões merece atenção nessa taxa, mas não identifica sozinho a causa da degradação.

Figura 3 – Tempo de resposta e vazão nas chamadas HTTP externas

Fonte: elaboração dos autores a partir das medições de 28 set. 2026. Barras indicam mínimo e máximo entre três repetições. O símbolo × identifica condições com descarte em pelo menos uma rodada.

4.6 Utilização de recursos

O Quadro 2 apresenta resultados de recursos na taxa programada de 500 req/s. Para cada rodada calculou-se a média das amostras disponíveis, seguida da mediana das três médias. A medida de memória corresponde ao valor informado pelo Docker para o container, e não apenas ao heap Java. Na medida de CPU, 100% representa aproximadamente a utilização de um processador lógico; o limite configurado de duas CPUs corresponde aproximadamente a 200%.

Quadro 2 – Medianas das médias amostrais de recursos

Fonte: elaboração dos autores. * Houve descarte em pelo menos uma repetição; os recursos correspondem a cargas efetivamente atendidas diferentes.

Nessas comparações, o WebFlux utilizou menos threads e menor memória de container. Na escrita a 500 req/s, em que ambos entregaram a carga, observaram-se aproximadamente 23 threads no WebFlux e 73,8 no MVC, com memória de 275,1 e 300,9 MiB, respectivamente. Entretanto, a redução desses recursos não foi acompanhada de menor latência. No HTTP a 500 req/s, o WebFlux apresentou CPU amostral elevada e menor carga atendida em duas repetições; por isso, o menor consumo de memória não pode ser interpretado isoladamente como maior eficiência por requisição.

4.7 Verificação complementar do protocolo

Após a análise da coleta inicial, executou-se uma verificação diagnóstica isolada do WebFlux/WebClient a 500 req/s. Essa execução utilizou aquecimento de 60 segundos na própria taxa do cenário e medição de 120 segundos, preservando o atraso remoto de 100 ms, os 500 usuários virtuais, os limites de recursos e a implementação Java. Não foram executadas, nessa verificação, as outras variantes nem três repetições. Seus números não foram agregados às Figuras 1 a 3 nem às medianas da coleta inicial.

Durante o aquecimento, foram observados 361 descartes e nenhuma resposta inválida. Na medição posterior, foram concluídas 60.000 chamadas válidas, sem falhas nem descartes, com vazão de 499,6 req/s, p95 de 103 ms e p99 de 107 ms. O p95 foi de 103 ms em cada uma das três janelas de 40 segundos examinadas. A contagem de amostras brutas coincidiu com o resumo do gerador, e os logs passaram a incluir explicitamente a aplicação ativa.

Esse resultado mostra que o comportamento degradado da primeira coleta não se repetiu nessa execução. Ele é compatível com a influência de transientes e do protocolo, mas não demonstra que o aquecimento foi a única causa: a duração e o momento da execução também diferiram. Uma rodada isolada não comprova repetibilidade nem permite classificar WebClient, RestTemplate e OpenFeign sob o novo protocolo. A comparação completa precisa ser repetida nas mesmas condições antes de estabelecer uma classificação entre as alternativas.

5 LIMITAÇÕES E AMEAÇAS À VALIDADE

A principal limitação é a ausência de comprovação de regime estável. O aquecimento durou 15 segundos e foi limitado a 100 req/s, mesmo quando a medição chegou a 1.000 req/s. Na escrita MVC a 1.000 req/s, o p95 dos primeiros dez segundos variou de aproximadamente 834 a 1.295 ms, enquanto o dos últimos dez segundos variou de aproximadamente 9 a 47 ms. Essa diferença temporal é compatível com comportamento transitório, mas os dados não isolam suas causas: compilação JIT, formação de filas, agendamento e outras mudanças do ambiente podem participar.

O WebFlux HTTP a 500 req/s também variou fortemente: os p95 por repetição foram 159, 1.507 e 2.321,3 ms. Duas rodadas concentraram 654 falhas, sendo 653 chamadas com status 0 no gerador e uma resposta 502. Status 0 indica ausência de resposta HTTP válida registrada pelo cliente, não um código HTTP devolvido pela aplicação. A verificação complementar apresentou resultado mais favorável, mas uma única rodada ainda não sustenta uma conclusão de desempenho estável e repetível.

A coleta inicial de logs dos serviços não incluiu explicitamente os containers Java ativados por perfil do Docker Compose. Por isso, os arquivos preservados dessa coleta não permitem identificar a exceção da aplicação correspondente a cada falha. A contagem de erros continua disponível no gerador; sua causa, entretanto, exige nova execução com registro explícito dos serviços ativos.

Outra limitação é a entrega parcial da carga quando os 500 usuários virtuais se esgotaram. Os percentis não incluem tempos das iterações que nunca foram iniciadas. Portanto, resultados de rodadas com descartes não devem ser tratados como observações de uma carga integralmente aplicada. Ampliar o limite de usuários pode ajudar no diagnóstico, desde que os recursos do gerador e todas as variantes sejam controlados novamente.

Aplicações, gerador, banco e upstream compartilharam a mesma máquina e a virtualização do Docker Desktop. Limites iguais de container não equivalem a núcleos físicos dedicados. Não houve medição independente do upstream nesse lote, nem amostragem de todos os processos do host. Os recursos registrados ajudam a investigar gargalos, mas não autorizam atribuição causal definitiva a um componente.

O experimento utiliza consultas curtas sobre 10.000 linhas, atualização idempotente de um único campo, três repetições e apenas um atraso remoto. As diferenças entre Tomcat, Reactor Netty, JDBC, R2DBC, HikariCP e seus mecanismos de fila fazem parte do resultado observado. Também não foram avaliados MVC com virtual threads, outras consultas, cargas prolongadas, falhas de rede controladas ou bancos distribuídos. A generalização para sistemas de produção exige novos experimentos.

6 CONCLUSÃO

Nas condições deste experimento, a implementação MVC/JDBC apresentou menor latência em diversos cenários e manteve a demanda programada em todas as rodadas de leitura SQL. Na coleta inicial de chamadas externas a 500 req/s, OpenFeign e RestTemplate atenderam integralmente a carga, enquanto o WebClient apresentou descarte em duas repetições. Na verificação complementar do WebClient, com protocolo revisto, não houve descarte nem falha em 60.000 chamadas; esse resultado exige cautela na interpretação da comparação inicial. O WebFlux utilizou menos threads e menor memória em comparações selecionadas, evidenciando que tempo de resposta e utilização de recursos devem ser avaliados conjuntamente.

Os resultados não sustentam a premissa de que a adoção de programação reativa produz automaticamente APIs mais rápidas. Também não estabelecem que MVC seja superior em qualquer contexto. A entrega parcial de carga em 20 rodadas e os indícios de comportamento transitório limitam a interpretação a uma comparação exploratória das implementações e configurações avaliadas.

Como continuidade, recomenda-se repetir as condições com maior variação usando aquecimento na taxa do cenário, verificar estabilidade antes de medir, ampliar a duração e o número de repetições, avaliar diretamente o upstream e dimensionar o gerador para entregar a carga sem descartes. Esses controles permitirão distinguir melhor os efeitos das implementações daqueles decorrentes da bancada e do protocolo de execução.

REFERÊNCIAS

BAINOMUGISHA, Engineer; LOMBIDE CARRETON, Andoni; VAN CUTSEM, Tom; MOSTINCKX, Stijn; DE MEUTER, Wolfgang. A survey on reactive programming. ACM Computing Surveys, v. 45, n. 4, art. 52, p. 1–34, 2013. Disponível em: https://doi.org/10.1145/2501654.2501666. Acesso em: 15 set. 2026.

DEAN, Jeffrey; BARROSO, Luiz André. The tail at scale. Communications of the ACM, v. 56, n. 2, p. 74–80, 2013. Disponível em: https://research.google/pubs/the-tail-at-scale/. Acesso em: 15 set. 2026.

GRAFANA LABS. Dropped iterations. Grafana k6 documentation, [s.d.]-a. Disponível em: https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/dropped-iterations/. Acesso em: 28 set. 2026.

GRAFANA LABS. Open and closed models. Grafana k6 documentation, [s.d.]-b. Disponível em: https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/. Acesso em: 15 set. 2026.

HALE, Ben; PALUCH, Mark; TURNQUIST, Greg; BRYANT, Jay; FELDER, Elena. R2DBC — Reactive Relational Database Connectivity. Especificação, versão 1.0.0.RELEASE, 25 abr. 2022. Disponível em: https://r2dbc.io/spec/1.0.0.RELEASE/spec/html/. Acesso em: 15 set. 2026.

MOCHNIEJ, Kacper; BADUROWICZ, Marcin. Performance comparison of microservices written using reactive and imperative approaches. Journal of Computer Sciences Institute, v. 28, p. 242–247, 2023. Disponível em: https://ph.pollub.pl/index.php/jcsi/article/view/3698. DOI: 10.35784/jcsi.3698. Acesso em: 15 set. 2026.

ORACLE. Package java.sql. Java Platform Standard Edition 21 API Specification, [s.d.]. Disponível em: https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/package-summary.html. Acesso em: 15 set. 2026.

PROJECT REACTOR. Introduction to reactive programming. Reactor Core Reference Guide, [s.d.]. Disponível em: https://projectreactor.io/docs/core/release/reference/reactiveProgramming.html. Acesso em: 15 set. 2026.

REACTIVE STREAMS. Reactive Streams. [S.l.], [s.d.]. Disponível em: https://www.reactive-streams.org/. Acesso em: 15 set. 2026.

SPRING. Overview. Spring Framework Reference Documentation: Spring WebFlux, [s.d.]-a. Disponível em: https://docs.spring.io/spring-framework/reference/web/webflux/new-framework.html. Acesso em: 15 set. 2026.

SPRING. REST clients. Spring Framework Reference Documentation, [s.d.]-b. Disponível em: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html. Acesso em: 28 set. 2026.

SPRING. Spring Cloud OpenFeign features. Spring Cloud OpenFeign Reference Documentation, [s.d.]-c. Disponível em: https://docs.spring.io/spring-cloud-openfeign/reference/spring-cloud-openfeign.html. Acesso em: 28 set. 2026.

SPRING. Spring Web MVC. Spring Framework Reference Documentation, [s.d.]-d. Disponível em: https://docs.spring.io/spring-framework/reference/web/webmvc.html. Acesso em: 15 set. 2026.