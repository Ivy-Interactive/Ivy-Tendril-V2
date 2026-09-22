# Guide de configuration de Google Antigravity pour les Skills Tendril

Ce guide explique comment installer et utiliser les skills Tendril avec la CLI Google Antigravity (`agy`) et l'IDE Antigravity.

## 1. Installation de la CLI Antigravity

Tendril fournit un manifeste de plugin Antigravity dans `.agents/plugins/marketplace.json`.

### Installation depuis un dépôt Git distant
```bash
agy plugin install https://github.com/ivy-interactive/ivy-tendril-v2.git
```

### Installation depuis un clone local du dépôt
Lors du développement local ou dans un clone de Ivy-Tendril-V2 :
```bash
agy plugin install ./
```

## 2. Vérification et détection des plugins

Vérifiez que le plugin et ses skills associées sont bien chargés :

```bash
# Lister les plugins installés
agy plugin list

# Vérifier les skills disponibles
agy skill list
```

Vous verrez les skills Tendril intégrées :
- `tendril-debug-plan`
- `tendril-debug-job`
- `tendril-review`
- `tendrillable`
- `tendril-release`
- `tendril-extension`

## 3. Invocation des skills dans Antigravity

Dans toute session interactive d'agent Antigravity ou dans des scripts automatisés :

- Demander à Antigravity de déboguer un plan :
  ```
  Use tendril-debug-plan to investigate plan 00516
  ```
- Examiner les diffs en attente dans le worktree :
  ```
  Run tendril-review on the current changes
  ```
- Trier les issues candidates du backlog :
  ```
  Run tendrillable on https://github.com/ivy-interactive/ivy-tendril-v2 5
  ```

## 4. Intégration dans l'IDE Antigravity

Lors d'un travail dans l'IDE Antigravity :
1. Les skills placées dans le répertoire racine `.agents/skills/` de votre espace de travail sont automatiquement indexées.
2. Pour lier l'extension Ivy Tendril dans l'IDE Antigravity :
   ```bash
   src/skills/tendril-extension/scripts/install-antigravity.sh
   ```
3. Rechargez l'IDE Antigravity (`Cmd+Shift+P` -> `Developer: Reload Window`).

## Licence

Les skills et plugins Tendril sont sous licence [Functional Source License (FSL-1.1-ALv2)](../LICENSE) à la racine du dépôt.
