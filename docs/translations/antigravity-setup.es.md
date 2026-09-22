# Guía de configuración de Google Antigravity para las Skills de Tendril

Esta guía describe cómo instalar y usar las skills de Tendril con la CLI de Google Antigravity (`agy`) y Antigravity IDE.

## 1. Instalación de Antigravity CLI

Tendril proporciona un manifiesto de plugin de Antigravity en `.agents/plugins/marketplace.json`.

### Instalación desde un repositorio Git remoto
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### Instalación desde un checkout local del repositorio
Durante el desarrollo local o dentro de un clon de Ivy-Tendril-V2:
```bash
agy plugin install ./
```

## 2. Verificación y detección de plugins

Comprueba que el plugin y sus skills asociadas estén cargados:

```bash
# Listar plugins instalados
agy plugin list

# Verificar skills disponibles
agy skill list
```

Verás las skills incluidas de Tendril:
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Invocación de skills en Antigravity

En cualquier sesión interactiva de agente de Antigravity o en scripts automatizados:

- Pedir a Antigravity que depure un plan:
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- Revisar diffs pendientes en el worktree:
  ```
  Run tendril-review on the current changes
  ```
- Evaluar issues candidatas del backlog:
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Integración con Antigravity IDE

Al trabajar dentro de Antigravity IDE:
1. Las skills ubicadas en el directorio raíz `.agents/skills/` de tu espacio de trabajo se indexan automáticamente.
2. Para vincular la extensión de Ivy Tendril en Antigravity IDE:
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Recarga Antigravity IDE (`Cmd+Shift+P` -> `Developer: Reload Window`).

## Licencia

Las skills y plugins de Tendril están licenciados bajo la [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) de la raíz del repositorio.
