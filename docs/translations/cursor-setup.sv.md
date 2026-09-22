# Konfigurationsguide för Cursor för Tendril Skills

Denna guide beskriver hur du installerar och konfigurerar Tendril Agent Skills i Cursor.

## 1. Snabbinstallation (Skills CLI)

Installera Tendril skills i ditt Cursor-projekt med hjälp av skills CLI:

```bash
# Installation på projektnivå (installeras i .cursor/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor

# Global installation (över alla Cursor-arbetsytor)
npx skills add ivy-interactive/ivy-tendril-v2 --agent cursor -g
```

## 2. Katalogstruktur i Cursor

Cursor söker efter skill-definitioner på följande platser:

- **Projektnivå**: `.cursor/skills/<skill-name>/SKILL.md`
- **Global / Användarnivå**: `~/.cursor/skills/<skill-name>/SKILL.md` (macOS/Linux) eller `%USERPROFILE%\.cursor\skills\<skill-name>\SKILL.md` (Windows)

Varje mapp innehåller:
- `SKILL.md`: Huvudinstruktioner med YAML frontmatter
- Stödjande referensdokumentation och skript

## 3. Interaktion med Cursor Rules (.cursorrules)

Du kan referera till Tendril skills från ditt projekts `.cursorrules` eller `.cursor/rules/*.mdc`-filer:

```markdown
When debugging failed plans or reviewing changes:
- Reference src/skills/tendril-debug-plan for plan execution diagnosis.
- Run src/skills/tendril-review procedures before finalizing pull requests.
```

## 4. Användning i Cursor Agent Chat

I Cursors agentchattfönster:
- Skriv `@tendril-debug-plan` eller be agenten att inspektera en plan med hjälp av dess instruktioner.
- Be Cursor köra `/tendril-review` på den aktiva git-diffen.
- Kör `/tendrillable` för att rangordna ärenden utifrån lämplighet för agenter.

## Licens

Tendril skills och plugins licensieras under [Functional Source License (FSL-1.1-ALv2)](../LICENSE) i arkivets rot.
