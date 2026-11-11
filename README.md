# Tempo no caminho

Previsão do tempo ao longo de um trajeto. Você informa de onde sai, para onde vai e a que horas, e o app mostra, para cada trecho, na hora em que você passa por ele: a chance e a força da chuva, neblina, trovoada, vento, noite, serra, tipo de pista e trânsito.

É um app de página única, que roda inteiro no navegador. Não tem servidor próprio nem cadastro.

## Estado do projeto

Experimental. A previsão de chuva hora a hora, num ponto, com um dia de antecedência, é pouco confiável em boa parte do Brasil, e o app mede isso em vez de esconder: guarda o que previu e, depois da viagem, compara com a chuva observada por satélite (seção "Verificação das previsões").

## Como usar

1. Abra o site e preencha partida, chegada, dia e hora.
2. Leia o resumo, o gráfico (chance de chuva em cima, volume embaixo) e a lista trecho a trecho.
3. Opcional: em "Segunda fonte: Google", cole uma chave pessoal do Google Maps Platform com a Weather API e a Routes API liberadas. Com ela, o caminho e o tempo de viagem (com trânsito) passam a vir do Google, e a previsão do Google aparece ao lado da do app.

## Acompanhar a viagem

Com o site aberto em https ou instalado, o botão "Acompanhar a viagem" usa o GPS do aparelho, com a tela ligada. O painel mostra onde você está no caminho, a chegada prevista, o que vem em 10, 30 e 60 minutos e o próximo aviso. Durante o acompanhamento o app se atualiza sozinho: o trânsito a partir da posição, a cada 5 minutos; a chuva pelo Google nos trechos à frente, a cada 15 minutos; os modelos e as simulações do Open-Meteo, a cada 3 horas. Se a pessoa ficar a mais de 800 m do caminho por mais de três minutos, a rota é refeita a partir de onde ela está (no máximo a cada 15 minutos e 8 vezes por viagem).

## De onde vêm os dados

| O quê | Serviço | Observações |
|---|---|---|
| Caminho e tempo de viagem | Google Routes API (com chave) ou OSRM nos servidores da FOSSGIS | sem chave, o caminho é o do OpenStreetMap, sem trânsito |
| Previsão do tempo | Open-Meteo: simulações (ensembles) do ECMWF, GFS e ICON e modelos detalhados de até nove centros | uso gratuito não comercial, 10.000 chamadas por dia por rede |
| Segunda previsão | Google Weather API (com chave) | 10.000 chamadas por mês sem cobrança |
| Tipo de pista, faixas e piso | Overpass API (dados do OpenStreetMap) | lidos em dois pontos por trecho do caminho |
| Relevo | Open-Meteo Elevation (modelo de terreno Copernicus, malha de 90 m) | até 200 pontos por viagem |
| Nomes de lugares | Photon (Komoot) | |
| Mapa | OpenFreeMap, desenhado com MapLibre GL JS | |
| Chuva observada | NASA GIBS, produto IMERG | só na verificação; chega umas 5 horas depois |

## Privacidade e chaves

- Nada é enviado a um servidor do projeto, porque ele não existe. As consultas saem do seu navegador direto para os serviços acima.
- Viagens salvas, preferências, a chave do Google e o registro das previsões ficam no armazenamento local do navegador, em cada aparelho.
- **Nunca coloque uma chave no código nem neste repositório.** A chave é digitada na tela e fica só no navegador de quem a digitou. Quem abre o site sem chave usa apenas os serviços gratuitos.
- Depois de publicar, restrinja a sua chave no Google Cloud ao endereço do site (restrição por site) e às duas APIs usadas.

## Montar

Requer Python 3.

```
python3 build.py
```

Lê `src/` e escreve o site em `docs/`: um `index.html` com o CSS, o JavaScript e a fonte embutidos, mais o manifesto, o service worker e os ícones.

- `src/template.html`, `src/styles.css`: página e estilos.
- `src/app.1.js` a `src/app.3.js`: código, na ordem em que é juntado (dados e rota; previsão combinada; relevo e pista; verificação e ajuste; Google; telas; mapa e fluxo).
- `src/sw.js`, `src/manifest.webmanifest`: funcionamento sem conexão e instalação.

## Testar

Os testes abrem o app num navegador controlado (Playwright) com todos os serviços simulados. Eles imprimem o que encontraram; não substituem um teste com os serviços reais.

```
npm install
npx playwright install chromium
python3 build.py
npm test
```

## Publicar no GitHub Pages

1. Envie o conteúdo desta pasta para um repositório público.
2. Em Settings, Pages, escolha "Deploy from a branch", ramo `main`, pasta `/docs`.
3. O site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

## Instalar no celular

Com o site aberto no Chrome do Android, use o menu e escolha "Instalar app" (ou "Adicionar à tela inicial"). O app abre em tela cheia e guarda a última consulta para uso sem conexão.

## Limitações conhecidas

- A chance de chuva sem ajuste costuma ser alta demais; a verificação mostra o quanto.
- O tipo de pista depende de como a estrada foi cadastrada no OpenStreetMap.
- Pontes e túneis podem enganar o relevo.
- Vários caminhos de dados só foram testados com serviços simulados antes de chegar ao uso real.

## Licença e créditos

Código sob a licença MIT (arquivo `LICENSE`).

- Dados de mapa e de vias: © colaboradores do OpenStreetMap, licença ODbL.
- Previsão: Open-Meteo (CC BY 4.0), com dados do ECMWF, NOAA, DWD, Met Office e outros centros.
- Mapa: OpenFreeMap e OpenMapTiles; MapLibre GL JS (BSD de 3 cláusulas).
- Fonte Overpass: SIL Open Font License 1.1 (`src/fonts/LICENSE-Overpass.txt`).
- Google Weather API e Routes API: uso sujeito aos termos do Google Maps Platform, com a chave de cada pessoa.
- Chuva observada: NASA GIBS, produto IMERG.

