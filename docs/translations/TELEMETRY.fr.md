# Politique de classification des données de télémétrie

## Objet

Ce document définit les données que Tendril peut et ne peut pas transmettre aux services de télémétrie tiers (PostHog). L'objectif est de recueillir des données d'analyse utiles tout en respectant la vie privée des utilisateurs.

Cette politique accompagne le code : elle est issue du fichier `TELEMETRY.md` de l'application Tendril d'origine et restreinte aux événements réellement pris en charge dans la version V2.

## Opt-in et non opt-out

**La télémétrie est désactivée tant que vous ne l'activez pas explicitement.** Seule la présence explicite de `telemetry: true` dans `config.yaml` active la collecte ; une clé absente et `telemetry: false` ont un comportement strictement identique : aucun client n'est instancié, aucun événement n'est mis en file d'attente et aucun appel réseau n'est jamais émis. La clé est lue à un emplacement unique : `TendrilSettings::telemetry_enabled` dans [config.rs](../../src/crates/tendril-core/src/config.rs), et la V2 n'*introduit* jamais cette clé de son propre chef : sauvegarder un fichier `config.yaml` qui en est dépourvu la laisse absente plutôt que d'inscrire `telemetry: false`. Ainsi, le partage d'un fichier avec l'application d'origine — qui interprète une clé absente comme « activée » — ne risque pas de désactiver la télémétrie de cette dernière. Une valeur explicite est conservée à l'identique.

**Il s'agit d'une divergence délibérée.** L'application d'origine fonctionne en opt-out : elle définit `Telemetry` à `true` par défaut et son propre document indique « Telemetry is opt-out: it is on by default. » La V2 est désactivée par défaut car activer la collecte de données n'est pas une décision qu'un portage doit prendre silencieusement à la place de l'utilisateur. Cette divergence ne présente aucun risque dans un sens : la V2 transmet moins d'informations que l'original, jamais davantage. Pour inverser ce comportement, rétablissez la valeur par défaut du champ et l'implémentation de `Default` dans [config.rs](../../src/crates/tendril-core/src/config.rs) à `Some(true)`.

