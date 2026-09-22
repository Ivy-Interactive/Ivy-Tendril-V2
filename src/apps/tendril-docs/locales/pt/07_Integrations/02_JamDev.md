---
title: Jam.dev
description: Integre o jam.dev com o Tendril para criar planos automaticamente a
  partir de relatórios de bugs via webhook da API de caixa de entrada (inbox).
icon: Bug
searchHints:
  - jam
  - jam.dev
  - webhook
  - api de caixa de entrada
  - relatórios de bugs
---

# Jam.dev

## Visão geral

O [Jam.dev](https://jam.dev) pode enviar relatórios de bugs para o endpoint da API de caixa de entrada (inbox) do Tendril, que cria [planos](../02_Concepts/01_Plans.md) automaticamente via o [promptware](../02_Concepts/02_Promptwares.md) `CreatePlan`. Para obter detalhes sobre os endpoints HTTP subjacentes, consulte [REST API](../09_Advanced/02_REST.md).

## URL do Webhook

Configure o [Jam.dev](https://jam.dev) para fazer POST em:

```
http://localhost:5010/api/inbox
```

Substitua `localhost:5010` pelo host e pela porta do seu Tendril caso estejam configurados de forma diferente. Para a configuração do servidor, consulte [Configuração e Definições](../03_Configuration/01_Setup.md).

## Formato da Requisição

Envie uma requisição POST com um corpo JSON:

```json
{
  "description": "Bug description from jam.dev",
  "project": "ProjectName",
  "sourcePath": "optional/path/to/related/code",
  "force": false
}
```

| Campo         | Obrigatório | Descrição                                                                                |
| ------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `description` | Sim         | O relatório de bug ou a descrição do problema                                            |
| `project`     | Não         | Nome do projeto de destino (o padrão é `Auto`)                                           |
| `sourcePath`  | Não         | Sugestão de caminho para o código-fonte relacionado                                      |
| `force`       | Não         | Força a criação mesmo se uma tarefa idêntica já estiver em execução (o padrão é `false`) |

## Autenticação

Se você configurou `api.apiKey` no `config.yaml`, inclua-o como o cabeçalho de requisição `X-Api-Key`:

```http
X-Api-Key: your-api-key
```

Você também pode se autenticar usando o segredo do daemon via:

```http
Authorization: Bearer <secret>
```

> [!TIP]
> Quando `api.apiKey` não estiver configurado, o segredo do daemon ou a conexão de loopback local será utilizada. Para ambientes remotos ou de equipe, configure uma chave de API no `config.yaml`.

## Resposta

Uma requisição bem-sucedida retorna HTTP 200:

```json
{
  "jobId": "abc123",
  "status": "Started",
  "message": "Plan creation job started successfully"
}
```

Se uma descrição idêntica for enviada enquanto uma tarefa `CreatePlan` já estiver em andamento e `force` não for `true`, o Tendril retornará HTTP 409 Conflict:

```json
{
  "error": "A CreatePlan job is already running for this description",
  "status": "Conflict"
}
```

## Configuração no jam.dev

1. Abra as configurações do seu workspace no jam.dev
2. Navegue até integrações ou webhooks
3. Adicione um novo webhook apontando para a URL da caixa de entrada do Tendril (`http://localhost:5010/api/inbox`)
4. Configure os cabeçalhos (como `X-Api-Key`) se a autenticação estiver habilitada
5. Configure o payload para corresponder ao formato de requisição acima
