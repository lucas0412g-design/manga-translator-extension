# Tradutor de Mangás

Extensão **open source e gratuita** para traduzir balões de mangás, manhwas e webtoons diretamente nas imagens, de **inglês ou espanhol para português do Brasil**.

> **Estado: versão experimental v0.1.3.** O código e o pacote automatizado estão disponíveis, mas a extensão **ainda não foi publicada na loja de complementos do Firefox nem passou por validação de funcionamento em navegador**. Não existe, por enquanto, um botão oficial de instalação com um clique.

## Navegadores compatíveis (objetivo)

- **PC: Microsoft Edge**. Há um pacote experimental próprio, baseado em Manifest V3. Ele é montado pelo GitHub Actions como `tradutor-manga-edge` e ainda precisa ser validado no Edge. A versão do Firefox não deve ser carregada no Edge.
- **Celular: Firefox Android**. Mantemos o pacote Firefox separado, baseado em Manifest V2, gerado como `tradutor-manga`. A instalação permanente depende de assinatura e distribuição da Mozilla.

O pacote Edge utiliza um documento em segundo plano para executar o OCR local. Diferentemente da versão Firefox, a versão Edge ainda não implementa o ajuste de cabeçalho `Referer` para sites com proteção contra acesso direto às imagens.

## Como será utilizada

Após a publicação nas lojas compatíveis, a experiência prevista será: **adicionar a extensão ao navegador → abrir a história → aceitar o aviso de privacidade → ativar a tradução para aquele site**. Não será necessário instalar Node.js nem executar comandos.

## Recursos implementados

- Reconhecimento de texto (OCR) com Tesseract.js, processado localmente, em inglês e espanhol.
- Tradução automática para português, com provedores externos de reserva quando um serviço falhar.
- Exibição da tradução por cima do balão, sem modificar a imagem original.
- Leitura progressiva das imagens próximas da área visível e cache de até 14 dias.
- Botão **PT** para alternar tradução/original; toque em um balão para revelar a versão original.
- Ativação por site e aviso explícito antes do uso de serviços externos.

## Privacidade

**Somente o texto reconhecido** é enviado aos serviços externos de tradução (Google Tradutor via interface não oficial, MyMemory e Lingva). O OCR roda localmente. A extensão solicita acesso amplo a URLs para poder obter imagens armazenadas em CDNs, mas processa capítulos somente em sites ativados pelo usuário. Consulte [PRIVACIDADE.md](PRIVACIDADE.md) para detalhes.

**Limitação atual do cancelamento:** a autorização é verificada antes de cada imagem, faixa de OCR e balão. Uma requisição já iniciada ainda pode continuar; dentro de um mesmo balão podem ocorrer tentativas de provedores alternativos antes de uma nova checagem. Evite usar em páginas com texto sensível.

## Limitações

- Imagens em `canvas`, URLs `blob:` e leitores com restrições especiais ainda podem não funcionar.
- Textos manuscritos, efeitos sonoros e fontes estilizadas podem ser reconhecidos incorretamente.
- A tradução ainda ocorre balão por balão. Memória de personagens e revisão contextual estão planejadas para versões futuras.
- O serviço de tradução não oficial pode falhar ou aplicar limites; não há garantia de disponibilidade ilimitada.

## Código aberto e compilação

Código licenciado sob [MIT](LICENSE). O GitHub Actions prepara automaticamente o pacote completo, incluindo os arquivos locais necessários ao OCR, executa os testes e o verificador da Mozilla. Para contribuidores, o processo de montagem pode ser consultado em [`.github/workflows/build.yml`](.github/workflows/build.yml). Dependências compiladas em `vendor/` não são versionadas.

Os ZIPs gerados pelo GitHub Actions são **pacotes experimentais**. O pacote Firefox não é assinado pela Mozilla; o Edge usa um formato diferente. A publicação nas lojas e o funcionamento real precisam ser confirmados separadamente.
