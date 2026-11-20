# Tradutor de Mangás v0.1.1

Extensão para o **Firefox** (PC e Android) que lê o texto dos balões em imagens, traduz
(**inglês ou espanhol → português do Brasil**) e desenha a tradução por cima, sem alterar a imagem.

> Status: código escrito e com as funções puras testadas (`npm test`), mas **ainda não testado em
> um Firefox real**. Espere ajustes nos primeiros testes.

## 1. Instalar as dependências (uma vez)

Precisa do [Node.js](https://nodejs.org) (versão 18 ou mais nova).

```
npm install
npm run setup
npm test
```

`npm run setup` copia o Tesseract.js e os dados de inglês/espanhol para a pasta `vendor/`
(a extensão não pode baixar código de fora).

## 2. Testar no Firefox do PC

```
npm run start:desktop
```

Abra um site de leitura, clique no ícone da extensão, aceite o aviso de privacidade,
ative **"Ativar neste site"** e role a página. O botão azul **PT** (canto da tela) alterna
entre tradução e original. Tocar num balão traduzido mostra o original daquele balão.

## 3. Testar no Moto G56 (Firefox Android)

1. No celular: Configurações → Sobre o telefone → toque 7 vezes em "Número da versão"; depois
   ative **Depuração USB** nas opções do desenvolvedor.
2. No Firefox Android: Configurações → **Depuração remota via USB** (ativar).
3. No PC (com o `adb` instalado e o celular conectado): `adb devices` para ver o ID e então

```
npx web-ext run --target=firefox-android --android-device ID_DO_CELULAR
```

Para instalar de forma permanente é preciso **assinar** a extensão (gratuito, canal "unlisted"
no addons.mozilla.org, com `npx web-ext sign --channel=unlisted`).

## Como funciona

- **Pré-carregamento:** imagens até ~3000 px acima/abaixo da tela entram na fila; a mais próxima
  da tela vai primeiro. Até 2 pedidos ao mesmo tempo; o OCR roda 1 imagem por vez.
- **OCR:** Tesseract.js em Web Worker. Imagens compridas são fatiadas; blocos com baixa confiança
  ganham uma segunda leitura; abaixo de 55% de confiança o balão fica **sem tradução** (mantém o original).
- **Tradução:** Google Tradutor (interface não oficial) → MyMemory → Lingva, nessa ordem. Se um
  provedor devolve erro 429/403 ele entra em "descanso" por 10 minutos. Resultados ficam em cache
  (14 dias). Só o **texto** sai do celular, nunca a imagem.
- **Visual:** caixa na cor do fundo do balão, letras em CAIXA ALTA quando o original era assim.

## Segurança e privacidade

- A extensão pede acesso a todos os sites (`<all_urls>`) porque precisa **baixar as imagens**, que muitas vezes
  ficam em outro domínio (CDN). Sem isso o navegador não deixa ler os pixels. Para limitar o risco:
  nada roda até você aceitar o aviso **e** ativar o site no popup.
- **Desativação e cancelamento:** o background revalida o consentimento e a ativação do site antes de cada imagem, de cada faixa de OCR e de cada balão enviado para tradução. Etapas ainda não iniciadas deixam de ser processadas quando essa verificação falha. **Limitação da v0.1.1:** uma requisição de tradução já iniciada não é abortada; além disso, não há nova verificação de permissão entre provedores alternativos para o mesmo balão. Cada tentativa de rede tem timeout de 8 segundos, mas várias tentativas podem levar mais tempo no total. Por isso, desativar não garante a interrupção imediata de toda atividade de rede. Não use a extensão em páginas com textos sensíveis.
- O cabeçalho `Referer` (usado por sites que bloqueiam hotlink) é enviado só com a **origem** do site
  (`https://site/`), nunca com o endereço completo da página, e só em pedidos feitos pela própria extensão.
- Se o addons.mozilla.org pedir a declaração de coleta de dados ao assinar, o texto lido nas imagens vai para
  serviços de tradução de terceiros (tipo "conteúdo do site").
- Mantém-se na memória só as camadas de tradução das imagens perto da tela; as demais voltam pelo cache.

## Limitações conhecidas

- Só Firefox por enquanto (usa a API `browser.*`). O Vivaldi Android aceita extensões do Chrome,
  mas precisa de uma adaptação (Manifest V3).
- Leitores que desenham em `canvas`, usam `blob:` ou protegem a imagem podem ser pulados.
- Sites em que tocar na imagem passa a página: o toque em balão traduzido vira "mostrar original".
- Letra manuscrita e onomatopeias têm leitura fraca.
- Tradução balão a balão: ainda sem contexto entre falas nem memória de personagens (v0.2).

## Ajustes rápidos (`background.js`, objeto `CFG`)

`minBlockConf` (mais alto = menos erros, mais balões sem tradução), `refineBelow`,
`maxTileMP` (menor = OCR mais leve), `providers` (ordem dos tradutores).
