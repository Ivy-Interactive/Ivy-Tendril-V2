---
title: Banco de Dados
description: Gerencie o banco de dados SQLite local que armazena dados de
  sincronização de planos, recomendações, histórico de jobs e rastreamento de
  custos.
icon: Database
searchHints:
  - banco de dados
  - db
  - migrar
  - migração
  - esquema
  - versão
  - redefinir
  - sqlite
  - integridade
  - vacuum
---

# Banco de Dados

Gerencie o banco de dados [SQLite](https://www.sqlite.org) local (`<TendrilHome>/tendril.db`) que armazena [dados de sincronização de planos](../../02_Concepts/01_Plans.md), [histórico de jobs](../../04_Apps/04_Jobs.md), recomendações e rastreamento de custos. No Tendril v2, todo o gerenciamento de banco de dados é acessado por meio da árvore de subcomandos `tendril db`.

## Comandos

#### db version

```terminal
>tendril db version
```

Inspeciona o esquema do banco de dados sem aplicar migrações. Exibe a versão atual do banco de dados, a versão mais recente esperada pelo binário instalado e o status da migração (`Up to date`, `Needs migration` ou `Newer than application`).

```terminal
Database version: 12
Latest version:   12
Status:           Up to date
```

#### db migrate

```terminal
>tendril db migrate
```

Aplica todas as migrações pendentes para atualizar o esquema do banco de dados. Seguro para executar repetidamente — as migrações já aplicadas são ignoradas de forma idempotente.

> [!NOTE]
> `tendril run` aplica automaticamente as migrações pendentes antes de iniciar o servidor daemon, portanto, a migração manual raramente é necessária.

#### db reset

```terminal
>tendril db reset
>tendril db reset --force
```

Exclui todas as tabelas em `tendril.db` e recria o esquema do zero. Solicita confirmação a menos que `--force` seja fornecido. Recusa-se a executar se o daemon estiver ativo no momento, a menos que `--force` seja informado.

> [!WARNING]
> A redefinição exclui todos os registros do banco de dados (histórico de jobs em cache, telemetria, recomendações). Os [arquivos YAML de plano](01_Plan.md) criados por você e os arquivos markdown de revisão no disco permanecem completamente intocados.

#### db integrity

```terminal
>tendril db integrity
```

Executa um [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check) do SQLite em todas as tabelas, índices e páginas. Imprime cada resultado de verificação e encerra com código 1 se qualquer corrupção ou anomalia estrutural for encontrada.

#### db vacuum

```terminal
>tendril db vacuum
>tendril db vacuum --force
```

Executa o [VACUUM](https://www.sqlite.org/lang_vacuum.html) do SQLite para desfragmentar o banco de dados, reconstruir índices e recuperar espaço em disco não utilizado. Informa o tamanho do banco de dados antes e depois da execução, juntamente com o total de bytes recuperados.

## Relacionados

- [Visão Geral da CLI](00_Overview.md) — opções globais, caminhos de diretório de dados e verificações de integridade da instalação
- [comandos de plan](01_Plan.md) — crie, liste e valide planos armazenados em disco
