---
title: GitHub
description: O Tendril integra-se com o GitHub para importação de issues,
  criação automática de PRs e acompanhamento de status de PRs.
icon: GitBranch
searchHints:
  - github
  - issues
  - pull requests
  - prs
  - importação
---

# GitHub

## Autenticação

O Tendril usa a [GitHub CLI](https://cli.github.com) (`gh`) para autenticação com o [GitHub](https://github.com). Execute `gh auth login` para se autenticar antes de usar os recursos do GitHub.

> [!NOTE]
> Certifique-se de que o `gh` está instalado e disponível no seu PATH. O Tendril solicitará a instalação durante a integração inicial caso ele esteja ausente.

## Importando Issues pela Caixa de Entrada

O Tendril oferece uma visualização dedicada de **Caixa de Entrada** (Inbox) na barra lateral para navegar pelas issues do [GitHub](https://github.com) e transformá-las em [planos](../02_Concepts/01_Plans.md):

1. Abra a **Caixa de Entrada** a partir da barra lateral de navegação.
2. Selecione uma categoria:
   - **Minhas Issues**: Issues atribuídas a você em todos os repositórios de projetos configurados.
   - **Solicitações de Revisão**: Pull requests abertos solicitando a sua revisão.
   - **Issues do Projeto**: Todas as issues abertas de um repositório de projeto selecionado.
3. Filtre por termos de pesquisa, labels ou marcos (milestones). Uma única consulta recupera até 1.000 issues abertas (o limite de pesquisa do GitHub).
4. Selecione uma ou mais issues e clique em **Criar Plano** para iniciar a [promptware](../02_Concepts/02_Promptwares.md) `CreatePlan`, ou personalize a descrição do plano na caixa de diálogo de Novo Plano antes de disparar.

Cada plano criado mantém a URL de origem com link direto para a issue original do GitHub.

### Varredura Automática de Issues e Propostas

O Tendril inclui uma varredura automática em segundo plano para issues atribuídas do GitHub:

- Configure `inbox.checkIntervalMinutes` (ou clique na engrenagem de Configurações na visualização da Caixa de Entrada) para definir com que frequência o Tendril consulta o GitHub em busca de novas issues atribuídas.
- **Modo de Aceitação Automática**: Quando `inbox.autoAcceptAssignedIssues` está ativado, as issues recém-descobertas iniciam imediatamente uma tarefa `CreatePlan`.
- **Modo de Propostas**: Quando desativado, as issues varridas são preparadas como **Propostas da Caixa de Entrada** na visualização da Caixa de Entrada. Você pode revisar a descrição de cada proposta e escolher **Aceitar** (iniciando o plano) ou **Descartar** (armazenando um registro duradouro para que a issue nunca seja reimportada).
- Clique em **Verificar Agora** na barra de ferramentas da Caixa de Entrada para acionar uma varredura manual imediata sem aguardar o temporizador programado.

## Criando Pull Requests

Quando um plano for concluído e tiver suas alterações verificadas, abra a caixa de diálogo **Criar PR** para criar um pull request:

1. Revise e edite o título, a descrição e os revisores gerados para o PR.
2. Configure as opções do PR:
   - **Resolver Conflitos de Merge**: Tenta resolver automaticamente os conflitos de merge da branch contra a base de destino.
   - **Fazer Merge**: Realiza o merge do PR assim que as verificações passarem (desmarque para abrir o PR para revisão da equipe sem realizar o merge).
   - **Excluir Branch**: Exclui a branch da worktree assim que o merge for concluído.
   - **Incluir Artefatos**: Anexa artefatos de verificação do plano, capturas de tela e logs ao corpo do PR.
   - **Criar como Rascunho**: Abre o pull request no status de rascunho (draft).
3. O Tendril executa a [promptware](../02_Concepts/02_Promptwares.md) `CreatePr` via `gh` para enviar a branch (push), criar o pull request e vincular a URL do PR ao plano.

## Acompanhamento de Status de PRs

A [visualização de Pull Requests](../04_Apps/06_PullRequests.md) na barra lateral monitora todos os pull requests abertos, mesclados e fechados em seus projetos. O Tendril monitora as alterações de estado dos PRs, mantendo o seu [quadro de planos](../04_Apps/03_Plans.md) sincronizado sem intervenção manual.
