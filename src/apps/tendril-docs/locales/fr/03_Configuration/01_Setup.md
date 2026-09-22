---
title: Configuration et paramètres
description: Configurez Tendril dans l'interface Paramètres de l'application ou en modifiant TENDRIL_HOME/config.yaml (projets, agents, niveaux, vérifications, préférences).
icon: Construction
searchHints:
  - config
  - yaml
  - configuration
  - paramètres
  - projets
  - gui
  - déploiement
  - docker
  - secrets
  - BasicAuth
  - mot de passe
  - hébergé
---

# Configuration et paramètres

## Paramètres intégrés

Tendril comprend une application Paramètres dédiée pour configurer visuellement l'environnement sans modifier manuellement [YAML](https://yaml.org). La barre latérale des paramètres propose les sections suivantes :

- **Coding Agent** — Choisissez le runtime principal de l'agent de codage ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), Antigravity, [OpenCode](../06_CodingAgents/04_OpenCode.md), Cursor, Apple ou des proxys personnalisés compatibles OpenAI), configurez les clés d'API des fournisseurs et les URL de base personnalisées, personnalisez les profils d'agents et les niveaux de raisonnement, testez la connectivité des agents et parcourez les spécifications des modèles via le Catalogue de modèles. Pour l'installation et la configuration des agents, consultez [Agents de codage](../06_CodingAgents/_Index.md).
- **Plans** — Modifiez le modèle de plan Markdown par défaut (`planTemplate`) utilisé chaque fois qu'un nouveau plan est créé dans [Plans](../04_Apps/03_Plans.md).
- **Apparence** — Sélectionnez le mode de thème (**Clair**, **Sombre** ou **Système**), faites votre choix parmi les thèmes prédéfinis intégrés avec aperçu des pastilles, configurez l'état par défaut de la barre latérale (développée ou réduite) et choisissez la cible du bouton de chat (**Vue de chat** ou **Terminal**).
- **Projets** — Gérez les projets enregistrés, configurez les dépôts par projet, les vérifications, les ports, les variables d'environnement, les compétences personnalisées (skills), les serveurs [MCP](../09_Advanced/03_MCP.md) et accédez à la Zone de danger. Consultez [Configuration de projets](02_Projects.md).
- **Team Vault** _(Bêta)_ — Synchronisez les projets, les compétences personnalisées, les serveurs MCP et les règles de sécurité entre les membres de l'équipe via un dépôt [Git](https://git-scm.com) partagé.
- **Agents de flux de travail** — Configurez les profils d'agents [Promptware](../02_Concepts/02_Promptwares.md) et les autorisations granulaires des outils (`allowedTools`, `deniedTools`) sur les flux de travail standard (`CreatePlan`, `ExecutePlan`, `UpdatePlan`, etc.) ou de manière globale en utilisant la clé `_default`.
- **Niveaux** — Définissez des niveaux de complexité (tels que L1, L2, L3) avec des poids d'exécution relatifs, des descriptions et des couleurs de badges personnalisées.
- **Notifications** — Activez ou désactivez les notifications système sur le bureau pour la réussite et l'échec des jobs.
- **Sécurité et tunnels** — Configurez la protection par mot de passe des sessions web, démarrez ou arrêtez des tunnels [Cloudflare](https://www.cloudflare.com) à accès complet pour un accès à distance, et créez des tunnels de partage en lecture seule avec des jetons de capacité.
- **Avancé** — Définissez les délais d'expiration d'exécution (`jobTimeout`, `staleOutputTimeout`), configurez `maxConcurrentJobs`, activez ou désactivez l'accès aux fonctionnalités bêta et inspectez les **Diagnostics du démon** en direct (état de connexion, PID, ping de latence, chemin `$TENDRIL_HOME` et capacités signalées).
- **Newsletter** — Abonnez-vous aux mises à jour des produits Ivy & Tendril ainsi qu'aux notes de version.
- **Ouvrir config.yaml** — Lancez l'éditeur YAML brut intégré avec coloration syntaxique en direct et liaison directe aux plans.

## `config.yaml`

Les paramètres modifiés dans l'interface utilisateur sont enregistrés immédiatement dans `$TENDRIL_HOME/config.yaml` (`~/.tendril/config.yaml` par défaut). Vous pouvez également modifier ce fichier directement ou spécifier un chemin personnalisé à l'aide de la variable d'environnement `TENDRIL_CONFIG`.

> [!NOTE]
> Le fichier de configuration doit toujours être nommé `config.yaml`. Le démon Tendril recharge automatiquement les modifications de configuration lorsqu'elles sont mises à jour sur le disque.

### Exemple

```yaml
codingAgent: claude
maxConcurrentJobs: 5
jobTimeout: 45
staleOutputTimeout: 10
theme: default
themeMode: system
chatMode: chat
desktopNotifications: true

projects:
  - name: Global Engine
    color: Emerald
    repos:
      - path: ~/repos/global-engine
    verifications:
      - name: Build
        required: true
      - name: Test
        required: true
      - name: CheckResult
        required: true

auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..." # Managed via Settings
  hashSecret: "base64-secret-pepper"

api:
  apiKey: "your-api-secret-key"
```

### Champs courants

| Champ                  | Type          | Valeur par défaut | Rôle                                                                                                            |
| ---------------------- | ------------- | ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `codingAgent`          | string        | `"claude"`        | Exécutable de l'agent de codage par défaut. Voir [Agents de codage](../06_CodingAgents/_Index.md).              |
| `maxConcurrentJobs`    | integer       | `20`              | Nombre maximal de [Jobs](../04_Apps/04_Jobs.md) (worktrees) d'exécution d'agents simultanés.                    |
| `jobTimeout`           | integer (min) | `30`              | Délai d'expiration de l'exécution en minutes avant l'annulation d'un job actif.                                 |
| `staleOutputTimeout`   | integer (min) | `10`              | Délai d'expiration en minutes si un processus d'agent ne produit aucune sortie stdout/stderr.                   |
| `daemonRequestTimeout` | integer (sec) | `30`              | Délai d'attente des requêtes clientes en secondes lors de la communication avec le démon local.                 |
| `planTemplate`         | string        | `""`              | Modèle Markdown utilisé lors de la création de nouveaux plans dans [Plans](../04_Apps/03_Plans.md).             |
| `theme`                | string        | `"default"`       | Identifiant du thème prédéfini (ex. `default`, `dracula`).                                                      |
| `themeMode`            | string        | `"system"`        | Mode de thème : `light`, `dark` ou `system`.                                                                    |
| `chatMode`             | string        | `"chat"`          | Ce que le bouton Chat ouvre : `chat` (vue Chat) ou `terminal` (terminal de l'agent).                            |
| `desktopNotifications` | boolean       | `true`            | Indique si les notifications système du bureau sont activées pour les événements de jobs.                       |
| `projects`             | list          | `[]`              | Liste des projets enregistrés et de leurs configurations. Voir [Configuration de projets](02_Projects.md).      |
| `levels`               | list          | standard          | Niveaux de complexité et poids configurés pour les plans.                                                       |
| `auth`                 | object        | `null`            | Configuration de la protection par mot de passe de session avec [Argon2](https://en.wikipedia.org/wiki/Argon2). |
| `api.apiKey`           | string        | `null`            | Secret partagé protégeant les points de terminaison de l'API REST. Voir [API REST](../09_Advanced/02_REST.md).  |
| `telemetry`            | boolean       | `null`            | Participation à la télémétrie anonyme d'utilisation (`false` ou absent signifie désactivé).                     |

## Authentification et accès distant

### Protection de session (Interface Web)

Lorsque vous hébergez Tendril sur un serveur distant ou que vous l'exposez sur un réseau, activez la protection de session dans **Paramètres > Sécurité et tunnels** ou configurez vos identifiants via des variables d'environnement :

- `TENDRIL_AUTH_USERNAME` — Nom d'utilisateur de connexion (par défaut : `admin`).
- `TENDRIL_AUTH_PASSWORD` — Mot de passe en texte clair à hacher au démarrage.
- `TENDRIL_AUTH_HASH_SECRET` — Chaîne en base64 de 32 octets (`openssl rand -base64 32` via [OpenSSL](https://www.openssl.org)) utilisée comme secret de salage (pepper) [Argon2](https://en.wikipedia.org/wiki/Argon2).

Dans `config.yaml`, les mots de passe sont stockés sous forme de hachages Argon2 PHC sous le bloc `auth:` avec une limitation de débit facultative :

```yaml
auth:
  username: admin
  password: "$argon2id$v=19$m=65536,t=3,p=4$..."
  hashSecret: "base64-encoded-pepper"
  rateLimit:
    threshold: 3
    baseDelaySeconds: 1.0
    maxDelaySeconds: 60.0
```

### Tunnels Cloudflare

Tendril s'intègre aux tunnels [Cloudflare](https://www.cloudflare.com) (`cloudflared`) pour exposer l'application en toute sécurité sans ouvrir de ports entrants sur le pare-feu :

- **Tunnel à accès complet** : Publie l'intégralité du démon Tendril. Pour des raisons de sécurité, Tendril exige que la protection de session soit active avec un mot de passe configuré avant de démarrer un tunnel à accès complet.
- **Tunnel de partage** : Crée un tunnel en lecture seule protégé par des jetons de capacité, permettant de partager en toute sécurité le [Dashboard](../04_Apps/01_Dashboard.md) et la progression des plans avec les parties prenantes sans accorder d'accès en écriture.

### Protection de l'API REST

L'API REST utilise une authentification par jeton via le paramètre `api.apiKey` dans `config.yaml` ou la variable d'environnement `TENDRIL_API_KEY`. Lorsqu'elle est définie, les requêtes doivent fournir l'en-tête `X-Api-Key`. Voir [API REST](../09_Advanced/02_REST.md) et [Configuration du CLI](../09_Advanced/01_CLI/06_Config.md).

## Vérifications

Tendril est livré avec des définitions intégrées de barrières de vérification que les projets peuvent intégrer dans leurs pipelines :

| Vérification  | Description                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `Build`       | Exécute la commande de compilation du projet et vérifie qu'il n'y a aucune erreur de compilation. |
| `Format`      | Vérifie les règles de formatage du code ou formate les fichiers modifiés.                         |
| `Test`        | Exécute les tests unitaires ou d'intégration limités aux modifications du plan.                   |
| `Lint`        | Exécute l'analyse statique / linters et signale toute violation.                                  |
| `Screenshots` | Capture des captures d'écran de l'interface utilisateur dans le dossier d'artefacts du plan.      |
| `CheckResult` | Vérifie que l'implémentation finale correspond bien aux spécifications du plan.                   |

Des commandes de vérification personnalisées (telles que `cargo test`, `pnpm test` ou `pytest`) peuvent être définies globalement dans `config.yaml` ou directement dans la [Configuration de projets](02_Projects.md#verification-pipelines). Pour les commandes de vérification en CLI, voir [Vérification via le CLI](../09_Advanced/01_CLI/03_Verification.md).
