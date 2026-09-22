# Guide de configuration de Visual Studio Code pour les Skills Tendril

Ce guide explique comment installer, configurer et utiliser les Skills d'Agent Tendril avec GitHub Copilot et d'autres extensions d'agents d'IA dans Visual Studio Code.

## 1. Installation rapide (Skills CLI)

Le moyen le plus simple d'installer les skills Tendril pour GitHub Copilot dans VS Code consiste à utiliser la CLI ouverte des agent skills :

```bash
# Installation au niveau du projet (s'installe dans .agents/skills/ ou .github/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# Installation globale (disponible dans tous les espaces de travail VS Code)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

Pour installer des skills individuelles spécifiques plutôt que le paquet complet :

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. Emplacements d'installation manuelle

Si vous préférez placer les dossiers de skills manuellement sans la CLI :

- **Dépôt de l'espace de travail (recommandé pour les équipes)** :
  Copiez les skills dans `.agents/skills/<skill-name>` ou `.github/skills/<skill-name>` à la racine de votre espace de travail.
- **Profil utilisateur (global pour tous les projets)** :
  Copiez les skills dans `~/.copilot/skills/<skill-name>` (macOS/Linux) ou `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows).

Assurez-vous que chaque dossier de skill contient sa spécification `SKILL.md` et les éventuels répertoires `references/` ou `scripts/` associés.

## 3. Utilisation des skills dans GitHub Copilot Chat

Une fois installées, GitHub Copilot détecte automatiquement les skills :

1. Ouvrez Copilot Chat dans VS Code (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Tapez `/skills` pour examiner les skills chargées et leurs descriptions.
3. Invoquez n'importe quelle skill Tendril directement en tant que commande :
   - `/tendril-debug-plan <plan-id>` : Inspecter les journaux d'exécution, la chronologie et les vérifications d'un plan.
   - `/tendril-debug-job <job-id>` : Analyser les artefacts de travail, les journaux d'agent et les événements bruts.
   - `/tendril-review` : Effectuer une revue complète du code et des tests sur les fichiers modifiés après un changement.
   - `/tendrillable <url>` : Évaluer des issues GitHub pour une exécution par agent autonome.

## 4. Intégration avec d'autres extensions d'IA pour VS Code

Les skills Tendril respectent le standard ouvert des agent skills et fonctionnent parfaitement avec des extensions tierces pour VS Code :

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
Les skills sont écrites dans `.cline/skills/` ou dans le répertoire de configuration globale de Cline.

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
Les skills sont installées dans votre répertoire `.continue/skills/` et peuvent être référencées dans le contexte des prompts.

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
Installées dans `.roo/skills/` pour des modes système personnalisés et l'exécution de tâches.

## 5. Association avec l'extension officielle Ivy Tendril pour VS Code

Pour un flux de travail de développement intégré, installez l'[extension officielle Ivy Tendril pour VS Code](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril) :

- **Tableau de bord des plans (Plan Dashboard)** : Parcourez, examinez et déclenchez des plans directement depuis la barre latérale.
- **Navigateur de worktrees** : Basculez dans des worktrees d'exécution isolés en un seul clic.
- **Contrôle du serveur** : Démarrez, arrêtez et inspectez les processus serveur de Tendril en arrière-plan.

Associer les skills Tendril à l'extension VS Code vous offre un centre de contrôle complet pour orchestrer des agents de programmation autonomes.

## Licence

Les skills et plugins Tendril sont sous licence [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) à la racine du dépôt.
