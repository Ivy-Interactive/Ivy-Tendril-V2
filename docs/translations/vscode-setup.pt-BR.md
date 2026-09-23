# Guia de Configuração do Visual Studio Code para Tendril Skills

Este guia explica como instalar, configurar e usar as Tendril Agent Skills com o GitHub Copilot e outras extensões de agentes de IA no Visual Studio Code.

## 1. Instalação Rápida (CLI de Skills)

A maneira mais fácil de instalar as skills do Tendril para o GitHub Copilot no VS Code é usando a CLI de open agent skills:

```bash
# Instalação no nível do projeto (instala em .agents/skills/ ou .github/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# Instalação global (disponível em todos os espaços de trabalho do VS Code)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Para instalar skills individuais específicas em vez do pacote completo:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. Caminhos de Instalação Manual

Se preferir organizar as pastas de skills manualmente sem a CLI:

- **Repositório do espaço de trabalho (recomendado para equipes)**:
  Copie as skills para `.agents/skills/<skill-name>` ou `.github/skills/<skill-name>` na raiz do seu espaço de trabalho.
- **Perfil de usuário (global para todos os projetos)**:
  Copie as skills para `~/.copilot/skills/<skill-name>` (macOS/Linux) ou `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows).

Certifique-se de que cada pasta de skill contenha sua especificação `SKILL.md` e quaisquer diretórios complementares `references/` ou `scripts/`.

## 3. Usando Skills no GitHub Copilot Chat

Uma vez instaladas, o GitHub Copilot descobre automaticamente as skills:

1. Abra o Copilot Chat no VS Code (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Digite `/skills` para inspecionar as skills carregadas e suas descrições.
3. Invoque qualquer skill do Tendril diretamente como um comando:
   - `/tendril-debug-plan <plan-id>`: Inspecionar registros de execução, linha do tempo e verificações de um plano.
   - `/tendril-debug-job <job-id>`: Analisar artefatos de tarefas, logs do agente e eventos brutos.
   - `/tendril-review`: Executar uma revisão abrangente de código e testes pós-alteração nos arquivos modificados.
   - `/tendrillable <url>`: Avaliar issues do GitHub para execução autônoma por agentes.

## 4. Integração com Outras Extensões de IA do VS Code

As skills do Tendril seguem o padrão aberto de agent skills e funcionam perfeitamente com extensões de terceiros do VS Code:

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
As skills são gravadas em `.cline/skills/` ou no diretório de configuração global do Cline.

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
As skills são instaladas no seu diretório `.continue/skills/` e podem ser referenciadas no contexto de prompts.

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
Instalado em `.roo/skills/` para modos personalizados de sistema e execução de tarefas.

## 5. Pareamento com a Extensão Oficial do Ivy Tendril para VS Code

Para um fluxo de desenvolvimento integrado, instale a extensão oficial [Ivy Tendril VS Code Extension](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril):

- **Painel de Planos**: Navegue, revise e acione planos diretamente da barra lateral.
- **Navegador de Worktrees**: Acesse worktrees de execução isolados com um único clique.
- **Controle de Servidor**: Inicie, pare e inspecione processos em segundo plano do servidor Tendril.

O pareamento das skills do Tendril com a extensão do VS Code oferece um centro de controle completo para orquestração autônoma de agentes de codificação.

## Licença

As skills e plugins do Tendril são licenciados sob a [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) na raiz do repositório.
