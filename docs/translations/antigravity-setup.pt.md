# Guia de Configuração do Google Antigravity para Tendril Skills

Este guia aborda a instalação e o uso das skills do Tendril com a CLI do Google Antigravity (`agy`) e a Antigravity IDE.

## 1. Instalação da CLI do Antigravity

O Tendril fornece um manifesto de plugin do Antigravity em `.agents/plugins/marketplace.json`.

### Instalar a partir de um Repositório Git Remoto
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### Instalar a partir de um Checkout Local do Repositório
Durante o desenvolvimento local ou dentro de um checkout do Ivy-Tendril-V2:
```bash
agy plugin install ./
```

## 2. Verificação e Descoberta de Plugins

Verifique se o plugin e suas skills associadas foram carregados:

```bash
# Listar plugins instalados
agy plugin list

# Verificar skills disponíveis
agy skill list
```

Você verá as skills integradas do Tendril:
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Invocação de Skills no Antigravity

Em qualquer sessão interativa de agente do Antigravity ou script automatizado:

- Peça ao Antigravity para depurar um plano:
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- Revise diffs pendentes de worktree:
  ```
  Run tendril-review on the current changes
  ```
- Faça a triagem de issues candidatas do backlog:
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Integração com a Antigravity IDE

Ao trabalhar dentro da Antigravity IDE:
1. Skills localizadas no diretório raiz `.agents/skills/` do seu espaço de trabalho são indexadas automaticamente.
2. Para vincular a extensão Ivy Tendril à Antigravity IDE:
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Recarregue a Antigravity IDE (`Cmd+Shift+P` -> `Developer: Reload Window`).

## Licença

As skills e plugins do Tendril são licenciados sob a [Functional Source License (FSL-1.1-ALv2)](../LICENSE) na raiz do repositório.
