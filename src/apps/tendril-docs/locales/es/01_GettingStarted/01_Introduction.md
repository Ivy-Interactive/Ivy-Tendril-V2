---
title: Bienvenido a Ivy Tendril
description: >-
  Tendril es una aplicación de escritorio de código abierto y local-first que actúa como sistema operativo para el desarrollo de software impulsado por IA, orquestando agentes de programación como Claude Code, Codex, Copilot, Gemini, OpenCode, Antigravity, Cursor y Apple Foundation Models a través de un ciclo de vida estructurado desde la idea hasta el pull request integrado.
icon: Rocket
searchHints:
  - visión general
  - qué es tendril
  - orquestación de agentes
  - arquitectura
  - tauri
  - daemon
---

# Bienvenido a Ivy Tendril

[![Ivy Tendril en dos minutos: ver en YouTube](../assets/yt-thumbnail-in-two-minutes-2.png)](https://youtu.be/_KVG1NnAj-8)

## El concepto

En Tendril, el trabajo se organiza en [**planes**](../02_Concepts/01_Plans.md) — unidades de trabajo estructuradas y revisables.
En lugar de una caja negra opaca que genera código sin inspeccionar, Tendril guía tu plan a través de un
[ciclo de vida](../02_Concepts/03_Lifecycle.md) definido mediante [**promptwares**](../02_Concepts/02_Promptwares.md):
agentes de flujo de trabajo aislados y con un propósito específico, especializados en una única fase. Ya sea redactando el plan,
implementando cambios en árboles de trabajo (worktrees) paralelos, ejecutando filtros de verificación o abriendo pull requests, tú conservas
una visibilidad total. Tendril no se limita a autocompletar líneas en tu editor; orquesta todo tu flujo de desarrollo
autónomo.

## Características clave

- **Árboles de trabajo paralelos (Parallel worktrees)** — cada agente opera en un [Git worktree](https://git-scm.com/docs/git-worktree) aislado,
  lo que permite ejecutar múltiples planes de forma simultánea sin contaminación entre ramas ni colisiones en el árbol de trabajo.
- **Túneles para trabajo remoto y móvil** — expón de manera segura el daemon local a través de
  [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
  para inspeccionar el progreso y orientar a los agentes en ejecución desde tu teléfono o un navegador remoto.
- **Entrada de voz y contenido enriquecido** — dicta requisitos con la transcripción integrada de
  [OpenAI Whisper](https://github.com/openai/whisper), o arrastra registros de terminal, especificaciones en Markdown y archivos de diseño como contexto.
- **Anotaciones en planes** — añade notas directamente sobre el borrador de un plan; Tendril envía tus apuntes a
  [UpdatePlan](../02_Concepts/02_Promptwares.md) para revisar y actualizar la especificación.
- **Revisiones de código con filtros de verificación** — inspecciona diffs de Git, revisa resultados de pruebas automatizadas (`Cargo`,
  `pnpm`, linters, formateo) y aprueba únicamente los cambios verificados.
- **Ingesta desde GitHub y bandeja de entrada** — convierte incidencias de [GitHub](https://github.com) e informes de error de
  [Jam.dev](https://jam.dev) en planes de forma automática mediante webhooks.

## Arquitectura

Tendril se compone de tres elementos principales que se ejecutan localmente en tu equipo:

- Una **aplicación de escritorio** construida con [Tauri 2](https://tauri.app) — un contenedor nativo de alto rendimiento
  que aloja una interfaz en [React](https://react.dev).
- Un **daemon de servidor** escrito en [Rust](https://www.rust-lang.org) (`tendril run` / `tendril serve`),
  que expone una API REST y WebSocket. La aplicación de escritorio inicia y supervisa el daemon en segundo plano
  de forma automática.
- Una **CLI** (`tendril`) que se conecta al mismo daemon y comparte el mismo almacén de datos. Todo lo que
  se puede controlar desde la aplicación de escritorio se puede ejecutar mediante la línea de comandos.

El estado se mantiene íntegramente local:

- Una base de datos local [SQLite](https://www.sqlite.org) en `$TENDRIL_HOME/tendril.db` registra trabajos, costes y
  telemetría.
- Almacenamiento directo en el sistema de archivos en `$TENDRIL_HOME/Plans/` que guarda archivos de planes, revisiones, anotaciones, registros e
  informes de verificación como documentos YAML y Markdown transparentes.

> [!NOTE]
> `$TENDRIL_HOME` se establece por defecto en `~/.tendril`. Consulta [Instalación](02_Installation.md) para configurar una ruta personalizada.

Tu código fuente nunca sale de tu equipo local. El único tráfico de red saliente corresponde a las peticiones directas a la API del agente de
programación configurado (por ejemplo, a Anthropic, OpenAI o Google) y a los túneles opcionales de Cloudflare
que inicies explícitamente.

Los agentes de programación admitidos incluyen:

- [Claude Code](https://code.claude.com/docs) (`claude`)
- [OpenAI Codex](https://openai.com) (`codex`)
- [GitHub Copilot](https://github.com/features/copilot) (`copilot`)
- [Google Gemini](https://ai.google.dev) (`gemini`)
- [OpenCode](https://opencode.ai) (`opencode`)
- Antigravity (`antigravity` / `agy`)
- [Cursor](https://www.cursor.com) (`cursor`)
- Apple Foundation Models (`apple` mediante `fm` en el dispositivo)

## ¿Por qué Tendril?

En [Ivy Interactive](https://ivy.app) probamos múltiples arquitecturas multiagente para la programación autónoma.
Aunque los agentes de CLI individuales eran potentes, gestionar una docena de pestañas de terminal y revisar diffs
no rastreados se volvió inviable rápidamente.

Tendril aporta estructura a la ingeniería agéntica. A través de nuestra arquitectura de [promptware](../02_Concepts/02_Promptwares.md),
los agentes de flujo de trabajo acumulan memoria específica del proyecto entre ejecuciones, aprendiendo los modismos de la base de código y
evitando fallos repetidos. Al centrar todo el flujo de trabajo en torno a [planes](../02_Concepts/01_Plans.md) duraderos,
los desarrolladores humanos conservan el control de revisión mientras los agentes autónomos realizan
el trabajo pesado de implementación.

> [!TIP]
> Nos encanta recibir comentarios. Informa sobre problemas y sugiere nuevas funcionalidades en el
> [repositorio de GitHub](https://github.com/Ivy-Interactive/Ivy-Tendril-V2). Para soporte o debate, únete a nuestra
> comunidad en [Discord](https://discord.gg/FHgxkDga3y).

## Próximos pasos

- [Instalación](02_Installation.md) — compila e instala la aplicación de escritorio y la CLI.
- [Conceptos](../02_Concepts/_Index.md) — profundiza en planes, promptwares y el ciclo de vida de los trabajos.
