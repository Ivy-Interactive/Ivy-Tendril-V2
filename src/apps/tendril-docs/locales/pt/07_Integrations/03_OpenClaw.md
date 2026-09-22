---
title: OpenClaw
description: Integre o OpenClaw ou qualquer ferramenta baseada em arquivos ao
  Tendril soltando arquivos markdown na pasta Inbox.
icon: Terminal
searchHints:
  - openclaw
  - inbox
  - pasta
  - monitorador de arquivos
  - pasta de entrada
---

# OpenClaw

## Visão Geral

O Tendril monitora uma **pasta Inbox** em busca de novos arquivos markdown e os converte automaticamente em [planos](../02_Concepts/01_Plans.md). Isso fornece um ponto de integração simples baseado em arquivos para ferramentas externas como o OpenClaw ou scripts personalizados que gravam arquivos em disco.

## Localização da Pasta Inbox

```
$TENDRIL_HOME/Inbox/
```

Para obter detalhes sobre o diretório base do Tendril e sua configuração, consulte [Configuração e Definições](../03_Configuration/01_Setup.md). O monitorador do sistema de arquivos do Tendril vigia este diretório em busca de novos arquivos `.md`.

## Formato do Arquivo

Solte um arquivo markdown (`.md`) com frontmatter YAML opcional:

```markdown
---
project: ProjectName
sourcePath: optional/path/to/code
---

Descreva o plano aqui. Este texto se torna a descrição do plano
e é passado para o [promptware CreatePlan](../02_Concepts/02_Promptwares.md).
```

| Campo        | Obrigatório | Descrição                                           |
| ------------ | ----------- | --------------------------------------------------- |
| `project`    | Não         | Nome do projeto de destino (padrão: `Auto`)         |
| `sourcePath` | Não         | Sugestão de caminho para o código-fonte relacionado |

O conteúdo após o frontmatter torna-se a descrição do plano.

> [!NOTE]
> Se você omitir o frontmatter completamente, todo o conteúdo do arquivo será usado como a descrição do plano com as configurações padrão.

## Ciclo de Vida do Arquivo

1. **Soltar** um arquivo `.md` na pasta Inbox
2. **Processamento** — O arquivo é renomeado para `.md.processing` enquanto estiver sendo tratado
3. **Conclusão** — O arquivo é excluído assim que o plano for criado com sucesso

## Recuperação

Se o Tendril reiniciar durante o processamento, qualquer arquivo `.md.processing` será automaticamente recuperado de volta para `.md` e reprocessado na inicialização.

## Configurando com o OpenClaw

Configure o OpenClaw para gravar sua saída como arquivos markdown na pasta Inbox do Tendril. Cada arquivo se torna um plano separado:

1. Defina o diretório de saída como `$TENDRIL_HOME/Inbox/`
2. Use o formato markdown com frontmatter YAML para direcionamento de projeto
3. O Tendril detecta novos arquivos automaticamente — sem necessidade de consultas periódicas (polling) ou chamadas de API
