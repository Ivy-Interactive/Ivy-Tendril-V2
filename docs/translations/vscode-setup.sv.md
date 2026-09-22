# Konfigurationsguide för Visual Studio Code för Tendril Skills

Denna guide beskriver hur du installerar, konfigurerar och använder Tendril Agent Skills med GitHub Copilot och andra tillägg för AI-agenter i Visual Studio Code.

## 1. Snabbinstallation (Skills CLI)

Det enklaste sättet att installera Tendril skills för GitHub Copilot i VS Code är att använda det öppna agent skills CLI-verktyget:

```bash
# Installation på projektnivå (installeras i .agents/skills/ eller .github/skills/)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot

# Global installation (tillgänglig över alla VS Code-arbetsytor)
npx skills add ivy-interactive/ivy-tendril-v2 --agent github-copilot -g
```

För att installera specifika enskilda skills istället för hela paketet:

```bash
npx skills add ivy-interactive/ivy-tendril-v2 --skill tendril-debug-plan --agent github-copilot
```

## 2. Manuella installationssökvägar

Om du föredrar att placera skill-mappar manuellt utan CLI:

- **Arbetsyte-arkiv (rekommenderas för team)**:
  Kopiera skills till `.agents/skills/<skill-name>` eller `.github/skills/<skill-name>` i roten av din arbetsyta.
- **Användarprofil (globalt för alla projekt)**:
  Kopiera skills till `~/.copilot/skills/<skill-name>` (macOS/Linux) eller `%USERPROFILE%\.copilot\skills\<skill-name>` (Windows).

Se till att varje skill-mapp innehåller sin `SKILL.md`-specifikation och eventuella tillhörande `references/`- eller `scripts/`-kataloger.

## 3. Använda skills i GitHub Copilot Chat

När de har installerats upptäcker GitHub Copilot automatiskt dina skills:

1. Öppna Copilot Chat i VS Code (`Ctrl+Alt+I` / `Cmd+Ctrl+I`).
2. Skriv `/skills` för att inspektera inlästa skills och beskrivningar.
3. Anropa valfri Tendril-skill direkt som ett kommando:
   - `/tendril-debug-plan <plan-id>`: Inspektera körningsloggar, tidslinje och verifieringar för en plan.
   - `/tendril-debug-job <job-id>`: Analysera jobbartefakter, agentloggar och råhändelser.
   - `/tendril-review`: Kör en omfattande kod- och testgranskning av ändrade filer efter ändringar.
   - `/tendrillable <url>`: Utvärdera GitHub-ärenden för autonom agentkörning.

## 4. Integrering med andra VS Code AI-tillägg

Tendril skills följer den öppna standarden för agent skills och fungerar sömlöst med tredjepartstillägg för VS Code:

### Cline
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent cline
```
Skills skrivs till `.cline/skills/` eller Clines globala konfigurationskatalog.

### Continue
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent continue
```
Skills installeras i din `.continue/skills/`-katalog och kan refereras i promptkontext.

### Roo Code (Roo Clinic)
```bash
npx skills add ivy-interactive/ivy-tendril-v2 --agent roo
```
Installeras i `.roo/skills/` för anpassade systemlägen och uppgiftskörning.

## 5. Kombinera med det officiella Ivy Tendril VS Code-tillägget

För ett integrerat utvecklingsarbetsflöde, installera det officiella [Ivy Tendril VS Code-tillägget](https://marketplace.visualstudio.com/items?itemName=ivy-interactive.ivy-tendril):

- **Planöversikt (Plan Dashboard)**: Bläddra bland, granska och starta planer direkt från sidofältet.
- **Worktree-navigator**: Hoppa till isolerade exekverings-worktrees med ett enda klick.
- **Serverkontroll**: Starta, stoppa och inspektera Tendrils bakgrundsserverprocesser.

Att kombinera Tendril skills med VS Code-tillägget ger dig ett komplett kontrollcenter för orkestrering av autonoma kodningsagenter.

## Licens

Tendril skills och plugins licensieras under [Functional Source License (FSL-1.1-ALv2)](../../LICENSE) i arkivets rot.
