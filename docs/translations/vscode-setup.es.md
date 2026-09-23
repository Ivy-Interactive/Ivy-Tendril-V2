# Guía de configuración de Visual Studio Code para las Skills de Tendril

Esta guía explica cómo instalar, configurar y usar las Skills de Agente de Tendril con GitHub Copilot y otras extensiones de agentes de IA en Visual Studio Code.

## 1. Instalación rápida (Skills CLI)

La forma más sencilla de instalar las skills de Tendril para GitHub Copilot en VS Code es mediante la CLI abierta de agent skills:

```bash
# Instalación a nivel de proyecto (se instala en .agents/skills/ o .github/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# Instalación global (disponible en todos los espacios de trabajo de VS Code)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Para instalar skills individuales específicas en lugar del paquete completo:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. Rutas de instalación manual

Si prefieres colocar las carpetas de skills manualmente sin la CLI:

- **Repositorio del espacio de trabajo (recomendado para equipos)**:
  Copia las skills en `.agents/skills/<skill-name>` o `.github/skills/<skill-name>` en la raíz de tu espacio de trabajo.
- **Perfil de usuario (global para todos los proyectos)**:
  Copia las skills en `~/.copilot/skills/<skill-name>` (macOS/Linux) o `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows).

Asegúrate de que cada carpeta de skill contenga su especificación `SKILL.md` y los directorios `references/` o `scripts/` correspondientes.

## 3. Uso de skills en GitHub Copilot Chat

Una vez instaladas, GitHub Copilot detecta automáticamente las skills:

1. Abre Copilot Chat en VS Code (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Escribe `/skills` para inspeccionar las skills cargadas y sus descripciones.
3. Invoca cualquier skill de Tendril directamente como un comando:
   - `/tendril-debug-plan <plan-id>`: Inspecciona registros de ejecución, línea de tiempo y verificaciones de un plan.
   - `/tendril-debug-job <job-id>`: Analiza artefactos de trabajo, registros del agente y eventos en bruto.
   - `/tendril-review`: Ejecuta una revisión completa de código y pruebas sobre los archivos modificados.
   - `/tendrillable <url>`: Evalúa issues de GitHub para su ejecución mediante agentes autónomos.

## 4. Integración con otras extensiones de IA para VS Code

Las skills de Tendril cumplen con el estándar abierto de agent skills y funcionan sin problemas con extensiones de terceros para VS Code:

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
Las skills se escriben en `.cline/skills/` o en el directorio de configuración global de Cline.

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
Las skills se instalan en tu directorio `.continue/skills/` y se pueden referenciar en el contexto de las instrucciones.

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
Se instalan en `.roo/skills/` para modos personalizados del sistema y ejecución de tareas.

## 5. Combinación con la extensión oficial de Ivy Tendril para VS Code

Para un flujo de trabajo de desarrollo integrado, instala la [extensión oficial de Ivy Tendril para VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril):

- **Panel de planes (Plan Dashboard)**: Explora, revisa y activa planes directamente desde la barra lateral.
- **Navegador de worktrees**: Salta a worktrees de ejecución aislados con un solo clic.
- **Control del servidor**: Inicia, detén e inspecciona procesos en segundo plano del servidor de Tendril.

La combinación de las skills de Tendril con la extensión de VS Code proporciona un centro de control completo para la orquestación de agentes de programación autónomos.

## Licencia

Las skills y plugins de Tendril están licenciados bajo la [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) de la raíz del repositorio.
