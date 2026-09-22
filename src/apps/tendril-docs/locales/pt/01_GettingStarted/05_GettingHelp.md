---
title: Obtendo Ajuda
description: Travou em algo? Veja como obter suporte e se conectar com a comunidade Tendril.
icon: LifeBuoy
searchHints:
  - ajuda
  - suporte
  - discord
  - github issues
  - comunidade
  - relatório de bug
  - report-bug
  - doctor
---

# Obtendo Ajuda

Se você encontrar problemas ou tiver dúvidas sobre a configuração do Tendril, múltiplos recursos de
suporte e ferramentas de diagnóstico estão disponíveis.

## Execute os diagnósticos primeiro

Antes de enviar uma issue ou pedir ajuda, execute o verificador de ambiente integrado do Tendril:

```bash
tendril doctor
```

O `tendril doctor` verifica o diretório `$TENDRIL_HOME`, a sintaxe do `config.yaml`, a acessibilidade do
banco de dados [SQLite](https://www.sqlite.org), o diretório de [planos](../02_Concepts/01_Plans.md), o [Git](https://git-scm.com/) e a
autenticação do [GitHub CLI](https://cli.github.com/).

Se um plano ou job específico falhar, você pode agrupar os diagnósticos completos usando `tendril report-bug`:

```bash
# Package plan state, verification reports, and job logs into a zip
tendril report-bug <plan-id>
```

Isso gera um arquivo compactado de diagnóstico que empacota o YAML do plano, o histórico de revisões, a saída de verificação
e as transcrições brutas do agente sem expor credenciais confidenciais.

## Solução de problemas

Para mensagens de erro comuns, migrações de banco de dados e etapas de recuperação de worktree, consulte
[Solução de problemas](06_Troubleshooting.md).

## Comunidade no Discord

A maneira mais rápida de falar com a equipe de desenvolvimento e outros desenvolvedores é o nosso
[servidor do Discord](https://discord.gg/FHgxkDga3y). Participe para tirar dúvidas, compartilhar feedback e discutir fluxos de trabalho personalizados de promptware.

## Issues no GitHub

Encontrou um bug ou quer solicitar uma funcionalidade? Abra uma issue em nosso
[repositório no GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril-V2/issues).

> [!TIP]
> Sempre inclua a saída de `tendril doctor` e `tendril version` na descrição da sua issue. Se
> estiver relatando uma execução de plano com falha, anexe o zip de diagnóstico gerado por `tendril report-bug <plan-id>`
> ou o log do job de `$TENDRIL_HOME/Jobs/`.

## Próximos passos

- [Solução de problemas](06_Troubleshooting.md) — assinaturas de erro comuns e soluções.
- [Ciclo de vida e Jobs](../02_Concepts/03_Lifecycle.md) — entenda os status de jobs e o tratamento de erros.
