---
title: vault
description: Gestione vaults de configuración de equipo, descubra y conecte repositorios compartidos en GitHub, inspeccione recursos del catálogo, importe proyectos y publique actualizaciones de configuración directamente desde la CLI.
icon: KeyRound
searchHints:
  - vault
  - sync
  - pull
  - import
  - push
  - catálogo
  - discover
  - connect
  - auto-sync
  - equipo
---

# vault

Gestione vaults de configuración de equipo respaldados por [Git](https://git-scm.com) y [GitHub](https://github.com). Los vaults permiten a los equipos compartir configuraciones de proyectos, habilidades personalizadas, configuraciones de servidores [Model Context Protocol (MCP)](https://modelcontextprotocol.io), memorias de promptware y verificaciones entre estaciones de trabajo. La CLI interactúa con la [CLI de GitHub (`gh`)](https://cli.github.com) para descubrir repositorios de equipo, importar plantillas de proyectos y enviar actualizaciones a través de [Pull Requests de GitHub](https://docs.github.com/en/pull-requests).

Consulte [Proyectos](02_Project.md) para la configuración local de proyectos y [Configuración global](06_Config.md) para los ajustes globales.

## Comandos

```terminal
>tendril vault list [--json]
>tendril vault status [vault-id] [--json]
>tendril vault discover [--json]
>tendril vault connect <repo-url> [--name <custom-name>]
>tendril vault create <repo-name> [--public] [--org <org>]
>tendril vault disconnect [vault-id] [-y, --yes]
>tendril vault sync [vault-id]
>tendril vault pull [vault-id]
>tendril vault set-auto-sync <enabled> [--vault <vault-id>]
>tendril vault catalog [vault-id] [--json]
>tendril vault import <project-name> [options]
>tendril vault push <projects...> [options]
>tendril vault delete <project-name> [--vault <vault-id>] [-y, --yes]
```

## Gestión de Vaults

#### list

```terminal
>tendril vault list
>tendril vault list --json
```

Lista todos los vaults conectados, mostrando su ID, nombre, URL del repositorio remoto de [Git](https://git-scm.com), rama activa, recuento de commits por delante/por detrás, marca de tiempo de la última sincronización y estado de sincronización automática.

#### status

```terminal
>tendril vault status
>tendril vault status <vault-id>
>tendril vault status --json
```

Muestra el estado de diagnóstico y sincronización detallado para un vault específico o el vault principal configurado, incluidas las modificaciones locales no confirmadas y el estado de seguimiento de la rama.

#### discover

```terminal
>tendril vault discover
>tendril vault discover --json
```

Explora [GitHub](https://github.com) mediante la [CLI de GitHub (`gh`)](https://cli.github.com) para descubrir repositorios de vault existentes accesibles para su cuenta y organizaciones.

#### connect

```terminal
>tendril vault connect https://github.com/my-org/team-vault.git
>tendril vault connect my-org/team-vault --name "Engineering Vault"
```

Conecta un repositorio [Git](https://git-scm.com) existente como vault de equipo. Acepta URLs completas de repositorio o el formato abreviado `org/repo`.

#### create

```terminal
>tendril vault create engineering-vault
>tendril vault create team-vault --org my-org --public
```

Crea un nuevo repositorio en [GitHub](https://github.com) (privado de forma predeterminada), inicializa la estructura de directorios estándar del vault y lo conecta localmente. Utilice `--org` para indicar una organización y `--public` para visibilidad pública.

#### disconnect

```terminal
>tendril vault disconnect
>tendril vault disconnect <vault-id> -y
```

Desconecta un vault de la configuración local de Tendril sin eliminar el directorio del clon local. Pase `-y` o `--yes` para omitir las solicitudes de confirmación.

#### sync / pull

```terminal
>tendril vault sync
>tendril vault pull
>tendril vault sync <vault-id>
```

Descarga los últimos commits de configuración del repositorio remoto del vault y actualiza los proyectos locales rastreados. `pull` es un alias de `sync`.

#### set-auto-sync

```terminal
>tendril vault set-auto-sync true
>tendril vault set-auto-sync false --vault <vault-id>
```

Habilita o deshabilita la sincronización automática para un vault. Acepta `true`, `false`, `1`, `0`, `yes`, o `no`.

## Catálogo y Compartición de proyectos

#### catalog

```terminal
>tendril vault catalog
>tendril vault catalog <vault-id> --json
```

Lista todos los proyectos y el recuento de recursos (repositorios, habilidades personalizadas, servidores de [Model Context Protocol (MCP)](https://modelcontextprotocol.io), memorias de promptware y verificaciones) publicados en el catálogo del vault.

#### import

```terminal
>tendril vault import MyProject
>tendril vault import MyProject --target-name LocalProject --merge
>tendril vault import MyProject --repo api=~/code/api --repo web=~/code/web
```

Importa una definición de proyecto desde el catálogo del vault a la configuración local de Tendril.

| Opción                 | Descripción                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `--target-name <name>` | Nombre de proyecto local personalizado para registrar en vez del nombre del catálogo                  |
| `--vault <vault-id>`   | ID o nombre del vault desde el que importar (por defecto el vault activo)                             |
| `--repo <name=path>`   | Asigna un identificador de repositorio del vault a una ruta del sistema de archivos local (repetible) |
| `--no-permissions`     | Omite la importación de reglas de seguridad y permisos de ejecución                                   |
| `--merge`              | Combina los ajustes en un proyecto local existente en lugar de reemplazarlo                           |

#### push

```terminal
>tendril vault push MyProject
>tendril vault push ProjectA ProjectB --version "1.2.0" --changelog "Added new skills and verifications"
>tendril vault push MyProject --reviewer alice,bob --title "feat(vault): update MyProject"
```

Recopila la configuración del proyecto, habilidades personalizadas, configuraciones de [Model Context Protocol (MCP)](https://modelcontextprotocol.io), memorias de promptware y verificaciones, las envía a una rama de características y abre una [Pull Request de GitHub](https://docs.github.com/en/pull-requests) contra el repositorio del vault.

| Opción                | Descripción                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `--vault <vault-id>`  | Identificador del vault de destino                                                                             |
| `--version <version>` | Cadena de versión personalizada (por defecto la marca de tiempo UTC)                                           |
| `--changelog <text>`  | Notas del registro de cambios incluidas en la descripción de la pull request                                   |
| `--title <title>`     | Título personalizado para la pull request generada                                                             |
| `--body <body>`       | Descripción personalizada del cuerpo de la pull request                                                        |
| `--reviewer <names>`  | Nombre(s) de usuario de [GitHub](https://github.com) a asignar como revisores (repetible o separado por comas) |

#### delete

```terminal
>tendril vault delete OldProject
>tendril vault delete OldProject --vault <vault-id> -y
```

Elimina un proyecto del repositorio del vault y crea una [Pull Request de GitHub](https://docs.github.com/en/pull-requests) para aplicar la eliminación. Pase `-y` o `--yes` para omitir la confirmación.

## Ejemplos

**Conectar y sincronizar un vault de equipo:**

```terminal
># Descubrir vaults de equipo accesibles en GitHub
>tendril vault discover

># Conectar repositorio de vault
>tendril vault connect https://github.com/my-org/shared-vault.git

># Descargar actualizaciones
>tendril vault sync
```

**Importar un proyecto desde el catálogo:**

```terminal
># Inspeccionar proyectos disponibles en el catálogo
>tendril vault catalog

># Importar con rutas locales personalizadas de repositorio
>tendril vault import BackendService --repo backend=~/Projects/backend
```

**Publicar actualizaciones de proyectos mediante pull request:**

```terminal
># Enviar cambios y abrir una pull request con revisores asignados
>tendril vault push BackendService --changelog "Added Playwright E2E verification" --reviewer alice,bob
```