Les utilisateurs sont identifiés uniquement au moyen d'un UUID aléatoire conservé dans `<TendrilHome>/.anonymous-id`. Cet identifiant n'est jamais dérivé d'un nom d'utilisateur, d'un nom de machine ou d'un dépôt. (L'application originale utilise de préférence `<LocalAppData>/Tendril/.anonymous-id` ; une machine exécutant les deux applications comptera par conséquent pour deux installations distinctes).

## Règles de classification

### AUTORISÉ — Données agrégées et non identifiantes

- **Comptages** : nombre de projets, dépôts, plans, jobs (totaux agrégés uniquement)
- **Durées** : temps d'exécution des opérations, en secondes
- **États/Types** : valeurs d'énumérations, noms d'états, types de jobs (par ex. `CreatePlan`, `ExecutePlan`)
- **Niveaux** : niveaux de plan (par ex. `Bug`, `Feature`, `Epic`)
- **Versions** : chaînes de version de l'application, nom et chaîne de version du système d'exploitation
- **Fournisseurs d'agents** : nom de l'agent de programmation (par ex. `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity`, `apple`, `ivy`)
- **Booléens** : indicateurs de fonctionnalités (feature flags), états de configuration (par ex. `llm_configured: true`)
- **Descripteurs technologiques** : le hash du stack du projet (voir ci-dessous)
- **Hashes à sens unique salés par installation** pour les identifiants interdits par ailleurs (voir ci-dessous)

#### Hash du stack (`stack_hash`)

Le hash du descripteur de stack est une signature canonique et préservant les similarités de la pile technologique d'un projet, par ex. `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`. Il est composé exclusivement d'un vocabulaire fermé de slugs de langages, de frameworks, de bases de données et d'outils de test — par conception, il ne transporte aucun nom, chemin, version, décompte ni texte libre. Il indique sur quels stacks Tendril est utilisé sans dévoiler à qui appartient le projet.

#### Identité de plan salée par installation (`plan_uuid`)

Les identifiants bruts de plan demeurent strictement interdits, mais les événements doivent pouvoir être regroupés par plan. `telemetry::derive_plan_uuid` génère `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)` tronqué à 16 octets et formaté comme un UUID RFC 9562 v8, en lieu et place de l'identifiant lui-même :

- L'identifiant anonyme sert de sel propre à l'installation, de sorte que le plan `00042` produit une valeur différente sur chaque machine et ne permet pas d'établir de corrélation entre utilisateurs indépendants.
- Le hachage est à sens unique, empêchant ainsi le compteur séquentiel de quitter la machine.
- Sa portée est circonscrite à un seul utilisateur anonyme, ce qui permet de grouper les événements sans élargir le périmètre d'identification.

Les identifiants sont préalablement normalisés sur cinq chiffres, afin que le format entier issu de la base de données (`42`) et la notation sous forme de dossier (`00042`) produisent la même valeur.

Tout besoin ultérieur de corrélation d'un identifiant interdit devra impérativement employer ce même schéma de hash salé, et jamais la valeur brute.

### INTERDIT — Informations identifiantes

Ne jamais enregistrer :

- **URLs** : URLs de dépôts, de pull requests ou d'issues
- **Chemins** : chemins de fichiers, de répertoires, chemins absolus vers des dépôts
- **Noms d'utilisateurs** : noms d'utilisateurs GitHub, noms d'organisations, adresses e-mail
- **Noms de dépôts** et **noms de projets** — même génériques, ils dévoilent le contexte de travail
- **Identifiants séquentiels** : identifiants de plans, numéros d'issues, numéros de PR (utiliser un hash salé par installation à la place — voir `plan_uuid`)
- **Saisies utilisateur** : descriptions de tâches, messages de commit, contenu des plans
- **Titres** : titres de plans, d'issues ou objets de commits
- **Sorties d'agents** : transcriptions, appels d'outils ou messages d'erreur susceptibles d'embarquer du contenu utilisateur

## Cadre décisionnel

1. Ce champ permet-il d'identifier une personne ou une organisation ? → Interdit
2. Révèle-t-il des informations privées sur un dépôt ? → Interdit
3. Dévoile-t-il les sujets sur lesquels l'utilisateur travaille ? → Interdit
4. Peut-il faire l'objet de corrélations entre utilisateurs pour les désanonymiser ? → Interdit, sauf si salé avec l'identifiant anonyme et haché à sens unique
5. Apporte-t-il des analyses agrégées utiles ? → Autorisé

**En cas de doute, s'abstenir.**

## Rattaché à chaque événement

Propriétés globales définies une fois par processus dans [client.rs](../../src/crates/tendril-core/src/telemetry/client.rs) :

| Propriété | Statut | Remarques |
|---|---|---|
| `$session_id` | Conforme | UUID aléatoire, réinitialisé à chaque processus |
| `$geoip_disable: false` | Accepté | PostHog géolocalise l'IP au niveau pays ; l'IP n'est pas stockée comme propriété d'événement |
| `app_version` | Conforme | Version de la crate |
| `os` | Conforme | Nom de la plateforme |
| `os_version` | Conforme | Version `uname` sous unix, famille de plateforme ailleurs |

`distinct_id` (l'identifiant anonyme) est rattaché à chaque événement. Les propriétés `distribution` / `source` de l'application originale sont ignorées : elles transportaient une valeur `AppBrand` propre à .NET sans équivalent dans la V2.

## Audit des événements actuels

L'ensemble des événements respecte cette politique. Les contextes sont des structures typées dans [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs), garantissant que l'attribution de propriétés s'opère au moment de la compilation et non via une table générique.

| Événement | Propriétés | Déclenché depuis |
|---|---|---|
| `app_started` | `version`, `project_count`, `llm_configured` | `run_server`, une fois le verrou principal acquis |
| `job_created` | `job_type`, `agent`, `plan_uuid` | `JobManager::start_job_with` |
| `job_completed` | `job_type`, `status`, `duration_seconds`, `agent`, `plan_uuid` | `finish_job` |
| `plan_created` | `level`, `duration_seconds`, `agent`, `stack_hash`, `plan_uuid` | `finish_job`, `CreatePlan` avec livrable |
| `pr_created` | `duration_seconds`, `agent`, `plan_uuid` | `finish_job`, `CreatePr` |
| `plan_state_transition` | `from_state`, `to_state`, `plan_uuid` | `apply_plan_state`, après écriture sur disque |

`plan_uuid` correspond systématiquement à la valeur dérivée et salée par installation : les points d'appel transmettent l'identifiant brut du plan au contexte typé et le client calcule le hash avant enregistrement, ce qui garantit que l'identifiant brut ne peut parvenir à PostHog, même depuis un point d'appel méconnaissant la règle.

### Définis mais non raccordés

`onboarding_completed` et `project_created` disposent de structures de contexte dans [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs) sans point d'appel : la V2 ne propose pas de flux d'onboarding et la création de projet est gérée par le processus CLI, au sein duquel aucun client n'est installé. Ils sont conservés afin qu'un futur plan puisse simplement raccorder le point d'appel sans modifier le schéma.

Le client ne réside que dans le processus démon. Une commande CLI n'appelle jamais `telemetry::install` ; ainsi, `tendril plan ...` ne transmet aucune donnée.

## Implémentation

- [events.rs](../../src/crates/tendril-core/src/telemetry/events.rs) — contextes fortement typés appliquant cette politique dès la compilation. Les nouveaux événements doivent y définir une structure dédiée, jamais un sac de propriétés libres.
- [client.rs](../../src/crates/tendril-core/src/telemetry/client.rs) — client PostHog, identifiant anonyme, dérivation de l'UUID de plan. Chaque appel `track_*` capture ses propres erreurs et pousse uniquement dans une file consommée en tâche de fond : la télémétrie ne doit jamais bloquer ni ralentir un job.
- [telemetry_test.rs](../../src/crates/tendril-core/tests/telemetry_test.rs) — valide l'absence d'appels réseau lorsque la télémétrie est désactivée, l'ensemble exact des propriétés transmises pour chaque événement connecté et la dérivation conforme de l'UUID de plan.
