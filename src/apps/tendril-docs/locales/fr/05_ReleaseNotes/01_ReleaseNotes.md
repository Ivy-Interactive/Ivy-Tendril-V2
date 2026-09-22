---
title: Notes de version
description: Historique des versions, nouvelles fonctionnalités, améliorations et corrections de bugs pour chaque version de Tendril.
icon: ScrollText
searchHints:
  - notes de version
  - changelog
  - historique des versions
  - mises à jour
  - nouveautés
---

# Notes de version

## 2.0.0 (2026-09-21)

Tendril v2 est une réinvention architecturale majeure de la plateforme Tendril, réécrivant le démon et le moteur d'exécution central en [Rust](https://www.rust-lang.org), adoptant [Tauri v2](https://tauri.app) pour l'application de bureau, introduisant un frontend haute performance en [Vite+](https://viteplus.dev), et ajoutant une concurrence multi-agent native sur les worktrees, des interactions en terminal direct et des [fournisseurs de modèles](../08_ModelProviders/_Index.md) enrichis.

### Évolutions architecturales majeures

- **Démon Rust haute performance (`tendril-server` et `tendril-core`)** : Remplacement du backend hérité en .NET par un démon asynchrone en [Rust](https://www.rust-lang.org) propulsé par [Tokio](https://tokio.rs) et [Axum](https://github.com/tokio-rs/axum). Le nouveau démon assure un routage en moins d'une milliseconde, un pool de connexions [SQLite](https://www.sqlite.org) robuste avec des délais d'attente d'occupation (busy timeouts), des écritures atomiques dans les fichiers de configuration et un protocole d'élection de processus maître unique pour un IPC local sans surcharge.
- **Application de bureau Tauri v2** : Migration de l'environnement de bureau vers [Tauri v2](https://tauri.app), offrant une distribution de bureau compacte et économe en mémoire sur macOS, Linux et Windows. Tire parti des webviews système natives, de ponts IPC sécurisés, de décorations de fenêtres natives et d'une intégration dans la barre d'état système, éliminant les dépendances de frameworks d'exécution obsolètes.
- **Frontend Vite+ React** : Reconstruction intégrale de l'interface utilisateur de bureau avec [Vite+](https://viteplus.dev) et [React 19](https://react.dev). Partage des jetons de conception atomique et des composants de rendu avec `@ivy-interactive/components`, prenant en charge le rechargement à chaud instantané, des thèmes prédéfinis unifiés (Default, Dracula, Forest, Lovably) et des mises en page réactives multi-breakpoints.
- **Exécution parallèle sur worktrees** : Provisionnement automatisé de [git worktree](https://git-scm.com/docs/git-worktree) multi-dépôts pour l'exécution simultanée de [plans](../02_Concepts/01_Plans.md). Plusieurs [agents de codage](../06_CodingAgents/_Index.md) peuvent exécuter des plans distincts en parallèle sur des branches isolées sans verrouillage de l'index git, sans conflit de dépôts ni effets de bord liés au changement de branche. Comprend un service de nettoyage d'arrière-plan (`worktreeReaperInterval` et `worktreeReaperGrace`) pour purger automatiquement les worktrees inactifs ou orphelins.
- **Terminal en direct et chats interactifs** : Intégration de l'émulation de terminal [PTY](https://en.wikipedia.org/wiki/Pseudoterminal) propulsée par [Xterm.js](https://xtermjs.org) directement au sein de l'application. Les développeurs peuvent basculer entre le chat structuré et l'interaction directe en terminal (`chatMode: terminal` ou `chatMode: chat`), interagir avec les agents en cours d'exécution via stdin, inspecter l'exécution des outils en direct et conserver les prompts mis en file d'attente lors des changements de session.
- **Intégrations de modèles étendues et sidecars intégrés** :
  - **Sidecar OpenCode intégré** : Fournit le binaire CLI d'[OpenCode](https://opencode.ai) directement dans l'installateur de bureau (`binaries/opencode`), permettant l'exécution immédiate sans configuration de [l'agent OpenCode](../06_CodingAgents/04_OpenCode.md) et un accès direct à des centaines de modèles open-source et propriétaires sans nécessiter d'installation préalable de Node ou de la CLI.
  - **Apportez votre propre LLM (BYO LLM)** : Intégration et fiches de configuration de premier ordre pour [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) et le fournisseur souverain européen [Berget AI](../08_ModelProviders/01_Berget.md) (`https://api.berget.ai/v1`), avec normalisation automatique des URL de base et transmission des identifiants vers les variables des SDK d'OpenAI et d'Anthropic.
  - **Intégration d'Apple Foundation Models** : Prise en charge native des modèles locaux Apple sur l'appareil via `fm serve` sur macOS, exécutant les inférences localement sans frais d'API cloud et avec une confidentialité hors ligne totale.
  - **Enrichissement dynamique du catalogue de modèles** : Découverte dynamique des catalogues depuis [models.dev](https://models.dev) avec mise en cache hors ligne dans [SQLite](https://www.sqlite.org), détection de l'obsolescence et points de terminaison de synchronisation manuelle (`POST /api/models/refresh`).
  - **Profils de modèles par paliers** : Niveaux de profils déclaratifs (`deep`, `balanced`, `quick`) sur tous les [agents de codage](../06_CodingAgents/_Index.md) pris en charge ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) et Apple), incluant des sélecteurs configurables d'effort de raisonnement (`low`, `medium`, `high`, `max`).

### Fonctionnalités

- **Terminal PTY intégré pour les actions de revue et les agents** : Exécutez des actions de revue et des sessions d'agents interactives dans des onglets de terminal complets compatibles ANSI avec suivi en temps réel de l'arborescence des processus.
- **Gestion des git worktrees multi-dépôts** : Espaces de travail isolés structurés sous `Worktrees/<owner>/<repo>` avec suivi des branches, détection de fork de la branche de base amont et protection sécurisée des commits non poussés.
- **Synchronisation centralisée avec Team Vault** : Connectez, importez et poussez des configurations de projet, des [serveurs MCP](../09_Advanced/03_MCP.md) personnalisés et des [skills d'agent](../06_CodingAgents/00_Skills.md) vers des coffres distants Git via [Team Vault](../09_Advanced/01_CLI/07_Vault.md) avec assainissement automatique des identifiants.
- **Tunnels rapides Cloudflare (Quick Tunnels)** : Partagez des revues de plans en lecture seule et le statut de vérification en direct via des tunnels sécurisés [Cloudflare](https://www.cloudflare.com) avec codes QR, protection de session par mot de passe chiffré en [Argon2](https://en.wikipedia.org/wiki/Argon2) et profils anonymes de relecteur.
- **Éditeur de configuration intégré** : Éditeur avec coloration syntaxique complète dans l'application pour `config.yaml`, avec détection en temps réel des conflits, crochets de rechargement et invites guidées par assistant (voir [Configuration et paramètres](../03_Configuration/01_Setup.md)).

### Améliorations

- **Exécutions de la CLI en moins d'une milliseconde** : Réécriture de la CLI `tendril` en Rust (`src/crates/tendril-cli`), permettant un lancement quasi instantané des commandes et un proxying transparent vers le démon (voir [Aperçu de la CLI](../09_Advanced/01_CLI/00_Overview.md)).
- **Livre de comptes des jetons et des coûts** : Fiches de décomposition des jetons et suivi des coûts par tâche en temps réel calibrés sur les principaux modèles, avec tarification de secours automatique pour les points de terminaison personnalisés.
- **Résolveurs de vérification automatisés** : Moteur d'exécution de vérification structuré exécutant les suites de contrôle du projet (build, test, format, lint) avec diffusion en direct de la sortie et diagnostics automatiques des défaillances (voir [Contrôles de vérification](../09_Advanced/01_CLI/03_Verification.md)).
- **Moteur de rendu Markdown unifié** : Moteur de rendu markdown partagé pour les plans, les notes et la documentation, prenant en charge les tableaux GFM, les blocs de code colorés, les diagrammes [Mermaid](https://github.com/mermaid-js/mermaid) et les commentaires diff en ligne ancrés aux caractères dans [l'application Review](../04_Apps/02_Review.md).

## 1.2.0 (2026-09-01)

### Fonctionnalités

- **Refonte du shell de l'application (Figma)** : Disposition modernisée du shell de bureau avec sections de navigation réductibles, onglets de session persistants et indicateurs intégrés du statut du projet (`#2173`).
- **Refonte du tableau de bord Tendril** : Création du nouveau composant React `TendrilDashboard` avec compteurs d'état en direct, tendances d'activité, suivi des tâches actives et affichage de code QR pour Cloudflare Quick Tunnel (`#2201`).
- **Unification de Drafts vers Plans** : Renommage de l'application, des services et des modèles de Drafts en "Plans" dans l'ensemble du code source, instaurant un cycle de vie homogène de la prise en charge de l'issue jusqu'à l'exécution vérifiée (`#2258`).
- **Téléversements HTTP multipart pour les pièces jointes du chat** : Remplacement de la transmission en ligne en base64 par des téléversements HTTP multipart segmentés, évitant les limites de charge utile SignalR sur les images et fichiers volumineux (`#2255`, `#2224`).
- **Messages en file d'attente persistants dans le chat** : Les messages mis en attente persistent et restent visibles lors du basculement d'une session de chat à l'autre, permettant aux développeurs de placer des prompts en file pendant qu'un agent travaille (`#2253`).
- **Raccourci de recherche dans la page (Ctrl+F / Cmd+F)** : Ajout de la recherche intégrée dans les pages au sein des vues markdown et des plans sans perturber la mise en page (`#2254`).
- **Aperçu en direct des Review Actions** : Ajout de fonctionnalités d'aperçu et d'exécution des actions de revue directement dans les paramètres du projet (`#2225`).
- **Thème Lovably** : Ajout d'un thème moderne basé sur les jetons de conception et échelles de couleurs de Lovable (`#2256`).
- **Extension de CodeInput à espacement fixe** : Intégration de `CodeInput` avec mise en évidence de la syntaxe dans les commandes et conditions des Review Actions (`#2247`), les variables d'environnement MCP (`#2248`), les prompts de vérification (`#2249`) et le contenu markdown de Project Memory (`#2259`).
- **Garde-fous pour un chat sécurisé** : Interdiction des modifications directes et non vérifiées de la base de code lors des sessions de chat exploratoires, imposant la création formelle de plans pour tout changement (`#2221`).
- **Fusion de projet Team Vault en cas de conflit** : Ajout d'une résolution intelligente de fusion lors de l'importation de projets de coffre partageant des noms avec des projets locaux (`#2219`).

### Améliorations

- **Prompts enrichis de chat et de génération d'issues d'agents** : Fourniture du contexte complet du projet, des correspondances de dépôts et des métadonnées des pièces jointes aux prompts initiaux de l'agent et à la création d'issues GitHub (`#2226`).
- **Indicateurs de mode de thème dans les paramètres d'apparence** : Affichage clair des états de mode clair/sombre actifs dans les paramètres d'apparence (`#2213`).
- **Composant ContentInput adapté au thème** : Adaptation dynamique des barres de saisie, boutons et bordures aux différents thèmes prédéfinis (`#2241`).
- **Simplification du tableau des Review Actions** : Optimisation du tableau de configuration des Review Actions dans les paramètres du projet pour une meilleure lisibilité (`#2240`).
- **Compilations sources dans les conteneurs de simulation (staging)** : Configuration des images Docker de simulation pour compiler directement depuis la source afin de tester fidèlement les branches de prévisualisation de PR (`#2229`).
- **Ajustements de mise en page et d'espacement de la barre latérale** : Espacement affiné des badges de validation et présentation des sessions en cours de génération dans la barre latérale du chat (`#2220`, `#2223`).
- **Boîte de dialogue native de suppression de session** : Remplacement de la boîte modale React par un composant natif `DeleteSessionDialog` pour la suppression des sessions (`#2222`).

### Corrections de bugs

- **Visibilité des tâches et réhydratation de la file d'attente** : Correction des cartes de tâches manquantes et rétablissement correct des états des tâches en attente après redémarrage de l'application (`#2243`).
- **Nettoyage des tâches bloquées fantômes** : Suppression des tâches bloquées orphelines ou remplacées qui stagnaient dans le stockage SQLite et dans les vues Output (`#2250`).
- **Délais d'expiration du chat de l'agent Antigravity** : Configuration des sessions de l'agent Antigravity pour respecter les délais globaux configurés plutôt que d'expirer prématurément (`#2218`).
- **Cible d'édition de vérification dans les paramètres du projet** : Correction de la boîte de dialogue de vérification qui ciblait la mauvaise entrée lors des modifications (`#2252`).
- **Débordement des blocs de code Markdown** : Prévention du débordement horizontal des extraits de code larges hors des conteneurs de plans parents (`#2214`).
- **Contraste des thèmes sombres Dracula et Forest** : Résolution des problèmes de visibilité au survol du texte et des icônes sur les éléments de la barre latérale, icônes de paramètres et onglets (`#2210`, `#2211`, `#2212`, `#2239`, `#2242`).
- **Suppression de la barre latérale dupliquée** : Élimination du rendu redondant de la barre latérale lors des transitions du shell (`#2244`).
- **Statut de brouillon terminé sur les issues résolues** : Résolution de l'état bloqué lors de la génération de plans pour des issues déjà résolues (`#2217`).
- **Nettoyage des modèles obsolètes** : Suppression des références au modèle déprécié Gemini 3.5 Flash au profit de Gemini 3.7 Flash (`#2215`).
- **Nettoyage des artefacts de test éphémères** : Nettoyage garanti des répertoires temporaires et des fichiers de travail de l'agent lors des exécutions de tests de bout en bout (`#2209`).

## 1.1.36 (2026-08-28)

### Fonctionnalités

- **Test de modèles et vérification d'authentification en direct lors de l'intégration** : L'intégration teste désormais activement les identifiants de points de terminaison et les modèles de profil (`Deep`, `Balanced`, `Quick`) avec des requêtes de test en direct avant d'autoriser la navigation, bloquant les noms de modèles invalides et clarifiant les messages d'erreur de proxy imbriqués.
- **Constantes de priorité de profils de modèles et énumérations de fournisseurs** : Remplacement des cascades ternaires par des tables de priorités déclaratives (`ModelProfilePriorities`) et des énumérations (`ModelProviderKind`, `ModelProfileKind`) pour une résolution cohérente des modèles par défaut et candidats.
- **Déploiement de secours de promptware à la demande** : Ajout d'un déploiement de secours automatique dans `PromptwareRunner` et `PromptwareRunCommand` pour extraire à la demande les promptwares manquants des ressources intégrées si `Program.md` est absent.

### Améliorations

- **Priorité du binaire Ivy Agent intégré** : Résolution prioritaire imposée des binaires `ivy-agent` intégrés ou gérés par Tendril (`~/.tendril/bin`), empêchant les exécutables système du `PATH` d'interférer avec l'agent.
- **Persistance de la saisie de modèles personnalisés dans les paramètres** : Correction des réinitialisations de nom de modèle personnalisé lors de l'appui sur Entrée ou du re-rendu dans `CodingAgentSetupView`.
- **Suppression de la corbeille** : Suppression de l'application et de la suite de commandes obsolètes Trash, remplaçant les marqueurs de corbeille par un rejet propre des doublons dans `CreatePlan`.

## 1.1.35 (2026-08-28)

### Fonctionnalités

- **Mode tunnel partagé et partage externe `[Bêta]`** : Partage sécurisé de liens de plans et brouillons à l'extérieur via des tunnels Cloudflare avec génération automatique d'URL et actions de copie, réservé aux utilisateurs bêta (`beta: true` dans les paramètres ou `TENDRIL_BETA`).
- **Protection de session pour le mode partagé** : Ajout d'une protection de session par mot de passe avec hachage Argon2 dans Paramètres sous une section unifiée "Sécurité et tunnels".
- **Profils de relecteurs anonymes** : Génération de profils anonymes conviviaux avec avatars initialisés pour les relecteurs externes de plans partagés.
- **Commentaires en ligne sur les diffs de brouillons et plans** : Ajout de commentaires en temps réel sur les blocs de diff en mode Review (`DraftDiffCommentService`) avec une action dédiée "Request Changes" et des badges de décompte.
- **Annotations de sélection de texte dans les brouillons** : Ajout de surlignage de sélection et fenêtres contextuelles ancrées aux décalages de caractères dans `DraftMarkdown` (`DraftAnnotationService`).
- **Coffre de configuration d'équipe `[Bêta]`** : Synchronisation centralisée des configurations d'équipe via des dépôts Git (`VaultService`, accessible sous l'option bêta), permettant aux équipes de créer, connecter, importer et pousser des configurations de projet avec assainissement automatique des secrets (`VaultSecretSanitizer`).

### Améliorations

- **Provenance des tâches et enregistrement des profils** : Enregistrement des profils d'exécution par tâche et structuration des feuilles de coûts comme des faits avérés.
- **Isolation des fonctionnalités bêta** : Boutons de partage, commandes de tunnels et configurations de coffre proprement isolés derrière les indicateurs bêta dans l'interface et la couche de commandes.

### Corrections de bugs

- **Empaquetage pour bureau Windows** : Correction d'une défaillance d'empaquetage grâce à une extraction zip sans arborescence superflue pour `ivy-agent.exe` sur les builds Windows x64 et arm64.

## 1.1.34 (2026-08-25)

### Fonctionnalités

- **Terminal PTY intégré pour les Review Actions** : Les actions de revue s'exécutent désormais dans un onglet de terminal intégré réactif propulsé par Xterm (`ReviewActionApp`) plutôt que d'ouvrir des fenêtres de terminal externes.
- **CLI Ivy Agent intégrée** : Intégration directe de l'exécutable autonome `ivy-agent` dans l'installateur de Tendril, supprimant toute installation manuelle.
- **Apportez votre propre LLM (BYO LLM) et catalogues de modèles** : Ajout de catalogues de fournisseurs et sélecteurs de modèles pour les configurations BYO LLM et Ivy Proxy dans l'intégration et les paramètres, prenant en charge Gemini 3.7 Flash, les modèles Claude et les modèles de raisonnement OpenAI.
- **Sélection de l'effort de raisonnement du modèle** : Niveaux d'effort sélectionnables (low, medium, high) pour les modèles de raisonnement pris en charge dans la configuration des profils d'agents.
- **Serveurs MCP et skills d'agent personnalisés** : Importation de serveurs MCP et de skills personnalisées directement depuis des dépôts Git, URL distantes et chemins locaux, avec interface d'administration et validation.
- **Fiche détaillée des jetons et des coûts** : Fiches d'analyse de la consommation de jetons et des coûts accessibles directement depuis les cellules de coût dans le tableau Jobs.
- **Organisation multi-dépôts des worktrees** : Structuration des worktrees sous `Worktrees/<owner>/<repo>` pour prendre en charge les architectures complexes multi-dépôts.
- **Navigation au clavier et gestion des onglets** : Prise en charge des raccourcis `Cmd+W` / `Ctrl+W` pour fermer les onglets actifs et affinage des symboles de raccourci Commande (`⌘`) sur macOS.

### Améliorations

- **Optimisation des performances des brouillons et revues** : Réduction spectaculaire du temps de basculement de plan et de la surcharge liée aux changements d'onglets dans Review et Drafts.
- **Évolutivité de la DataTable des Jobs** : Rendu et synchronisation de DataTable optimisés pour gérer avec fluidité plus de 100 tâches actives et archivées sans ralentissement de l'interface.
- **File d'attente du chat et indicateurs d'état** : Refonte du panneau des messages en attente avec commandes en ligne et badges d'état de génération en temps réel dans la barre latérale.
- **Ancrage des annotations de brouillon** : Ancrage des fenêtres de sélection et surlignages de barre d'outils aux décalages de caractères dans DraftMarkdown pour éliminer tout glissement au défilement.
- **Affichage de la branche de base du worktree** : Affichage des points d'embranchement de la branche de base amont dans l'onglet Git de Review et suivi de branche dans l'aperçu des Pull Requests.
- **Suppression des alertes toast de bureau redondantes** : Suppression des alertes toast intégrées superflues lorsque les notifications natives du système d'exploitation sont déjà présentées.
- **Refonte de l'interface des paramètres** : Réorganisation des paramètres du projet avec pastilles de couleurs, cartes rétractables pour skills/MCP personnalisés et normalisation de la taille des boutons.

### Corrections de bugs

- **Protection des commits non poussés sur les worktrees** : Empêche le service de nettoyage de rendre orphelins ou de supprimer les commits non poussés lors des opérations d'arrière-plan.
- **Fixation de l'en-tête d'appel d'outil** : Maintien des titres d'appel d'outil en haut de la zone de visualisation pendant les diffusions de longue durée.
- **Fausses erreurs sur les outils réparés** : Empêche les tâches Antigravity d'échouer à tort lorsque l'agent se rétablit avec succès après une erreur d'outil initiale.
- **Insensibilité à la casse des URL de PR GitHub** : Prise en charge des URL de dépôt insensibles à la casse (`Https://`, `Git@`, etc.) lors de l'importation GitHub et des actions de PR.
- **Préservation des segments dans le polisseur de liens Markdown** : Correction du remplacement des liens de plans qui corrompait les segments imbriqués.
- **Stabilité de l'intégration** : Résolution des blocages lors de l'intégration lorsqu'une installation d'agent échoue ou que des binaires sont temporairement indisponibles.

## 1.1.19 (2026-07-28)

### Fonctionnalités

- **Prise en charge de Claude Opus 5** : Ajout du modèle `Claude Opus 5` (`claude-opus-5`) au catalogue Claude avec métadonnées de tarification mises à jour.
- **Annulation groupée de tâches** : Ajout des actions d'en-tête "Stop All Jobs" et "Stop All Queued" dans `JobsApp` (`IJobService.StopAllJobs` et `StopQueuedJobs`) pour la gestion par lot des tâches.
- **Épuration de la mémoire de promptware** : Commande CLI `promptware delete-memory` permettant aux promptwares de supprimer les fichiers de mémoire obsolètes.
- **Résolution des références de mémoire** : Résolution automatique des références de mémoire dans la commande CLI `read-memory` au lieu de lever une erreur lors de l'appel de notes référencées.
- **URL d'agent Ollama configurable** : Option d'URL de base configurable (`--url`) pour les points de terminaison d'agents Ollama locaux.
- **Capacité d'importation d'issues** : Extension de la limite d'importation de 100 à 1 000 issues avec avertissements de troncature en cas d'atteinte du seuil maximal.
- **Persistance de l'état des tâches en vol** : Maintien des tâches en cours dans la base SQLite afin que les mises à jour d'état résistent aux redémarrages du processus maître.
- **Configuration automatique du PATH de la CLI sur Windows** : Création automatique de scripts enveloppes `tendril.cmd` et enregistrement du répertoire dans le PATH utilisateur de Windows au démarrage de l'application et lors des déclencheurs Velopack.

### Améliorations

- **Regroupement des rafraîchissements automatiques par tunnel** : Regroupement des actualisations fréquentes de la boîte de réception et conditionnement des mises à jour de cellules de `JobsApp` aux changements réels de données, évitant les surcharges réseau via Cloudflare.
- **Optimisation des lectures séquentielles de l'agent** : Diminution de la surcharge liée au lancement de processus lors des lectures consécutives de fichiers par les agents.
- **Devise dans le graphique des coûts du tableau de bord** : Ajout du symbole de devise ($) aux barres du graphique des coûts.
- **Formatage du tableau des Jobs** : Simplification des liens et du formatage markdown dans la colonne prompt/titre pour une présentation plus lisible.
- **Sortie CLI dans les tubes et compatibilité JSON** : Rendu alternatif en texte ASCII pour les tableaux redirigés par tube et ajout du flag `--json` pour `tendril verification list`.
- **Redirection des outils .NET hérités** : Contrôles de diagnostic et redirection automatique pour acheminer les appels d'outils obsolètes `.NET` (`ivy-tendril`) vers la CLI Tendril installée.
- **Refonte de la documentation** : Révision complète de `README.md` selon la structure Orca avec des GIFs de démonstration actualisés.

### Corrections de bugs

- **Validation du nom de projet** : Validation stricte des noms de projets dans la CLI, les dialogues de configuration et l'intégration pour éviter les pannes.
- **Surcharge au lancement de la CLI** : Empêche le démarrage du serveur Tendril lors de l'exécution de `tendril --help`, `-h` ou d'arguments non reconnus.
- **Rapports d'erreurs 404 sur les statuts de tâche** : Tolérance accrue sur les points de terminaison `tendril job status` et `tendril job fail` au lieu de lever des erreurs 404 fatales.
- **Avertissement d'analyseur en double** : Suppression de la référence de paquet dupliquée `Ivy.Analyser` dans `Ivy.Tendril.csproj`, éliminant les avertissements NU1504, et mise à jour de `UpdateIvyPackages.ps1`.
- **Exécution shell dans PlatformHelper** : Définition explicite de `UseShellExecute` sur `false` pour les commandes `open` (macOS) et `xdg-open` (Linux) dans `PlatformHelper`.

## 1.1.16 (2026-07-24)

### Fonctionnalités

- **Intégration d'Ivy Agent** : Intégration de l'exécutable autonome Ivy Agent, avec installateur CDN en un clic dans Paramètres, configuration d'URL de proxy Ivy personnalisée et contrôle d'accès bêta (`TENDRIL_BETA` ou `IVY_BETA`).
- **Sélecteurs compacts sous forme de badges** : Remplacement des sélecteurs pleine largeur par des badges compacts déroulants dans la boîte de dialogue Create Plan (composant `BadgeSelect`).

### Améliorations

- **Diagnostics DNS des tunnels Cloudflare** : Messages détaillés au démarrage et diagnostics de connexion lors des pannes de tunnel `cloudflared`.
- **Nettoyage de la vue des paramètres** : Refactorisation des champs de saisie pour utiliser les constructeurs natifs C# `.Description(...)` pour une cohérence visuelle accrue.

### Corrections de bugs

- **Superposition du dialogue Add Project** : Le bouton "New Project" dans Create Plan ouvre désormais directement le dialogue d'ajout par-dessus sans changer de vue.
- **Analyse de l'URL du tunnel** : Correction de l'extraction d'URL de tunnel cloudflared en ignorant les mentions du domaine interne `api.trycloudflare.com`.

## 1.1.14 (2026-07-21)

### Fonctionnalités

- **Documentation des mentions légales tierces** : Ajout de `THIRD_PARTY_NOTICES.md` répertoriant les licences des dépendances tierces incluses.

### Améliorations

- **État optimiste dans ContentInput** : Mises à jour optimistes du texte local dans `ContentInput`, différant les mises à jour d'arrière-plan pendant la frappe pour éviter d'écraser la saisie.

### Corrections de bugs

- **Téléchargeur Cloudflared** : Résolution d'un plantage lors de l'installation et du téléchargement automatique du binaire `cloudflared`.
- **Analyse des erreurs Codex** : Correction de l'analyse des défaillances de l'agent Codex et validation de son catalogue de modèles.
- **Disposition des paramètres de tunnel** : Correction de fautes de frappe et d'alignement dans l'écran de configuration du tunnel.

## 1.1.13 (2026-07-20)

### Fonctionnalités

- **Implémentation groupée de recommandations** : Sélection et implémentation par lot de multiples recommandations directement dans l'application Review.
- **Enquêter et échanger avec l'agent** : Ajout de boutons d'action "Investigate with Agent" et "Discuss with Agent" dans Drafts, Review et la fiche de débogage.
- **Commande CLI d'ajout de worktree à un plan** : Commande `tendril plan add-worktree` pour la gestion symétrique des worktrees.
- **Relance des tâches RetryPlan terminées** : Possibilité de relancer des tâches `RetryPlan` achevées directement depuis la liste des tâches.

### Améliorations

- **Rechargement automatique de configuration** : Rechargement automatique de la configuration lors de modifications externes de fichiers.
- **Résumé et onglets de Review** : Présentation du résumé de Review en DraftMarkdown avec carte de vérifications épinglée et extraction des onglets dans des vues dédiées.
- **Regroupement des journaux de tâches** : Centralisation de tous les journaux d'exécution dans un répertoire unifié `<TendrilHome>/Jobs/`.
- **Mise en valeur des lignes et barres latérales** : Styles de sélection enrichis avec arrière-plan coloré pour les éléments de menu et tableaux de données.
- **Mise à jour du framework de bureau** : Dépendances Ivy Framework portées en version 1.3.8 et détails de la boîte À propos configurés.

### Corrections de bugs

- **Préservation de l'état lors de la suppression de tâches** : Préservation du statut du plan achevé lors de la suppression de tâches terminées.
- **Rendu Markdown et formules mathématiques** : Correction des symboles dollar interprétés à tort comme du code LaTeX et ajustement du style de code en ligne dans DraftMarkdown.
- **Fuite de sémaphore d'emplacement de tâche** : Correction d'une fuite lors d'échecs de lancement non gérés.
- **Blocage en état de démarrage** : Correction des tâches bloquées indéfiniment en cours de lancement par l'ajout d'une gestion d'erreurs adaptée.
- **Synchronisation des commits de worktree** : Synchronisation fiable des commits issus de l'ensemble des worktrees de plans.

## 1.1.12 (2026-07-03)

### Améliorations

- **Résolveurs de vérification Dotnet** — Mise à jour des prompts de vérification `DotnetBuild`, `DotnetFormat`, `DotnetTest` et `FrameworkDotnetBuild` pour cibler explicitement le fichier solution. Précisions de périmètre pour les configurations multi-dépôts, assurant la fiabilité des tests et builds.
- **Disposition de l'interface Pull Request** — Réagencement des colonnes de l'application PullRequest pour afficher Plan en premier et Repository en dernier, et réduction de la largeur des colonnes Cost et Tokens à 80px pour un tableau plus aéré.

### Corrections de bugs

- **Remplacement concurrent de corps dans CreatePr** — Correction d'une condition de course où des tâches concurrentes `CreatePr` pouvaient échanger ou écraser les descriptions de pull requests en raison de fichiers temporaires non uniques. Utilisation de `mktemp` et ajout de tests de régression.
- **Concurrence sur l'analyseur d'événements partagé** — Isolement des analyseurs par session afin d'éliminer les conflits d'analyse d'événements partagés.

## 1.1.11 (2026-07-03)

### Corrections de bugs

- **Installateur et démarrage macOS** — Correction d'un problème critique où l'installateur macOS (.pkg) s'achevait sans erreur mais ne parvenait pas à installer ou lancer l'application en raison de liens symboliques rompus et de signatures de code compromises lors du réempaquetage. Remplacement de `pkgutil --expand-full` par `pkgutil --expand`, correction du répertoire cible vers `1.pkg/Scripts/postinstall` et correction d'une erreur de chemin dans le script de confiance de certificat localhost.

## 1.1.10 (2026-07-03)

### Corrections de bugs

- **Notarisation de l'installateur macOS** — Correction de la notarisation par soumission et agrafage (staple) adéquats du paquet d'installation réempaqueté.

## 1.1.9 (2026-07-03)

### Fonctionnalités

- **Entrée de fichiers pour promptwares** — Prise en charge des entrées basées sur des fichiers pour les commandes d'écriture des promptwares, leur permettant d'ingérer des fichiers locaux pendant l'exécution.
- **CLI de récupération de révision de plan** — Nouvelle commande CLI `plan get-revision` pour consulter et inspecter les révisions passées d'un plan.
- **Politique de modifications non suivies pour SyncRepo** — Politiques configurables (Stash/Commit/PullRequest) pour l'exécution de SyncRepo.
- **Validation officielle de la CLI Antigravity** — Passage des intégrations et vérifications de la CLI Antigravity en statut pleinement stable.

### Améliorations

- **Rapports de bugs universels** — Activation du signalement de bugs sous tous les agents en normalisant les modèles cibles et en ajoutant les métadonnées de l'agent d'origine ; correction du signalement sur macOS en collectant récursivement les fichiers de plans et en ignorant préventivement les worktrees.
- **Solutions de repli CLI pour la vérification** — Les commandes `verification` listent automatiquement tous les scripts disponibles si le nom demandé n'est pas trouvé.
- **Styles du composant DraftMarkdown** — Synchronisation du style de DraftMarkdown avec les dernières mises à jour du système de conception principal.

## 1.1.8 (2026-07-03)

### Fonctionnalités

- **Mise à jour automatique de l'application de bureau** — Fonctionnalité et dialogue d'auto-mise à jour permettant à l'application de rechercher et d'installer automatiquement la dernière version.
- **Persistance du dossier Tools** — Conservation du répertoire `Tools/` lors des mises à niveau de promptware et structuration correcte des dossiers d'exécution.

### Améliorations

- **Raccourci dans l'application Drafts** — Ajout du raccourci clavier `Retour arrière` (Backspace) pour déclencher l'action Delete dans l'application Drafts (résolvant #1507).
- **Espacement de la mise en page adaptative** : Réalignement du bouton de lien vers l'issue dans l'en-tête réactif pour prévenir les chevauchements de texte.

## 1.1.7 (2026-07-02)

### Fonctionnalités

- **Génération de certificats HTTPS localhost** — Génération et inclusion automatique de certificats SSL/TLS sécurisés pour localhost sous macOS et Windows, activant immédiatement le protocole HTTPS en local.
- **Amélioration du dialogue Create Plan** — Raccourci direct "New Project" dans Create Plan pour une prise en main plus rapide.
- **Sélection de Claude Fable 5** — Ajout de `Claude Fable 5` parmi les options de modèles sélectionnables.
- **Intégration CLI et MCP pour la configuration** — Ajout de commandes directes `config get` et `config set` dans la CLI Tendril et les points de terminaison Model Context Protocol (MCP).
- **Expérience FieldToolsDemo** — Introduction de l'expérimentation `FieldToolsDemo` pour les tests de développement.

### Améliorations

- **Suppression optimiste de tâches** — Suppression optimiste des tâches en déléguant le nettoyage des worktrees à des threads d'arrière-plan pour une interface plus réactive.

### Corrections de bugs

- **Workflows et scripts CI** — Correction d'une erreur de syntaxe YAML dans le pipeline de publication, résolution de plantages de génération de certificats SSL en CI et correction d'une erreur de syntaxe dans le script de post-installation macOS.

## 1.1.6 (2026-07-02)

### Fonctionnalités

- **Signalement explicite d'erreurs** — Commande CLI `tendril job fail <job-id> --message` permettant aux promptwares de signaler directement les défaillances sans se reposer sur les codes de sortie et la sortie standard.
- **Rafraîchissement automatique d'Inbox** — Remplacement du sondage périodique dans Drafts, Review, Icebox, Recommendations et Trash par des abonnements aux modifications de statut de processus et du système de fichiers avec anti-rebond.
- **Consolidation du programme de mise à jour Velopack** — Harmonisation de la mise à jour de l'application de bureau sur Velopack, avec recherche de mises à jour dans les paramètres, persistance des alertes ignorées et suppression du projet obsolète `Ivy.Tendril.Updater`.
- **Composant UserQuestion** — Nouveau composant et visualiseur `UserQuestion` pour les requêtes interactives à l'utilisateur.
- **Guide d'intégration** — Ajout d'un guide d'intégration complet dans la documentation Premiers pas.
- **Améliorations de la création de plan** — Bouton de sélection de projet directement dans le dialogue Create Plan et renommage de `CustomPrDialog` en `CreatePrDialog`.

### Améliorations

- **Sécurité des chemins et shells sous Windows** — Remplacement des caractères non sécurisés (barres verticales et parenthèses) dans la configuration `stackHash` par `/` et `.ts`, et échappement adapté des arguments CLI Windows.
- **Accès réseau du bac à sable de l'agent** — Activation de l'accès réseau pour Codex via le paramètre `sandbox_workspace_write.network_access`, résolvant les erreurs de liaison de sockets PermissionError.
- **Prise en charge d'Ollama local dans OpenCode** — Contournement des vérifications d'authentification et détection automatique du binaire pour OpenCode avec Ollama local, et passage en exécution `--auto` pour éviter les blocages de terminal.
- **Gestion des liens Markdown** — Centralisation du nettoyage des liens de révisions de plans et contrôles de sécurité pour retirer les ancres de numéros de ligne des URL de fichiers.
- **Identifiant GitHub dans les rapports de bugs** — Champ optionnel d'identifiant GitHub dans le dialogue de signalement et dans la commande `report-bug`.
- **Affinage de l'interface** — Masquage du panneau de code QR de tunnel sur écrans mobiles/tablettes, intégration de l'indicateur de chargement dans le bloc d'alerte, correction de l'icône du bouton "Stop" et rétablissement des espacements dans les actions de revue.
- **Suppression des retours à la ligne forcés pour Gemini** — Déroulement automatique du texte pour supprimer les sauts de ligne rigides de Gemini et améliorer la lisibilité.
- **Style des éléments de touche clavier** — Ajout de règles graphiques pour les balises `<kbd>` dans le composant markdown.

### Corrections de bugs

- Correction des tâches bloquées indéfiniment en phase préliminaire en armant immédiatement les délais d'expiration et en exécutant les pré-vérifications de manière concurrente.
- Correction de la réinitialisation inopinée du défilement vers le haut sur l'écran Create Plan lors des changements d'onglets.
- Correction du calcul des coûts pour les exécutions ayant expiré en appliquant les tarifs catalogue lorsque le coût en ligne est nul ou absent.
- Correction des plans CreatePr restés dans Drafts lorsque les agents omettent la clôture en extrayant automatiquement l'URL de PR de la sortie finale.
- Correction de la prolifération de journaux de session au démarrage et du formatage des tirets cadratins dans les journaux d'élection de maître.
- Correction des erreurs d'écoute EPERM au démarrage en liant les serveurs de test à l'interface de bouclage.
- Correction de la réduction à une hauteur nulle de la sortie de l'agent Codex pendant l'exécution.
- Correction des anomalies de focus clavier et focus automatique activé à l'ouverture du dialogue New Plan.
- Désactivation par défaut de la fonctionnalité de tunnel non utilisée.

## 1.1.1 (2026-06-25)

### Fonctionnalités

- **Saisie vocale et enrichie de plans** — Le nouveau widget ContentInput apporte la transcription vocale et les pièces jointes au dialogue Create Plan ; téléversement par HTTP POST, stockage avec le plan et glisser-déposer pris en charge.
- **Chat avec l'Agent** — L'application bêta AgentApp permet d'échanger directement avec l'agent de codage via un PTY, avec un bouton "Chat with Agent" dans le dialogue New Plan et exposition de la CLI `tendril` via un shim.
- **Annotations de plans** — Annotez des brouillons dans DraftsApp pour orienter les mises à jour de plans.
- **Prise en charge mobile et tablette** — Tendril s'adapte aux résolutions mobiles, tablettes et ordinateurs de bureau avec en-têtes, fiches, sélecteurs et visualiseur de processus adaptatifs.
- **Widget DraftMarkdown** — Rendu des diagrammes Mermaid et Graphviz, blocs de mise en valeur, images cliquables et locales, et annotations textuelles en ligne.
- **Mises à jour automatiques Velopack** — L'application de bureau se met à jour automatiquement via Velopack avec protection contre les collisions de noms d'installateurs.
- **Carte thermique d'activité** — La vue Wallpaper présente une carte thermique d'activité sur 90 jours pour les pull requests complétées.
- **SyncRepo et contrôle de dépôt modifié** — Nouveau promptware SyncRepo complété par une vérification préliminaire de l'état du dépôt avant Execute et Create Plan.
- **Dépendances entre tâches** — Blocage de tâches avec `WaitForJobs`, défaillance en cascade, réévaluation périodique et action Force Start pour les tâches bloquées.
- **Relancer avec commentaires** — Relancez une tâche en transmettant des indications supplémentaires à l'agent.
- **Rétablir une révision** — Rétablissez une révision spécifique directement depuis l'onglet Details.
- **Nettoyeur de worktrees obsolètes** — Limite l'utilisation du disque en purgeant les anciens worktrees délaissés.
- **IPC CLI/serveur par HTTP** — Communication HTTP entre CLI et serveur avec élection de maître pour une coordination fiable sur une seule instance.
- **Environnements d'exécution intégrés** — Le SDK .NET 10 et PowerShell 7 sont inclus dans les installateurs et résolus dynamiquement à l'exécution.
- **Garde-fous de dépôts** — Les plans ne peuvent être exécutés ou fusionnés en dehors des dépôts associés au projet, et la branche par défaut est identifiée au lieu de supposer `main`.
- **Cadre de migration de plans** — Ajout de `schemaVersion` à `plan.yaml` avec gestionnaire de migration par fichier.
- **Variables d'environnement d'agents** — Paramétrez des variables d'environnement spécifiques à chaque agent dans la configuration Coding Agent.
- **Commande `tendril agent-instructions`** — Restitution des instructions destinées à l'agent depuis la CLI.

### Améliorations

- **Perfectionnement des tunnels** — Indication claire de l'état de connexion, code QR sur fond d'écran, ouverture dans le navigateur, détection de disponibilité réseau avant l'état connecté, nettoyage des processus orphelins de `cloudflared` et désactivation en un clic avec interface optimiste.
- **Les vérifications comme source unique de vérité** — `plan.yaml` devient la référence pour les vérifications, doté d'une fiche d'interface dédiée, d'une énumération d'états et du tri par glisser-déposer dans la boîte d'édition de projet.
- **Fiche de débogage de tâche** — Répertoire de travail, arguments CLI, boutons de copie d'identifiants Plan/Job, bouton Report Bug et apprentissages de promptware (écritures d'outils/mémoire) ; masquage des lignes vides et refus de permission.
- **Renommage des états de plan** — `Building → Creating` et `ReadyForReview → Review` pour une terminologie de cycle de vie plus limpide.
- **Consolidation de la CLI** — Canal de journalisation unique, transmission harmonisée des exceptions, statuts descriptifs des tâches et points de terminaison Web API/MCP pour une parité complète avec la CLI.
- **Recommandations simplifiées** — Retrait du champ Risk des recommandations dans toute l'interface et dans les invites.
- **Application autonome macOS** — Chargement fiable du PATH et de l'environnement depuis le shell de connexion, détection adéquate des paquets et création automatique du lien symbolique universel `tendril`.
- **Restructuration des widgets** — Regroupement des composants dans le projet unifié `Ivy.Tendril.Widgets` avec arborescences frontend dédiées.
- **Workflow de fusion automatique** — La CI fusionne automatiquement `main` dans `development` après chaque release.
- **Sécurité des dépendances** — Mise à niveau de `SQLitePCLRaw.lib.e_sqlite3` en version 3.50.3 et verrouillage des dépendances frontend (dompurify, vite-plus).

### Corrections de bugs

- Correction de l'analyse des arguments contenant des tirets dans `tendril plan create`.
- Élimination des erreurs SQLite "database is locked" grâce à une fabrique partagée de connexions et `busy_timeout`.
- Correction de la réversion inopportune des plans à l'état antérieur lors de tâches annulées, interrompues ou en échec.
- Correction de la fusion de PR qui s'appuyait sur une règle `prRule` obsolète plutôt que sur l'indicateur `PrMerge`.
- Correction des brouillons qui ne s'actualisaient pas après modification.
- Résolution des échecs intermittents de création de PR et messages d'erreur trompeurs.
- Correction de l'absence de marge intérieure gauche lors du rendu markdown dans Review et Drafts.
- Maintien fiable de l'ordre des vérifications dans le dialogue d'édition de projet.
- Calcul du coût des tâches appliqué à tous les statuts à partir des données en ligne.
- Élimination d'une perte d'écriture concurrente dans `plan.yaml` lors de l'acceptation d'une recommandation.
- Correction d'un plantage lors de la navigation vers Drafts/Review avec un plan invalide.
- Élimination d'une condition de course lors du déblocage de `WaitForJobs` et de la détection de doublons.
- Prévention des processus zombies résiduels laissés par IvyFrameworkVerification après l'exécution de tests.
- Correction des plantages d'analyse des métriques d'usage Copilot via une lecture défensive.
- Résolution d'un plantage Spectre.Console dû à des balises non échappées dans la sortie de la commande doctor.
- Correction d'un plantage au démarrage de l'intégration sous macOS et Windows lorsque `TENDRIL_HOME` est vide.
- Suppression de l'option Default dupliquée dans les listes déroulantes de modèles des profils d'agents.
- Rétablissement de l'icône manquante dans la barre des tâches Windows.
- Correction des autorisations ACL bloquant ExecutePlan sur le dossier du plan.
- Suppression des tâches SyncRepo dupliquées dans la file d'attente pour un même dépôt.
- Résolution du conflit de nom de ContentInput consécutif à l'ajout du composant propre au framework.
- Correction de l'erreur JavaScript `SyntaxError` sur les versions plus anciennes de WebKit par le ciblage d'es2020.

## 1.0.39 (2026-05-28)

### Fonctionnalités

- **Fournisseur d'agent Gemini** — Ajout de la CLI Gemini (`gemini`) comme agent de codage pris en charge, avec diagnostic de bon fonctionnement, authentification et suivi des coûts par session.
- **Prise en charge des tunnels** — Accès distant via les tunnels Cloudflare avec code QR dans Paramètres, détection de disponibilité du serveur et vérification de joignabilité.
- **Dialogue de test des agents** — Nouveau bouton Test Agent dans Paramètres effectuant automatiquement les vérifications d'installation, d'authentification et de modèles.
- **Sélection de modèle par profil** — Choix de modèles spécifiques pour chaque profil d'effort (deep/balanced/quick) dans les réglages de Coding Agent.
- **Catalogues de modèles par fournisseur** — Remplacement du fichier global `models.yaml` par des catalogues par fournisseur et ajout de la commande `tendril models`.
- **Commande `tendril update`** — Auto-mise à jour avec interface graphique Photino.
- **Injection de gabarits de plans** — Les gabarits de plans sont intégrés dans le firmware ; le modèle réellement utilisé est tracé par tâche.
- **Titres d'outils explicites** — Champ descriptif sur ToolCallWire pour un affichage plus clair de la sortie de l'agent.
- **Accès restreint aux fichiers pour l'agent** — Les agents bénéficient d'un accès en écriture à TENDRIL_HOME, aux plans et aux dossiers de promptware.
- **Option `--search` pour lister les plans** — Filtrage des plans par terme de recherche depuis la CLI.
- **AgentApp avec prompt système** — Application bêta de chat d'agent avec prompt système Tendril injecté.
- **Créer un plan depuis le fond d'écran** — Le bouton New Plan sur le fond d'écran ouvre directement le dialogue CreatePlanDialog.
- **Bouton Copier tous les détails** — Copie intégrale des détails de débogage dans le presse-papiers depuis la fiche Job Debug.
- **Composant de lettre d'information** — Composant partagé de newsletter avec gestion d'erreurs enrichie.

### Améliorations

- **Scission des paramètres** — Séparation des paramètres généraux en onglets Coding Agent, Plans et Appearance.
- **Renommage de PlansApp en DraftsApp** — Mise à jour concordante du badge et de la navigation latérale.
- **Mise en page des paramètres d'agents** — Disposition perfectionnée avec noms d'affichage et gestion des modèles par défaut pour tous les fournisseurs.
- **Affinage de la CLI** — Formatage propre de la console, exécution de `--help` sans lancer le serveur, message explicite pour les commandes non reconnues et présentation soignée du rapport doctor.
- **Affinage d'AgentOutputView** — Cartes d'outils sans coupure de ligne involontaire, titres épurés, espacement régulier et statut masqué une fois l'opération terminée.
- **Améliorations de la vue des processus** — Boutons de largeur identique, pulsation grise, jetons de couleur sémantiques pour le mode sombre et crochet dédoublonné.
- **Composant TendrilProcessView** — Intégration à la solution avec prise en charge du mode sombre via des jetons sémantiques.
- **Améliorations des scripts d'installation** — Vérification de l'exécution de git, ajout prioritaire de .NET 10 dans le PATH et scripts assainis.
- **Sécurité des dépendances** — Verrouillage des plages de versions sur des numéros stricts pour prévenir les attaques par substitution de paquets.
- **Validation de la branche de base** — Interdiction d'ajouter des projets pointant vers des branches de base invalides ou des dépôts locaux erronés.
- **Sortie brute de l'agent** — Écriture dans `.raw.jsonl` au lieu du format EventWire pour simplifier le débogage.
- **Améliorations pour Copilot** — Saisie du prompt par stdin pour contourner la longueur maximale de commande sous Windows, repli sur `gh copilot` lorsque le binaire dédié n'est pas présent dans le PATH et analyse du format JSON actualisé.
- **Composant CodeBlock** — Restitution de la sortie de l'agent et des résolutions avec CodeBlock plutôt qu'en Markdown brut.
- **Structuration des services** — Réorganisation des services en sous-répertoires et extraction des constantes d'état.

### Corrections de bugs

- Correction de l'inversion des compteurs de plans en cours d'exécution et de mise à jour dans la vue processus.
- Résolution de chemin lors de l'intégration lorsque le paramètre tendrilHome est vide.
- Résolution du blocage indéfini sur l'écran "Setting up agent" pendant l'intégration.
- Rend la migration 11 idempotente pour fiabiliser la mise à niveau de base de données de 10 vers 11.
- Correction des barres obliques inverses dans les fichiers .csproj et recherche de chemins Promptwares à l'intégration.
- Élimination des gels de processus Copilot grâce à un délai STDIN de 5 secondes.
- Ajout de l'appel manquant ResolveCommandShim dans PromptwareRunner.
- Correction du dépassement de limite de longueur de ligne de commande au lancement de Gemini.
- Correction des événements `item.updated` de Codex émettant UnknownEvent.
- Paramétrage correct des modèles par défaut pour les profils Copilot et Codex lors des nouvelles installations.
- Rectification de la clé du badge de barre latérale de "plans" vers "drafts" consécutivement au renommage.
- Suppression des en-têtes et styles en double dans le dialogue Add Project.
- Résolution d'un décalage d'index dans le dialogue d'édition après l'ajout d'un projet.
- Correction de la liste déroulante des modèles qui n'affichait pas l'option Default.
- Résolution des commandes PTY sous Windows avec l'extension .cmd.
- Prise en charge des valeurs nulles pour les modèles lors du changement d'agent.
- Élimination du préfixe "undefined:" dans les messages de statut de tâche.
- Résolution des blocages de l'intégration dus à des noms de projet dupliqués.
- Analyse en direct de la sortie brute de l'agent vers EventWire pendant l'intégration.
- Suppression d'une fenêtre superflue et rétablissement de l'icône de barre des tâches au démarrage sous Windows.
- Restitution correcte des résultats d'outils dans AgentOutputView.
- Analyse des résultats d'outils de Claude Code à partir des messages utilisateur.
- Correction de l'erreur 502 de cloudflared par la lecture de l'adresse réelle du serveur.
- Prise en compte de `model: default` dans OpenCode pour omettre l'argument --model.
- Correction des événements intermédiaires step_finish d'OpenCode dans la vue de sortie.

## 1.0.35 (2026-05-20)

### Fonctionnalités

- **Notifications toast natives du système** — Alertes sur le bureau pour la complétion des plans, les échecs et autres événements avec un onglet Notifications dédié dans Paramètres.
- **Badge dans la barre des tâches** — Compteur de tâches en cours affiché directement sur l'icône de la barre des tâches.
- **Assistant guidé d'ajout de projet** — Configuration de nouveaux projets sous forme d'assistant pas à pas, avec possibilité de passer outre pour les utilisateurs expérimentés.
- **Commande CLI de réorganisation de vérification** — Modification de l'ordre des vérifications via `tendril project move-verification`.
- **Refonte de l'intégration** — "Your First Project" devient un parcours en 3 étapes avec initialisation propre, retours en direct et proposition de newsletter à l'issue.
- **Commandes CRUD dans la CLI** — Opérations complètes sur les vérifications et projets depuis le terminal (`tendril project get`, `tendril verification add/remove/move`).
- **Synchronisation des commits de plans** — Synchronisation à la demande des commits de plans via le bouton Synchronize dans Review.
- **Interface CRUD pour ReviewAction** — Configuration des actions de revue directement dans Paramètres et l'intégration.
- **Commande `tendril reset`** — Réinitialisation de l'état de Tendril en ligne de commande.
- **Commande `tendril report-bug`** — Signalement d'anomalies avec recueil automatique du contexte système.
- **Commande `promptware read-memory`** — Consultation de la mémoire d'un promptware en ligne de commande.
- **Mode brouillon pour la création de PR** — Possibilité d'ouvrir des pull requests en tant que brouillons (drafts) GitHub.
- **Acceptation et refus de recommandations** — Traitement des recommandations directement dans Review, avec filtre sur les plans complétés.
- **Onglet Git : Tuile Worktrees** — Présentation des détails du dépôt parent et regroupement des commits par worktree.
- **Préservation des worktrees pour les plans en échec** — Maintien des répertoires de travail des plans échoués pour faciliter le diagnostic.
- **Fournisseur d'agent OpenCode** — Prise en charge d'OpenCode comme agent de codage.
- **Fournisseur d'agent Copilot CLI** — Prise en charge de la CLI GitHub Copilot comme agent de codage.
- **Argument CLI `--plans-dir`** — Redéfinition du répertoire de plans pour les tests de bout en bout et les déploiements spécifiques.
- **Composant TendrilProcessView** — Visualisation externe de l'exécution des processus de Tendril.

### Améliorations

- **Perfectionnement de l'onglet Git** — Icônes d'en-tête de section et d'état vide, arborescence hiérarchique avec code couleur pour les fichiers modifiés.
- **Stabilité de l'onglet Modifications** — Suppression du clignotement lors de la réévaluation périodique toutes les 30s, dépliage par défaut et largeur intégrale.
- **Épuration de l'onglet Review** — Masquage des sections vides Artefacts et Recommandations ; rendu typographique façon article.
- **Simplification des messages de commit** — Retrait du préfixe d'identifiant de plan dans les instructions pour un historique git plus sobre.
- **Amélioration de l'importation d'issues GitHub** — Ergonomie bonifiée pour l'importation depuis GitHub.
- **Dimensions de fenêtres** — Ajustement des dimensions initiales pour les écrans macOS Retina avec taille minimale garantie.
- **Améliorations de RetryPlan** — Ajout des correctifs au résumé existant, clarification de l'organisation multi-dépôts et journalisation directe sur disque.
- **Suppression de VerbosityService** — Remplacement par les niveaux standards ILogger pour simplifier la journalisation.
- **Découplage de ServiceRegistration** — Déplacement des enregistrements d'injection de dépendances vers un fichier dédié `ServiceRegistration.cs`.
- **Qualité du code d'intégration** — Helpers isolés, modèle AgentOnboardingInfo, constructeurs primaires et formulations plus soignées.
- **Autorisations d'outils de promptwares** — Permissions adaptées par défaut pour une exécution plus sûre des agents.
- **Refonte de la documentation CLI** — Réécriture globale de la référence en ligne de commande avec exemples et syntaxes actualisés.
- **Markdown pleine largeur dans la vue des plans** — Contenu défilant avec largeur maximale maîtrisée pour une lisibilité optimale.
- **Tableau des Jobs réactif** — Densité aérée sur tablette et moyenne sur bureau pour optimiser l'espace.
- **Retrait de la génération automatique de vérifications** — Suppression dans l'édition de projet au profit de la CLI.
- **Masquage des exceptions internes** — Les erreurs internes au framework ne sont plus exposées sous forme de notifications utilisateur.

### Corrections de bugs

- Prise en compte immédiate du retour au statut de brouillon dans l'interface après confirmation.
- Conservation de l'ordre des vérifications de projet lors de l'étape de revue dans l'intégration.
- Déblocage des étapes d'intégration après l'achèvement du traitement.
- Élimination du flash "No summary available" lors de l'ouverture d'un plan dans Review.
- Suppression du clignotement de l'onglet Modifications toutes les 30 secondes.
- Élimination de la contamination de `config.yaml` de TeamIvyConfig par la parallélisation des tests.
- Enregistrement des empreintes complètes de commits dans le synchronisateur et mise à jour de l'interface après synchronisation.
- Préservation des commits entre différentes exécutions de RetryPlan.
- Utilisation de la syntaxe PowerShell entre guillemets pour les chemins d'accès des actions de revue.
- Suppression de l'alerte d'erreur lors de la fermeture d'un dialogue avec la touche Échap.
- Correction de la sensibilité à la casse des sous-dossiers et des tests de nettoyage associés.
- Résolution des corruptions de `plan.yaml` lors de l'exécution d'UpdatePlan.
- Suppression des doublons d'affichage dans la sortie de l'agent lors de la diffusion en direct.
- Correction de l'affichage en double de la sortie de tâche à son achèvement.
- Résolution d'un défaut dans PromptwareRoot causant la disparition de promptwares.
- Ajustement de l'espacement et du positionnement de l'alerte de mise à jour disponible.
- Correction du message tronqué "You have ." dans WallpaperApp.
- Rétablissement de l'icône de la fenêtre par la mise à jour des noms de ressources.
- Résolution des dysfonctionnements de `gh auth status` en présence de multiples comptes GitHub.
- Correction de la fiche de sortie qui affichait un panneau vide pour les tâches complétées.
- Élimination d'un ReportedPlanId fictif en l'absence de répertoire correspondant au plan.
- Classement par date décroissante pour afficher les tâches les plus récentes en tête du tableau des Jobs.
- Conservation des tâches achevées lors d'un redémarrage.
- Correction de la syntaxe d'invocation déléguée causant des erreurs sur IvyFrameworkVerification.
- Résolution du blocage du bouton Complete Setup lors de l'intégration.
- Élimination du blocage au lancement des services d'arrière-plan.
- Correction de la portée des noms d'onglets dans l'application Review.

## 1.0.22 (2026-04-27)

### Améliorations

- **Gestion des erreurs avec GitResult\<T\>** — Introduction du type de retour typé `GitResult<T>` dans GitService pour une gestion explicite des erreurs évitant les exceptions.
- **Extraction de DashboardRepository** — Découplage de `GetDashboardData` dans un DashboardRepository dédié, isolant la persistance de la logique métier.
- **Interface ISessionParser** — Abstraction de l'analyse de session derrière une interface `ISessionParser` pour la testabilité.
- **Extraction de PlanYamlRepairService** — Réparation du YAML des plans et nettoyage des worktrees transférés dans des services dédiés (`PlanYamlRepairService`, `WorktreeCleanupService`).
- **Extraction d'AppShellRouter** — Logique d'aiguillage de `OpenApp` isolée dans la classe `AppShellRouter`.
- **Implémentations IDoctorCheck** — Décomposition des vérifications de diagnostic en classes individuelles `IDoctorCheck`.
- **Authentification MCP unifiée** — Centralisation de l'authentification des outils MCP au sein d'un service unique.
- **Protection BackgroundServiceActivator** — Surveillance et relance automatique en cas d'arrêt silencieux de processus d'arrière-plan.
- **Modèle IDisposable dans PlanDatabaseService** — Libération rigoureuse des ressources et connexions de bases de données.
- **SoftwareCheckStepView asynchrone** — Remplacement des appels bloquants `.Result` par `await` pour garantir la réactivité de l'interface lors des tests de bon fonctionnement.
- **Passe générale d'assainissement du code** — Diminution de la complexité cyclomatique dans ContentView, PlanController, PlanTools, ConfigService, GithubService, JobLauncher, ModelPricingService, TendrilAppShell et GetPromptDisplay.
- **Infrastructure de tests** — Intégration des patrons `TempDirectoryFixture`, `ConfigServiceFixture`, `DatabaseFixture` et `IClassFixture` ; élargissement de la couverture pour GitService, PlanValidationService, JobLauncher et l'attribution des PlanId.
- **Fenêtre de 7 jours sur le tableau de bord** — Filtrage des volumes d'activité et décomptes de projets sur les 7 derniers jours.

### Corrections de bugs

- Centralisation de l'attribution des PlanId dans JobService pour éliminer une condition de course.
- Correction du type de valeur renvoyé par `ModifyPlanEndpoint`.
- Résolution d'un conflit de type de journaliseur dans `DashboardRepository`.
- Correction de la fermeture automatique des issues GitHub en repositionnant la référence `Closes` après la troncature du corps.
- Résolution d'une condition de course lors du renommage de fichiers dans `InboxWatcherService`.
- Prise en charge des paramètres nullables dans `IsValidCommitHash`.
- Gestion des exceptions lors du suivi des coûts.
- Accès rectifié au fournisseur de services dans `Program.cs`.
- Ajustement de la référence à `TabState` dans `AppShellRouter` et des modificateurs d'accès.
- Suppression du verrouillage de concurrence des dépôts dans JobService.
- Remplacement de `DashboardLoggerAdapter` par l'utilisation directe du journaliseur.
- Journalisation des exceptions jusqu'alors ignorées dans l'ensemble des services.
- Correction de la configuration CI/Docker : Node.js v22, prise en compte propre d'IvySource et retrait des références orphelines.

## 1.0.14 (2026-04-10)

### Fonctionnalités

- **File d'attente prioritaire pour les tâches** — Les plans s'exécutent par ordre d'importance : les correctifs d'anomalies (Bug) devancent les améliorations secondaires (NiceToHave).
- **Importation d'issues depuis GitHub** — Importation directe des issues GitHub existantes sous forme de brouillons de plans via le nouveau dialogue.
- **Création de plans multi-projets** — Sélection de plusieurs projets dans Create Plan pour agréger leurs dépôts respectifs dans un plan unique.
- **WorktreeLifecycleLogger** — Piste d'audit centralisée pour la création, le nettoyage et les défaillances des worktrees à travers PlanReaderService, WorktreeCleanupService et JobService.
- **Onglet des paramètres avancés** — Nouvel onglet dans la configuration pour ajuster les options de bas niveau.

### Améliorations

- **Restitution progressive des tests d'intégrité** — Affichage des résultats des vérifications au fil de leur achèvement plutôt qu'en bloc à la fin.
- **Statut des PR mémorisé dans SQLite** — Mise en cache locale de l'état de fusion des PR avec synchronisation périodique, allégeant les sollicitations de l'API GitHub.
- **Simplification de PlanWatcher** — Remplacement de l'écouteur FileSystemWatcher pour prévenir les saturations de mémoire tampon liées aux mouvements de worktrees.
- **Journalisation diagnostique des worktrees** — Détection immédiate des fichiers `.git` manquants et libellés d'erreurs plus précis en cas d'échec de création de worktree.
- **Détection récursive des résidus de worktrees** — ExecutePlan détecte et élimine les fragments de worktrees imbriqués subsistant dans le dossier Plans.
- **Accès défensif aux dictionnaires** — Utilisation de `GetValueOrDefault` dans MakeSoftwareRow pour prévenir les erreurs KeyNotFoundException.

### Corrections de bugs

- Empêche le test de fonctionnement de Gemini d'ouvrir des onglets de navigation impromptus pendant l'authentification.
- Correction du contrôle `anyAgentHealthy` pour s'appuyer sur l'état d'installation de Gemini.
- Amélioration de la testabilité du constructeur de ConfigService.
- Correction d'erreurs de syntaxe YAML dans `recommendations.yaml`.
- Suppression d'une directive redondante Watch Remove dans `Ivy.Tendril.csproj`.
- Retrait du cache non utilisé `_prStatusCache` dans GithubService.

## 1.0.12 (2026-04-10)

### Fonctionnalités

- **Prise en charge multi-agent** — Prise en charge simultanée de plusieurs agents de codage (Claude, Codex, Gemini) avec profils configurables (deep, balanced, quick) par agent.
- **Installateur pour Windows** — Script `install.ps1` pour simplifier l'installation sous Windows.
- **Commande doctor** — Commande `tendril doctor` pour diagnostiquer l'environnement et valider les paramètres.

### Améliorations

- **Refonte intégrale de la documentation** — Réécriture en profondeur de l'ensemble de la documentation de Tendril, de sa structure, des tutoriels et de l'intégration.
- **Perfectionnement du parcours d'accueil** — Interface, formulations et progression fluidifiées lors de la toute première prise en main.
- **Promptwares agnostiques de la pile technique** — Retrait des spécificités d'outillages dans ExecutePlan, CreatePlan et les autres promptwares pour s'adapter à tout écosystème via les vérifications de `config.yaml`.
- **Remplacement de FolderInput par TextInput** — Simplification de la saisie des chemins d'accès dans toutes les applications Tendril.

### Corrections de bugs

- Prise en compte adéquate de la variable d'environnement `TENDRIL_HOME` dans la suite de tests.
- Ajout de la gestion d'erreurs dans `PlatformHelper.OpenInTerminal` et `OpenInFileManager`.
- Contrôle d'existence préalable `File.Exists` avant toute lecture de `plan.yaml` dans PlanReaderService.

## 1.0.9 (2026-04-09)

### Fonctionnalités

- **Publications NuGet stables** — Publication de paquets NuGet stables et versionnés grâce à `Directory.Build.props` pour une gestion unifiée des versions.
- **Base de données SQLite** — Stockage local pour les plans, les tâches et les statuts des PR avec prise en charge des migrations.
- **Système de recommandations** — Les plans peuvent générer des suggestions complémentaires présentées dans l'application Recommendations.
- **Gestion du cycle de vie des plans** — Machine à états complète : Draft, Approved, Executing, Review, Completed, Failed, avec transitions automatisées.

### Améliorations

- **Suivi des coûts** — Relevé des dépenses et des jetons par tâche avec restitution graphique sur le tableau de bord par projet et par promptware.
- **Énumération exhaustive des statuts de tâches** — Conversion en chaînes de caractères pour l'ensemble des statuts de travaux.
- **Robustesse de la gestion d'erreurs** — Détection des migrations dupliquées et gestion des erreurs liées à FTS5.

## 1.0.0 (2026-04-03)

### Fonctionnalités

- **Version initiale** du système de gestion de plans Tendril.
- **Applications de plans** — Vues Dashboard, Review, Drafts, Jobs, Icebox, Pull Requests, Recommendations et Trash.
- **Promptwares** — CreatePlan, ExecutePlan, CreatePr, UpdatePlan, SplitPlan, ExpandPlan et CreateIssue.
- **Compatibilité multiplateforme** — Prise en charge de macOS et Windows avec détection automatique.
- **Exécution isolée sur worktree** — Les plans s'exécutent sur des git worktrees dédiés pour préserver l'intégrité du dépôt principal.
- **Vérifications configurables** — Build, Test, Format, Lint et CheckResult (avec variantes comme DotnetBuild, NpmTest).
- **Intégration GitHub** — Création automatique de PR, suivi de l'avancement et détection des fusions.
- **Raccourcis clavier** — `Ctrl+Alt+D` pour initier de nouveaux brouillons, avec raccourcis personnalisables.
