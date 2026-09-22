# Konfigurationsguide för Claude Code för Tendril Skills

Denna guide beskriver hur du installerar, konfigurerar och testar Tendril Agent Skills i Claude Code.

## 1. Installation via tilläggsmarknadsplatsen (Marketplace)

Tendril tillhandahåller officiella pluginmanifest på `.claude-plugin/marketplace.json` och `.claude-plugin/plugin.json`.

Lägg till Ivy-Tendril-V2-arkivet som en marknadsplatskälla i Claude Code:

```
/plugin marketplace add ivy-interactive/ivy-tendril-v2
```

Installera sedan tillägget `tendril-skills`:

```
/plugin install tendril-skills@ivy-tendril-v2
```

## 2. Lokal utveckling och testning

När du utvecklar skills lokalt eller testar ändringar innan du pushar:

Starta Claude Code med plugin-katalogen pekande på din lokala arkivutcheckning:

```bash
claude --plugin-dir /path/to/ivy-tendril-v2
```

Claude Code läser `.claude-plugin/plugin.json` och monterar automatiskt alla skills som definieras i `skills/`.

## 3. Bakåtkompatibilitet med .claude/skills

För lokala arkivarbetsflöden inuti Ivy-Tendril-V2:
- Symboliska länkar i `.claude/skills/<skill-name>` pekar på `../../skills/<skill-name>`.
- Befintlig lokal Claude Code-konfiguration som refererar till `.claude/skills/` fortsätter att fungera sömlöst utan manuell omkonfiguration.

## 4. Anropa skills i Claude Code

Efter installation använder du snedstreckskommandon direkt i din Claude Code-session:

- `/tendril-debug-plan <plan-id>`: Felsök misslyckade eller långsamma planer.
- `/tendril-debug-job <job-id>`: Inspektera jobbartefakter och agentens beslutsloggar.
- `/tendril-review`: Utför kodkvalitets- och regressionskontroller på aktuella differenser.
- `/tendrillable <url>`: Klassificera backlogg-ärenden utifrån kriterier för autonoma agenter.
- `/tendril-release`: Automatisera versionshöjningar, beroendeuppdateringar och versionsflöden.

## Licens

Tendril skills och plugins licensieras under [Functional Source License (FSL-1.1-ALv2)](../LICENSE) i arkivets rot.
