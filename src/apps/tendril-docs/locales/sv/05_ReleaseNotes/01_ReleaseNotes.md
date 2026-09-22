---
title: Versionsanteckningar
description: Versionshistorik, nya funktioner, förbättringar och buggfixar för
  varje Tendril-version.
icon: ScrollText
searchHints:
  - versionsanteckningar
  - ändringslogg
  - versionshistorik
  - uppdateringar
  - nyheter
---

# Versionsanteckningar

## 2.0.0 (2026-09-21)

Tendril v2 är en generationsmässig arkitektonisk nysatsning av Tendril-plattformen, där daemonen och kärnutförandemotorn har skrivits om i [Rust](https://www.rust-lang.org), skrivbordsapplikationen har migrerats till [Tauri v2](https://tauri.app), en högpresterande [Vite+](https://viteplus.dev)-frontend har introducerats, och inbyggd multi-agent-worktree-samtidighet, live-terminalinteraktioner samt utökade [modell-leverantörer](../08_ModelProviders/_Index.md) har lagts till.

### Större arkitektoniska förändringar

- **Högpresterande Rust-daemon (`tendril-server` och `tendril-core`)**: Ersatte den tidigare .NET-backendmodulen med en asynkron [Rust](https://www.rust-lang.org)-daemon driven av [Tokio](https://tokio.rs) och [Axum](https://github.com/tokio-rs/axum). Den nya daemonen levererar rutt-dispatching på under millisekunden, robust [SQLite](https://www.sqlite.org)-anslutningspoolning med upptaget-tidsgränser, atomiska konfigurationsfilsskrivningar och ett mastervalsprotokoll för en enskild process för noll-overhead vid lokal IPC.
- **Tauri v2-skrivbordsapplikation**: Övergick skrivbordsskalet till [Tauri v2](https://tauri.app), vilket ger en kompakt och minneseffektiv skrivbordsdistribution på macOS, Linux och Windows. Utnyttjar inbyggda systemwebbvyer, härdad IPC-bryggning, inbyggda fönsterdekorationer och systemfältsintegrering samtidigt som tidigare beroenden till körramverk elimineras.
- **Vite+ React-frontend**: Byggde om skrivbordsanvändargränssnittet från grunden med [Vite+](https://viteplus.dev) och [React 19](https://react.dev). Delar atomiska design-tokens och renderingskomponenter med `@ivy-interactive/components`, vilket stöder omedelbar hot reloading, enhetliga temaförinställningar (Default, Dracula, Forest, Lovably) och responsiva layouter med flera brytpunkter.
- **Parallellt worktree-utförande**: Automatiserad [git worktree](https://git-scm.com/docs/git-worktree)-allokering över flera repon för samtidig exekvering av [planer](../02_Concepts/01_Plans.md). Flera [kodningsagenter](../06_CodingAgents/_Index.md) kan köra separata planer samtidigt på isolerade grenar utan git-indexlåsning, arkivkollisioner eller sidoeffekter vid grenbyten. Innehåller en bakgrundsrensningstjänst (`worktreeReaperInterval` och `worktreeReaperGrace`) för att automatiskt rensa inaktiva eller föräldralösa worktrees.
- **Live-terminal och interaktiva chattar**: Introducerade inbäddad [PTY](https://en.wikipedia.org/wiki/Pseudoterminal)-terminalemulering driven av [Xterm.js](https://xtermjs.org) direkt i applikationsskalet. Operatörer kan växla mellan strukturerad chatt och rå terminalinteraktion (`chatMode: terminal` eller `chatMode: chat`), interagera med körande agenter via stdin, granska liveströmmande verktygskörningar och behålla beständiga köade prompter över sessionsbyten.
- **Utökade modellintegrationer och medföljande sidecars**:
  - **Medföljande OpenCode-sidecar**: Levererar den binära [OpenCode](https://opencode.ai)-CLI:n direkt med skrivbordsinstallationsprogrammet (`binaries/opencode`), vilket möjliggör nollkonfigurationskörning av [OpenCode-agenten](../06_CodingAgents/04_OpenCode.md) och omedelbar tillgång till hundratals öppen källkods- och proprietära modeller utan krav på separata Node- eller CLI-installationer.
  - **Ta med din egen LLM (BYO LLM)**: Förstklassiga introduktions- och inställningskort för [OpenAI](https://openai.com), [Anthropic](https://www.anthropic.com) och den europeiska suveräna leverantören [Berget AI](../08_ModelProviders/01_Berget.md) (`https://api.berget.ai/v1`), med automatisk bas-URL-normalisering och autentiseringsdispatch till SDK-variabler för både OpenAI och Anthropic.
  - **Apple Foundation Model-integration**: Inbyggt stöd för Apples enhetsmodeller via macOS `fm serve`, vilket utför inferens lokalt med noll moln-API-kostnader och fullständig integritet offline.
  - **Dynamisk modellkatalogberikning**: Integrerar dynamisk katalogupptäckt från [models.dev](https://models.dev) med offline [SQLite](https://www.sqlite.org)-cachelagring, inaktualitetsdetektering och manuella synkroniseringsändpunkter (`POST /api/models/refresh`).
  - **Nivåindelade modellprofiler**: Deklarativa modellprofilnivåer (`deep`, `balanced`, `quick`) för alla stödda [kodningsagenter](../06_CodingAgents/_Index.md) ([Claude Code](../06_CodingAgents/01_ClaudeCode.md), [Copilot](../06_CodingAgents/03_Copilot.md), [Codex](../06_CodingAgents/02_Codex.md), [Gemini](../06_CodingAgents/05_Gemini.md), [Antigravity](https://antigravity.google), [OpenCode](../06_CodingAgents/04_OpenCode.md), [Cursor](https://cursor.com) och Apple), inklusive konfigurerbara resonemangsinsatsväljare (`low`, `medium`, `high`, `max`).

### Funktioner

- **Inbäddad PTY-terminal för granskningsåtgärder och agenter**: Kör granskningsåtgärder och interaktiva agentsessioner inuti fullt ANSI-kapabla terminalflikar med process-trädspårning i realtid.
- **Git Worktree-hantering över flera repon**: Isolerade planarbetsytor strukturerade under `Worktrees/<owner>/<repo>` med grenspårning, uppströms basgrens-forkdetektering och säkert skydd för opushade commits.
- **Centraliserad Team Vault-synkronisering**: Anslut, importera och pusha projektkonfigurationer, anpassade [MCP-servrar](../09_Advanced/03_MCP.md) och [agentfärdigheter](../06_CodingAgents/00_Skills.md) till fjärranslutna Git-backade valv via [Team Vault](../09_Advanced/01_CLI/07_Vault.md) med automatisk sanering av inloggningsuppgifter.
- **Cloudflare Quick Tunnels**: Dela skrivskyddade plangranskningar och live-verifieringsstatus över säkra [Cloudflare](https://www.cloudflare.com)-tunnlar med QR-koder, [Argon2](https://en.wikipedia.org/wiki/Argon2)-lösenordssessionsskydd och anonyma granskarpersonor.
- **Inbyggd konfigurationsredigerare**: Full syntaxanpassad inbyggd redigerare för `config.yaml` med live-konfliktdetektering, omladdningskrokar och assistentvägledda promptåtgärder (se [Konfigurationsinställning](../03_Configuration/01_Setup.md)).

### Förbättringar

- **CLI-anrop på under millisekunden**: Skrev om `tendril`-CLI:n i Rust (`src/crates/tendril-cli`), vilket ger nästintill omedelbar kommandostart och sömlös daemon-proxying (se [CLI-översikt](../09_Advanced/01_CLI/00_Overview.md)).
- **Token- och kostnadshuvudbok**: Tokenfördelningsark i realtid per jobb och kostnadsspårning kalibrerad över alla större leverantörsmodeller, med automatisk reservprissättning för anpassade ändpunkter.
- **Automatiserade verifieringslösare**: Strukturerad verifieringskörare som kör projektkontrollsviter (build, test, format, lint) med liveströmmad utdata och automatisk feldiagnostik (se [Verifieringskontroller](../09_Advanced/01_CLI/03_Verification.md)).
- **Enhetlig Markdown-renderare**: Delad markdown-renderingsmotor för planer, anteckningar och dokumentation, med stöd för GFM-tabeller, syntaxmarkerade kodblock, [Mermaid](https://github.com/mermaid-js/mermaid)-diagram och teckenförankrade infogade diff-kommentarer i [Granskningsappen](../04_Apps/02_Review.md).

## 1.2.0 (2026-09-01)

### Funktioner

- **Omdesignat applikationsskal (Figma)** – Moderniserad layout för skrivbordsskalet med hopfällbara navigeringssektioner, beständiga sessionsflikar och integrerade projektstatusindikatorer (`#2173`).
- **Omdesignad Tendril-instrumentpanel** – Byggde den nya React-widgeten `TendrilDashboard` med livestatusräknare, aktivitetstrender, aktiv jobbspårning och visning av Cloudflare Quick Tunnel QR-koder (`#2201`).
- **Förening av utkast till planer** – Döpte om appen Utkast, tjänster och modeller till "Planer" i hela kodbasen, vilket skapar en sammanhållen livscykel från ärendeintag till verifierat utförande (`#2258`).
- **HTTP Multipart-uppladdningar för chattbilagor** – Ersatte infogad base64-överföring med uppdelade HTTP multipart-uppladdningar, vilket undviker SignalR-nyttolastbegränsningar för stora bilder och filer (`#2255`, `#2224`).
- **Beständiga köade meddelanden i chatt** – Köade meddelanden kvarstår och förblir synliga vid byte av chattsessioner, vilket gör det möjligt för utvecklare att köa prompter medan en agent körs aktivt (`#2253`).
- **Kortkommando för sökning på sidan (Ctrl+F / Cmd+F)** – Lade till sökning på sidan i markdown-vyer och planer utan att störa layoutflödet (`#2254`).
- **Live-förhandsvisning av granskningsåtgärder** – Lade till funktioner för förhandsgranskning och körning av granskningsåtgärder direkt i Projektinställningar (`#2225`).
- **Lovably-temaförinställning** – Lade till en modern UI-temaförinställning baserad på Lovable-designtokens och färgskalor (`#2256`).
- **Utökning av CodeInput med teckensnitt med fast bredd** – Integrerade syntaxanpassad `CodeInput` över kommandon och villkor för granskningsåtgärder (`#2247`), MCP-miljövariabler (`#2248`), verifieringsprompter (`#2249`) och markdown-innehåll i projektminnet (`#2259`).
- **Säkra skyddsräcken för chatt** – Förbjöd direkta overifierade redigeringar av kodbasen i utforskande chattsessioner, vilket tvingar fram formellt skapande av planer för ändringar (`#2221`).
- **Projektsammanfogning vid konflikt i Team Vault** – Lade till intelligent sammanfogningslösning vid import av valvprojekt som delar namn med lokala projekt (`#2219`).

### Förbättringar

- **Berikade prompter för agentchatt och ärendegenerering** – Tillhandahöll fullständig projektkontext, repomappningar och bilagemetadata till initiala prompter för agentchatt och GitHub-ärendeskapande (`#2226`).
- **Temalägesindikatorer i utseendeinställningar** – Visade aktiva ljust/mörkt läges-tillstånd tydligt i Utseendeinställningar (`#2213`).
- **Temaresponsiv ContentInput-widget** – Anpassade inmatningsfält, knappar och kanter dynamiskt över anpassade temaförinställningar (`#2241`).
- **Förenkling av tabell för granskningsåtgärder** – Effektiviserade konfigurationstabellen för granskningsåtgärder i Projektinställningar för förbättrad läsbarhet (`#2240`).
- **Källkodsbyggen för staging-containrar** – Konfigurerade Docker-staging-avbilder att bygga direkt från källkoden för noggrann testning av PR-förhandsgranskningsgrenar (`#2229`).
- **Finjustering av sidofältslayout och avstånd** – Förfinade avstånd för slutförda bockmarkeringsbrickor och genererande sessionslayouter i Chattsidofältet (`#2220`, `#2223`).
- **Inbyggd dialogruta för borttagning av session** – Ersatte React-modaldialogen med en inbyggd `DeleteSessionDialog`-widget för borttagning av sessioner (`#2222`).

### Buggfixar

- **Jobbsynlighet och köåterställning** – Fixade saknade jobbkort och återställde aktiva köade jobbtillstånd korrekt efter applikationsomstarter (`#2243`).
- **Rensning av spökblockerade jobb** – Förhindrade att föräldralösa eller ersatta blockerade jobb låg kvar i SQLite-lagring och Utdatavyer (`#2250`).
- **Tidsgränser för Antigravity-agentchatt** – Konfigurerade Antigravity-agentsessioner att respektera konfigurerade globala standardtidsgränser istället för att avbrytas i förtid (`#2218`).
- **Redigeringsmål för verifiering i projektinställningar** – Fixade verifieringsdialogruta som riktade in sig på fel verifieringspost under redigeringar (`#2252`).
- **Översvämning av kodblock i Markdown** – Förhindrade att breda kodavsnitt flödade över överordnade planbehållare horisontellt (`#2214`).
- **Kontrast för Dracula- och Forest-mörka teman** – Löste synlighetsbuggar för text och ikoner vid hovring på sidofältsobjekt, inställningsikoner och flikar i mörka teman (`#2210`, `#2211`, `#2212`, `#2239`, `#2242`).
- **Eliminering av dubbla sidofält** – Eliminerade redundant rendering av sidofält under övergångar i applikationsskalet (`#2244`).
- **Slutfört utkasttillstånd på lösta ärenden** – Löste icke-slutförbart tillstånd vid generering av planer för tidigare lösta ärenden (`#2217`).
- **Rensning av föråldrade modeller** – Tog bort föråldrade referenser till Gemini 3.5 Flash-modellen till förmån för Gemini 3.7 Flash (`#2215`).
- **Rensning av tillfälliga testartefakter** – Säkerställde att ändpunkt-till-ändpunkt-testkörningar rensar upp tillfälliga kataloger och agentkladdfiler (`#2209`).

## 1.1.36 (2026-08-28)

### Funktioner

- **Live-modelltestning och autentiseringsverifiering vid introduktion** – Introduktionen testar nu aktivt ändpunktsautentisering och profilmodeller (`Deep`, `Balanced`, `Quick`) med live-promptförfrågningar innan navigering tillåts, vilket blockerar ogiltiga modellnamn och packar upp kapslade proxyfelmeddelanden till tydliga meddelanden.
- **Prioritetskonstanter för modellprofiler och leverantörsenums** – Ersatte ternära kaskader med deklarativa prioritetstabeller (`ModelProfilePriorities`) och enums (`ModelProviderKind`, `ModelProfileKind`) för konsekvent standard- och kandidatmodellmatchning över introduktion och inställningar.
- **Reservdistribution av Promptware på begäran** – Lade till automatisk reservdistribution i `PromptwareRunner` och `PromptwareRunCommand` för att extrahera saknade promptwares från inbäddade resurser på begäran om `Program.md` saknas.

### Förbättringar

- **Prioritet för medföljande Ivy Agent-binär** – Tvingade matchning av medföljande eller Tendril-hanterade `ivy-agent`-binärer (`~/.tendril/bin`), vilket förhindrar att ohanterade körbara filer i systemets `PATH` stör agentkörningen.
- **Beständighet för anpassad modellinmatning i inställningar** – Fixade att anpassade modellnamnsinmatningar återställdes vid Enter eller omrendering i `CodingAgentSetupView`.
- **Borttagning av papperskorgsfunktion** – Tog bort den föråldrade Papperskorg-appen och dess kommandosvit och ersatte papperskorgsmarkörer med ren hantering av dupliceringsavvisning i `CreatePlan`.

## 1.1.35 (2026-08-28)

### Funktioner

- **Delningslägestunnel och extern delning `[Beta]`** – Dela plan- och utkastlänkar externt över Cloudflare-tunnlar på ett säkert sätt med automatisk delnings-URL-generering och kopieringsåtgärder, bakom betaflaggan (`beta: true` i inställningar eller `TENDRIL_BETA`).
- **Sessionsskydd för delat läge** – Lade till lösenordssessionsskydd med Argon2-hashning i Inställningar under en enhetlig "Säkerhet och tunnling"-sektion.
- **Anonyma granskarpersonor** – Genererade vänliga anonyma personor med initialförsedda avatarer för externa medarbetare som granskar delade planer.
- **Infogade kommentarer för diff i utkast och planer** – Lade till infogade granskarkommentarer i realtid på diff-stycken i granskningsläge (`DraftDiffCommentService`) med en dedikerad "Begär ändringar"-åtgärd och brickantal.
- **Textmarkeringsannoteringar i utkast** – Lade till textmarkeringsframhävning och popovers förankrade till teckenförskjutningar i `DraftMarkdown` (`DraftAnnotationService`).
- **Teamkonfigurationsvalv `[Beta]`** – Introducerade centraliserad synkronisering av teamkonfiguration med stöd av Git-arkiv (`VaultService`, tillgänglig under betaflaggan), vilket gör det möjligt för team att skapa, ansluta, importera och pusha projektkonfigurationer till fjärrvalv med automatisk hemlighetssanering (`VaultSecretSanitizer`).

### Förbättringar

- **Jobbhärkomst och profilregistrering** – Registrerade körningsprofiler per jobb och strukturerad kostnadsarkshärkomst som fakta.
- **Isolering av betafunktioner** – Säkerställde att delningsknappar, tunnelkontroller och valvkonfigurationer är tydligt isolerade bakom betaflaggor i både användargränssnittet och kommandolagren.

### Buggfixar

- **Paketering för Windows Desktop** – Fixade paketeringsfel genom att använda junk-path zip-extrahering för medföljande `ivy-agent.exe` på Windows x64- och arm64-byggen.

## 1.1.34 (2026-08-25)

### Funktioner

- **Inbäddad PTY-terminal för granskningsåtgärder** – Granskningsåtgärder körs nu i en responsiv inbäddad terminalflik driven av Xterm (`ReviewActionApp`) istället för att starta externa terminalfönster.
- **Medföljande Ivy Agent CLI** – Paketerade den fristående körbara filen `ivy-agent` direkt med Tendril-installationsprogrammet, vilket tar bort manuella installationskrav.
- **Ta med din egen LLM (BYO LLM) och modellkataloger** – Lade till leverantörskataloger och modellväljare för BYO LLM-konfigurationer och Ivy Proxy över introduktion och inställningar, med stöd för Gemini 3.7 Flash, Claude-modeller och OpenAI-resonemangsmodeller.
- **Val av resonemangsinsats för modell** – Introducerade insatsnivåväljare (low, medium, high) för stödda resonemangsmodeller i inställningar för kodningsagentprofiler.
- **Anpassade MCP-servrar och agentfärdigheter** – Lade till stöd för att importera MCP-servrar och anpassade färdigheter direkt från Git-arkiv, fjärr-URL:er och lokala filsökvägar, komplett med hanteringsgränssnitt och validering.
- **Token- och kostnadsfördelningsark** – Introducerade interaktiva ark för tokenanvändning och kostnadsfördelning tillgängliga direkt från Jobbkostnadsceller i Jobbtabellen.
- **Worktree-organisation över flera repon** – Strukturerade plan-worktrees under `Worktrees/<owner>/<repo>`-sökvägar för att stödja uppsättningar med flera repon och komplexa projektlayouter.
- **Tangentbordsnavigering och flikhantering** – Lade till kortkommandostöd för `Cmd+W` / `Ctrl+W` för att stänga aktiva flikar i fristående Tendril, och finjusterade macOS Command-kortkommandoindikatorer (`⌘`) över dialogrutor.

### Förbättringar

- **Prestandaoptimering för utkast och granskning** – Minskade latensen vid planbyte och overhead vid flikbyte dramatiskt i både Gransknings- och Utkastsapparna.
- **Skalbarhet för Jobs DataTable** – Optimerade DataTable-rendering och datasynkronisering för att sömlöst hantera över 100+ aktiva och historiska jobb utan att gränssnittet hackar.
- **Chattkö och statusindikatorer** – Designade om panelen för köade meddelanden i Chatten med infogade kontroller, och lade till genereringsstatusbrickor i realtid i sidofältet.
- **Förankring av utkastannoteringar** – Förankrade markeringspopovers och verktygsfältsmarkeringar till textens teckenförskjutningar i DraftMarkdown för att förhindra förskjutning vid rullning.
- **Visning av Worktrees basgren** – Visade uppströms basgrens-forkpunkter i Git-fliken i Review och lade till grenspårning i översikten för Pull Requests.
- **Undertryckande av skrivbordsaviseringar** – Undertryckte redundanta toast-aviseringar i appen när inbyggda skrivbordsaviseringar från operativsystemet visas.
- **Omdesign av inställningsgränssnitt** – Refaktorerade projektinställningslayouten med projektfärgprover, hopfällbara anpassade färdighets-/MCP-kort och standardiserad knappstorlek.

### Buggfixar

- **Skydd för opushade commits i worktrees** – Stoppade worktree-rensaren från att göra opushade plan-commits föräldralösa eller radera dem under bakgrundsrensning.
- **Fästning av rubrik för verktygsanrop** – Säkerställde att rubriker för agentverktygsanrop fäster vid toppen av visningsområdet under långa strömmande utdata.
- **Falska jobbfel vid återställda verktygsfel** – Förhindrade att Antigravity-jobb felaktigt misslyckades när agenten lyckades självläka efter ett initialt verktygsfel.
- **Skiftlägesokänslighet för GitHub PR-URL:er** – Stödde skiftlägesokänsliga arkiv-URL:er (`Https://`, `Git@`, etc.) under GitHub-import och PR-operationer.
- **Bevarande av spann i Markdown-länkputsaren** – Fixade att planlänksersättning i markdown-putsaren inte korrumperar kapslade planspann.
- **Stabilitet i introduktionsflödet** – Fixade att introduktionen hängde sig när en agentinstallation misslyckades eller när nödvändiga binärer tillfälligt saknades.

## 1.1.19 (2026-07-28)

### Funktioner

- **Stöd för Claude Opus 5** – Lade till stöd för modellen `Claude Opus 5` (`claude-opus-5`) i Claude-katalogen med uppdaterad prismetadata.
- **Massavbrytning av jobb** – Introducerade rubrikåtgärderna "Stoppa alla jobb" och "Stoppa alla köade" i `JobsApp` (`IJobService.StopAllJobs` och `StopQueuedJobs`) för masshantering av jobb.
- **Minnesrensning i Promptware** – Lade till CLI-kommandot `promptware delete-memory` och firmware-kapacitet, vilket gör det möjligt för promptwares att ta bort föråldrade minnesfiler.
- **Minnesreferensmatchning** – Matchar automatiskt minnesreferenser i CLI-kommandot `read-memory` istället för att ge fel när refererade anteckningar begärs.
- **Konfigurerbar Ollama Agent-URL** – Lade till konfigurerbart alternativ för bas-URL (`--url`) för lokala Ollama-agentändpunkter.
- **Kapacitet för import av ärenden** – Utökade gränsen i dialogrutan Importera ärenden från 100 till 1 000 ärenden med avkortningsvarningar när maxgränsen nås.
- **Beständighet för aktiva jobbtillstånd** – Sparade aktiva pågående jobb i SQLite-databasen så att jobbstatusuppdateringar överlever omstarter av masterprocessen.
- **Automatisk konfiguration av CLI PATH i Windows** – Skapar automatiskt `tendril.cmd`-omslag och registrerar applikationskatalogen i Windows användar-PATH vid appstart och Velopack-installationskrokar.

### Förbättringar

- **Sammanslagning av automatisk tunneluppdatering** – Slog samman frekventa automatiska inkorgsuppdateringar och villkorade `JobsApp`-celluppdateringar baserat på dataändringar, vilket stoppade överdrivna uppdateringar över Cloudflare-tunnelanslutningar.
- **Sekventiell agentläsningsoptimering** – Minskade processuppstartsoverhead under sekventiella filläsningar av kodningsagenter.
- **Valuta i instrumentpanelens kostnadsdiagram** – Lade till valutaindikatorer ($) till stapelserierna i kostnadsdiagrammet på instrumentpanelen.
- **Formatering av jobbtabell** – Plattade till markdown-länkar och formatering i kolumnen prompt/titel i jobbtabellen för renare tabellutdata.
- **Omdirigerad CLI-utdata och JSON-stöd** – Lade till ASCII-reserver för omdirigerad CLI-tabellrendering och introducerade utdataflaggan `--json` för `tendril verification list`.
- **Omdirigering av äldre .NET-verktyg** – Lade till doctorkontroller och automatisk omdirigering för att dirigera äldre `.NET`-verktygsanrop (`ivy-tendril`) till den installerade Tendril-CLI:n.
- **Omdesign av dokumentation** – Designade om `README.md` enligt Orca-layouten med uppdaterade funktions-GIF:ar.

### Buggfixar

- **Validering av projektnamn** – Lade till strikt projektnamnsvalidering över CLI, inställningsdialogrutan och introduktionsflödet för att avvisa ogiltiga namn och förhindra krascher under installationen.
- **CLI-startoverhead** – Förhindrade Tendril-servern från att starta när `--help`, `-h` eller okända argument skickas till `tendril`.
- **404-rapportering för jobbstatus** – Gjorde ändpunkterna `tendril job status` och `tendril job fail` till bästa försök istället för att kasta ödesdigra 404-fel.
- **Varning för duplicerad analysator** – Tog bort duplicerad `Ivy.Analyser` PackageReference i `Ivy.Tendril.csproj`, vilket eliminerade NU1504-varningar, och uppdaterade `UpdateIvyPackages.ps1` för att redigera versioner på plats.
- **Shellexekvering i PlatformHelper** – Satte `UseShellExecute` explicit till `false` för kommandona `open` (macOS) och `xdg-open` (Linux) i `PlatformHelper`.

## 1.1.16 (2026-07-24)

### Funktioner

- **Integration av Ivy Agent** – Introducerade integration för den fristående Ivy Agent, inklusive ett en-klicks CDN-installationsprogram i Inställningar, anpassade Ivy Proxy-URL-inställningar och betaflaggstyrning (`TENDRIL_BETA` eller `IVY_BETA`).
- **Kompakta brickväljare** – Ersatte projekt- och prioritetsväljare i full bredd i dialogrutan Skapa plan med rullningsbara kompakta brickknappar (`BadgeSelect`-widget).

### Förbättringar

- **DNS-diagnostik för Cloudflare-tunnel** – Visade detaljerade start- och anslutningsdiagnostikmeddelanden för `cloudflared`-tunnelfel.
- **Rensning av inställningsvy** – Refaktorerade inställningsinmatningar för att använda inbyggda C# `.Description(...)`-byggaregenskaper för visuell konsekvens.

### Buggfixar

- **Lagring av dialogrutan Lägg till projekt** – Gjorde så att knappen "Nytt projekt" i Skapa plan öppnar dialogrutan Lägg till projekt direkt ovanpå utan att navigera bort.
- **Tolkning av tunnel-URL** – Fixade extrahering av URL för cloudflared-tunnel genom att ignorera interna `api.trycloudflare.com`-domänreferenser.

## 1.1.14 (2026-07-21)

### Funktioner

- **Dokumentation av tredjepartsmeddelanden** – Lade till `THIRD_PARTY_NOTICES.md` för att dokumentera licenser för medföljande tredjepartsberoenden.

### Förbättringar

- **Optimistiskt tillstånd för ContentInput** – Implementerade optimistiska lokala texttillståndsuppdateringar i `ContentInput`-widgeten, vilket skjuter upp bakgrundsegenskapsuppdateringar medan man skriver för att förhindra att inmatning skrivs över.

### Buggfixar

- **Nedladdare för Cloudflared** – Löste en installationskrasch i det automatiska installationsprogrammet och nedladdaren för binären `cloudflared`.
- **Felanalys för Codex** – Fixade felparsning för kodningsagenten Codex och validering av modellkatalog.
- **Layout för tunnelinställningar** – Korrigerade stavfel och layoutfel i skärmen för inställning av tunnel.

## 1.1.13 (2026-07-20)

### Funktioner

- **Implementering av batchrekommendationer** – Batchmarkera och implementera flera rekommendationer samtidigt i Granskningsappen.
- **Undersök och diskutera med agent** – Lade till åtgärdsknapparna "Undersök med agent" och "Diskutera med agent" i Utkast, Granskning och jobbfelsökningsarket.
- **CLI-kommando för att lägga till worktree i plan** – Lade till CLI-kommandot `tendril plan add-worktree` för symmetrisk worktree-hantering.
- **Kör slutförda RetryPlan-jobb igen** – Lade till möjligheten att köra slutförda `RetryPlan`-jobb igen direkt från jobblistan.

### Förbättringar

- **Automatisk omladdning av konfiguration** – Ladda automatiskt om konfigurationen vid externa filredigeringar.
- **Granskningssammanfattning och flikar** – Renderade granskningssammanfattningen som DraftMarkdown med fäst verifieringskort och extraherade granskningsflikar till dedikerade vyer.
- **Konsolidering av jobbloggar** – Konsoliderade alla jobbkörningsloggar under en enhetlig `<TendrilHome>/Jobs/`-katalog.
- **Markering av sidofält och tabellrader** – Förbättrade sidofältslistobjekt och datatabeller med fylld bakgrundsmarkeringsstil.
- **Uppdatering av skrivbordsramverk** – Uppdaterade Ivy-ramverksberoenden till 1.3.8 och konfigurerade detaljer i skrivbordets Om-dialogruta.

### Buggfixar

- **Bevarande av tillstånd vid jobbborttagning** – Bevarade slutfört plantillstånd vid borttagning av avslutade jobb.
- **Markdown- och matematikrendering** – Fixade att prosadollartecken renderades som LaTeX-matematik och fixade infogad kodstil i DraftMarkdown.
- **Semaforläcka för jobbluckor** – Fixade en semaforläcka vid tilldelning av jobbluckor under ohanterade startfel.
- **Hängning i jobbstartläge** – Fixade att jobb hängde sig på obestämd tid i startläge genom att lägga till starffelshantering.
- **Synkronisering av worktree-commits** – Säkerställde att commits från alla plan-worktrees synkroniseras korrekt.

## 1.1.12 (2026-07-03)

### Förbättringar

- **Dotnet-verifieringslösare** — Uppdaterade verifieringsprompterna `DotnetBuild`, `DotnetFormat`, `DotnetTest` och `FrameworkDotnetBuild` för att lokalisera lösningsfilen explicit. Lade till avgränsningsanteckningar för konfigurationer med flera arkiv, vilket säkerställer tillförlitliga byggen och tester.
- **UI-layout för Pull Request** — Ändrade ordning på kolumnerna i PullRequest-appen för att visa Plan först och Arkiv sist, och minskade kolumnerna Kostnad och Tokens till 80px för en mer kompakt och läsbar tabellayout.

### Buggfixar

- **Samtidigt byte av CreatePr-brödtext** — Fixade ett kapplöpningstillstånd där samtidiga `CreatePr`-jobb kunde byta ut eller skriva över varandras pull request-beskrivningar på grund av icke-unika filer för brödtext. Växlade till `mktemp` för unikt skapande av textfiler och lade till regressionstester.
- **Kapplöpning i delad händelseparser** — Löste ett kapplöpningstillstånd vid händelsetolkning genom att isolera parsers per session istället för att dela parserinstanser. Lade till regressionstester för att förhindra framtida kapplöpningstillstånd med flera sessioner.

## 1.1.11 (2026-07-03)

### Buggfixar

- **Fix för macOS-installerare och start** — Fixade ett kritiskt problem där macOS-installationsprogrammet (.pkg) slutfördes framgångsrikt men misslyckades med att installera eller starta applikationen på grund av trasiga symlänkar och kodsigneringssignaturer under ompaketering. Ersatte `pkgutil --expand-full` med `pkgutil --expand` för att bevara appens nyttolastintegritet, korrigerade målkatalogen till `1.pkg/Scripts/postinstall` och fixade ett sökvägsfel i skriptet för att lita på localhost-certifikat.

## 1.1.10 (2026-07-03)

### Buggfixar

- **Notarisering av macOS-installerare** — Fixade notarisering av macOS-installationsprogram genom att korrekt skicka in och häfta det ompaketerade installationspaketet.

## 1.1.9 (2026-07-03)

### Funktioner

- **Filinmatning för Promptware** — Lade till stöd för filbaserad innehållsinmatning till promptware-skrivkommandon, vilket gör det möjligt för promptwares att läsa in lokala filer under körning.
- **CLI för återställning av planrevisioner** — Lade till ett nytt `plan get-revision`-CLI-kommando för att hämta och inspektera historiska revisioner av en plan.
- **SyncRepo-policy för ospårade ändringar** — Lade till konfigurerbara policyalternativ för ospårade ändringar (Stash/Commit/PullRequest) för SyncRepo-körning.
- **Antigravity CLI-examinering** — Uppgraderade Antigravity CLI-integrationer och kontroller till fullt stabil status.

### Förbättringar

- **Universell felrapportering** — Möjliggjorde felrapportering under alla agenter genom att normalisera målmodeller till backend-stödda familjer och lägga till ursprungliga agentmetadata, och fixade felrapportering på macOS genom att rekursivt samla in planfiler och ignorera worktree-mappar tidigt.
- **CLI-reserver för verifiering** — Kommandona för `verification` listar nu automatiskt alla tillgängliga verifieringsskript om det angivna verifieringsnamnet inte hittas.
- **Widgetstilar för DraftMarkdown** — Synkroniserade stilen för DraftMarkdown-widgeten med de senaste uppdateringarna av kärndesignsystemet.

## 1.1.8 (2026-07-03)

### Funktioner

- **Självuppdateringskapacitet för skrivbordsapplikation** — Implementerade självuppdateringskapacitet och dialogruta, vilket gör att skrivbordsapplikationen automatiskt kan kontrollera och uppdatera sig själv till den senaste versionen.
- **Bevarande av verktygsmapp** — Bevarar katalogen `Tools/` under uppgraderingar av promptware och garanterar att promptwares körtidsmappar är korrekt strukturerade.

### Förbättringar

- **Kortkommando i Drafts-appen** — Lade till kortkommandot `Backspace` för att utlösa åtgärden Ta bort i Drafts-appen (löser #1507).
- **Responsiva layoutavstånd** — Justerade om knappen för ärendelänk i den responsiva rubriken för att förhindra överlappning och textradbrytning.

## 1.1.7 (2026-07-02)

### Funktioner

- **Generering av HTTPS-certifikat för localhost** — Generera och paketera säkra SSL/TLS-certifikat för localhost automatiskt för skrivbordsapplikationer på macOS och Windows, vilket möjliggör lokal HTTPS direkt vid installation.
- **Förbättring av dialogrutan Skapa plan** — Lade till en direkt "Nytt projekt"-genvägslänk till dialogrutan Skapa plan för snabbare introduktion.
- **Val av Claude Fable 5** — Lade till `Claude Fable 5` som ett valbart modellalternativ i modellkonfigurationer.
- **Integration av Config CLI och MCP** — Lade till förstklassiga `config get`- och `config set`-kommandon till Tendril CLI och Model Context Protocol (MCP)-serverändpunkter.
- **Experimentet FieldToolsDemo** — Introducerade ett nytt `FieldToolsDemo`-experiment för utvecklartestning.

### Förbättringar

- **Optimistisk jobbborttagning** — Gjorde jobbborttagning optimistisk genom att delegera uppgifter för rensning av git-worktrees till bakgrundstrådar, vilket ger snabbare gränssnittsrespons.

### Buggfixar

- **CI-arbetsflöden och skript** — Fixade ett YAML-syntaxfel i publiceringsarbetsflödet, löste krascher vid generering av SSL-certifikat i CI-pipelines och korrigerade ett syntaxfel i macOS-efterinstallationsskriptet.

## 1.1.6 (2026-07-02)

### Funktioner

- **Förstklassig felrapportering** — Lade till CLI-kommandot `tendril job fail <job-id> --message` som gör det möjligt för promptwares att rapportera specifika exekveringsfel explicit istället för att förlita sig på slutkoder och rå stdout-heuristik.
- **Automatisk uppdatering av inkorg** — Ersatte intervallbaserad avsökning i apparna Drafts, Review, Icebox, Recommendations och Trash med prenumerationsbaserade uppdateringar med hjälp av en avstudsad processstatus och filsystembevakare.
- **Konsolidering av Velopack-uppdaterare** — Konsoliderade skrivbordets självuppdateringsflöde till Velopack, vilket möjliggör sökning efter uppdateringar i Inställningar, bevarar avfärdade uppdateringar över omstarter och tog bort det föråldrade projektet `Ivy.Tendril.Updater`.
- **UserQuestion-widget** — Lade till en ny `UserQuestion`-widget och visare för interaktiva användarprompter.
- **Introduktionsguide** — Lade till en förstklassig introduktionsguide i Komma igång-dokumentationen.
- **Förbättringar för nya planer** — Lade till en projektvalsknapp direkt i dialogrutan Skapa plan och döpte om `CustomPrDialog` till `CreatePrDialog`.

### Förbättringar

- **Säkerhet för Windows-sökvägar och skal** — Ersatte skalsäkra tecken (pipes och parenteser) i projektkonfigurationen för `stackHash` med `/` och `.ts`-tillägg, och implementerade argumentersättning för Windows CLI.
- **Nätverksåtkomst för agentsandlåda** — Aktiverade sandlådebaserad nätverksåtkomst för Codex via inställningen `sandbox_workspace_write.network_access`, vilket fixade PermissionError vid socket-bindningsoperationer.
- **Stöd för lokal Ollama i OpenCode** — Kringgick autentiseringskontroller och matchade den binära sökvägen automatiskt när OpenCode körs med en lokal Ollama-modell, och växlade till `--auto`-exekvering för att förhindra PTY-hängningar.
- **Hantering av Markdown-länkar** — Centraliserade putsning av markdown-länkar för planrevisioner och renderingssäkerhetskontroller för att ta bort radnummerankare från fil-URL:er.
- **GitHub-användarnamn i felrapport** — Lade till ett valfritt fält för GitHub-användarnamn i felrapportdialogrutan och CLI-kommandot `report-bug`.
- **Finjusteringar av UI-layout** — Dolde panelen för tunnel-QR-kod på mobil-/surfplatteskärmar, kapslade in laddningssnurran i startrutan, fixade ikonen för "Stopp"-knappen och återställde avstånd i layouten för granskningsåtgärder.
- **Textavradbrytning för Gemini** — Lade till textavradbrytning för Geminis hårda radbrytningsformatering för att förbättra läsbarheten.
- **Stil för tangentbordselement** — Lade till stil för `<kbd>`-element i markdown-widgeten.

### Buggfixar

- Fixade jobb som hängde sig på obestämd tid i förstartsfönstret på grund av dödlägen eller inaktuell utdata genom att aktivera tidsgränser omedelbart och köra före-krokar samtidigt.
- Fixade att rullningspositionen på skärmen Skapa plan återställdes/hoppade till toppen vid navigering mellan flikar.
- Fixade beräkning av jobbkostnad för körningar med tidsgräns genom att falla tillbaka på prisbaserade beräkningar när infogad kostnad är noll eller saknas.
- Fixade att CreatePr-planer låg kvar i Utkast när agenter hoppade över avslutningssteg genom att automatiskt tolka PR-URL:er från utdata vid slutförande.
- Fixade skräppost i startloggar för sessioner och tankstrecksformatering i mastervalsloggar.
- Fixade EPERM-lyssningsfel vid start genom att binda testservrar till loopback.
- Fixade att utdata från Codex-agenten kollapsade till nollhöjd under körning.
- Fixade tangentbordsfokus/oskärpeproblem och autofokuserade inmatningen när dialogrutan Ny plan öppnas.
- Inaktiverade den oanvända Tunnelfunktionen i standardkonfigurationen.

## 1.1.1 (2026-06-25)

### Funktioner

- **Röst och rik planinmatning** — Den nya ContentInput-widgeten ger rösttranskribering och filbilagor till dialogrutan Skapa plan; filer laddas upp via HTTP POST och lagras tillsammans med planen, med stöd för dra-och-släpp.
- **Chatta med agent** — Beta-AgentApp låter dig chatta direkt med kodningsagenten över en PTY, med en "Chatta med agent"-knapp i dialogrutan Ny plan och `tendril`-CLI:n exponerad för agenten via en shim.
- **Planannoteringar** — Annotera utkast i DraftsApp för att driva annoteringsbaserade planuppdateringar.
- **Stöd för mobil och surfplatta** — Tendril är nu responsivt över brytpunkter för mobil, surfplatta och skrivbord, med anpassningsbara rubriker, ark, väljare och processvisare.
- **DraftMarkdown-widget** — Renderar Mermaid- och Graphviz-diagram, callouts, lokala filer och klickbara bilder samt infogade textannoteringar.
- **Automatiska uppdateringar med Velopack** — Skrivbordsappen självuppdateras via Velopack, med skydd mot namnkonflikter för installationsprogram.
- **Aktivitetsvärmekarta** – Wallpaper-appen visar en 90-dagars aktivitetsvärmekarta över slutförda PR.
- **SyncRepo och preflight-kontroll för smutsigt arkiv** — Ny SyncRepo-promptware plus en preflight-kontroll som upptäcker och löser smutsigt arkivtillstånd före Kör och Skapa plan.
- **Jobbberoenden** — Blockering på jobbnivå med `WaitForJobs` och kaskadfel, periodisk omvärdering av blockerade jobb och en Tvinga start-åtgärd för blockerade jobb.
- **Kör igen med feedback** — Kör ett jobb igen med ytterligare feedback till agenten.
- **Återställ revision** — Återställ en specifik planrevision direkt från fliken Detaljer.
- **Rensare för inaktuella worktrees** — Begränsar diskutrymme för worktrees genom att rensa inaktuella worktrees från tidigare körningar.
- **HTTP-baserad CLI/server-IPC** — CLI och server kommunicerar över HTTP med masterval för tillförlitlig samordning av enstaka instanser.
- **Medföljande körtider** — .NET 10 SDK och PowerShell 7 medföljer i installationsprogram och matchas dynamiskt vid körning när de finns.
- **Skyddsräcken för arkiv** — Planer skyddas mot att köras eller slås samman i arkiv utanför sitt projekt, och arkivets standardgren upptäcks istället för att anta `main`.
- **Ramverk för planmigrering** — Lade till `schemaVersion` i `plan.yaml` med ett ramverk för planmigrering per fil.
- **Miljövariabler för kodningsagenter** — Konfigurera miljövariabler per agent i inställningarna för kodningsagenter.
- **Kommandot `tendril agent-instructions`** — Mata ut agentinstruktionerna från CLI:n.

### Förbättringar

- **Finjustering av tunnel** — Anslutningsstatus, QR-kod för bakgrundsbild, Öppna i webbläsare, detektering av dirigerbar före ansluten, rensning av föräldralösa `cloudflared` och inaktivering med ett klick med optimistiskt gränssnitt.
- **Verifieringar som enda sanningskälla** — `plan.yaml` är nu sanningskällan för verifieringar, med ett dedikerat UI-kort, status-enum och dra-och-släpp-ordning i projektredigeringsdialogen.
- **Felsökningsark för jobb** — Lade till arbetskatalog och CLI-argument, kopieringsknappar för plan-/jobb-ID:n, en Rapportera fel-knapp och promptware-lärdomar (minnes-/verktygsskrivningar); döljer tomma rader och nekade behörigheter.
- **Namnbyten på plantillstånd** — `Building → Creating` och `ReadyForReview → Review` för tydligare namngivning av livscykeln.
- **CLI-konsolidering** — Enkanalsloggning, enhetlig undantagsspridning, beskrivande jobbstatusutdata och lade till Web API/MCP-ändpunkter för fullständig CLI-paritet.
- **Förenklade rekommendationer** — Tog bort riskfältet från rekommendationer i hela användargränssnittet och prompterna.
- **Fristående macOS-app** — Robust PATH- och miljöinläsning för inloggningsskal, korrekt detektering av paketerad app och automatiskt skapande av global `tendril`-symlänk.
- **Omstrukturering av widgets** — Konsoliderade widgets till ett enhetligt `Ivy.Tendril.Widgets`-projekt med frontend-kataloger per widget.
- **Arbetsflöde för automatisk sammanslagning** — CI-arbetsflödet slår automatiskt samman `main` tillbaka till `development` efter release.
- **Beroendesäkerhet** — Uppgraderade `SQLitePCLRaw.lib.e_sqlite3` till 3.50.3 och låste frontend-beroenden (dompurify, vite-plus) för att hantera kända sårbarheter.

### Buggfixar

- Fixade argumenttolkning för bindestrecksvärden i `tendril plan create`.
- Fixade SQLite "database is locked"-fel via en delad anslutningsfabrik och `busy_timeout`.
- Fixade att avbrutna/stoppade/misslyckade jobb återställde planer till sitt tidigare tillstånd.
- Fixade att PR-sammanslagning berodde på en inaktuell `prRule` istället för flaggan `PrMerge`.
- Fixade att utkast inte uppdaterades efter ändringar.
- Fixade återkommande fel vid Skapa PR och missvisande felmeddelanden.
- Fixade att vänsterutfyllnad i Review och Drafts markdown inte renderades.
- Fixade att verifieringsordning inte sparades i dialogrutan Redigera projekt.
- Fixade beräkning av jobbkostnad för att köras för alla statusar med hjälp av infogad resultatdata.
- Fixade kapplöpningstillstånd med förlorad skrivning i `plan.yaml` när en rekommendation accepteras.
- Fixade krasch vid navigering till Drafts/Review med en ogiltig plan.
- Fixade kapplöpningstillstånd vid avblockering av `WaitForJobs` och detektering av dubbla jobb.
- Fixade att IvyFrameworkVerification lämnade kvar zombieprocesser efter testkörningar.
- Fixade krascher vid parsning av användningsstatistik för Copilot med defensiv parsning.
- Fixade Spectre.Console-krasch från oavgränsad markup i doctor-utdata.
- Fixade startkrasch vid introduktion på macOS och Windows när `TENDRIL_HOME` är tomt.
- Fixade duplicerat Default-alternativ i rullgardinsmenyer för modeller i kodningsagentprofiler.
- Fixade saknad ikon i Windows aktivitetsfält.
- Fixade att ACL-behörigheter för planmapp blockerade ExecutePlan.
- Fixade att dubbla SyncRepo-jobb köades för samma arkiv.
- Fixade namnkonflikt för ContentInput efter att ramverket lade till sin egen widget.
- Fixade JS `SyntaxError` på äldre WebKit genom att rikta in sig på es2020.

## 1.0.39 (2026-05-28)

### Funktioner

- **Gemini-agentleverantör** — Lade till Gemini CLI (`gemini`) som en stödd kodningsagent, med fullständig hälsokontroll, autentisering och sessionskostnadsspårning.
- **Tunnelstöd** — Fjärråtkomst via Cloudflare-tunnlar med QR-kod i Inställningar, automatisk server-redo-detektering och kontroller för dirigerbar före ansluten.
- **Dialogruta för agenttest** — Ny Test Agent-knapp i Inställningar som automatiskt kör installations-, autentiserings- och modellkontroller för alla konfigurerade agenter.
- **Modellval per profil** — Välj specifika modeller per insatsprofil (deep/balanced/quick) i inställningarna för kodningsagenter.
- **Modellkataloger per leverantör** — Ersatte global `models.yaml` med kataloger per leverantör och ett `tendril models`-CLI-kommando.
- **Kommandot `tendril update`** — Självuppdatering med Photino GUI-uppdaterare.
- **Injektion av planmall** — Planmallar injiceras i firmware; faktisk modell som används spåras per jobb.
- **Mänskligt läsbara verktygstitlar** — Fältet Description på ToolCallWire för tydligare visning av agentutdata.
- **Sandlådebaserad agentfilåtkomst** — Agenter får skrivbar åtkomst till mapparna TENDRIL_HOME, planer och promptware.
- **Alternativet `--search` för planlista** — Filtrera planer efter sökterm från CLI:n.
- **AgentApp med systemprompt** — Beta-agentchattapp med injicerad Tendril-systemprompt.
- **Skapa plan från skrivbordsunderlägg** — Ny Plan-knapp på bakgrundsbilden öppnar CreatePlanDialog direkt.
- **Knappen Kopiera alla detaljer** — Kopiera fullständiga jobbfelsökningsdetaljer till urklipp i jobbfelsökningsarket.
- **Utdrag av nyhetsbrevsvy** — Delad nyhetsbrevskomponent med bättre felrapportering.

### Förbättringar

- **Uppdelning av inställningar** — Allmänna inställningar uppdelade i flikarna Kodningsagent, Planer och Utseende.
- **Namnbyte PlansApp → DraftsApp** — Sidofältsbricka och navigering uppdaterade för att matcha.
- **Layout för inställningar av kodningsagenter** — Förbättrad layout med visningsnamn och standardmodellhantering för alla leverantörer.
- **CLI-finjustering** — Ren konsolformaterare, `--help` utan att starta servern, rent fel för okända kommandon, formatering av doctor-utdata.
- **Finjustering av AgentOutputView** — Verktygskort med utdata utan radbrytning, renare titlar, enhetligt avstånd, dold status vid slutförande.
- **Förbättringar av processvy** — Knappar med lika bredd, grå puls, semantiska färg-tokens för mörkt läge, deduplicerad krok.
- **TendrilProcessView-widget** — Lades till i lösningen med stöd för mörkt läge via semantiska färg-tokens.
- **Förbättringar av installationsskript** — Verifierad git-körning, lade till .NET 10 först i PATH, renare skript.
- **Beroendesäkerhet** — Låste versionsintervall för beroenden till exakta versioner för att förhindra kapnings- och förväxlingsattacker.
- **Validera basgren** — Förhindrar att projekt läggs till med ogiltiga basgrenar eller ogiltiga lokala arkiv.
- **Rå agentutdata** — Skrivs till `.raw.jsonl` istället för EventWire-format för bättre felsökning.
- **Copilot-förbättringar** — Växlade till stdin-prompt för Windows kommandoradslängdsbegränsning, fallback till `gh copilot` när fristående binär inte finns på PATH, tolkar uppdaterat JSON-format.
- **CodeBlock-widget** — Agentutdata och lösning använder CodeBlock istället för rå Markdown.
- **Tjänsteorganisation** — Tjänster refaktorerade till underkataloger; statuskonstanter extraherade.

### Buggfixar

- Fixade att processvyn visade omkastade antal för uppdaterande/exekverande planer.
- Fixade sökvägsbestämning vid introduktion när parametern tendrilHome är tom.
- Fixade oändlig laddningsskärm för "Ställer in agent" vid introduktion.
- Fixade databasmigrering 10→11 genom att göra Migration 11 idempotent.
- Fixade omvända snedstreck i .csproj-filer och sökvägsökning för promptwares vid introduktion.
- Fixade att Copilot-processen hängde sig med 5 sekunders STDIN-timeout.
- Fixade saknat ResolveCommandShim-anrop i PromptwareRunner.
- Fixade kommandoradslängdsbegränsning vid start av Gemini.
- Fixade att Codex `item.updated`-händelser sände UnknownEvent.
- Fixade standardmodeller för Copilot- och Codex-profiler i nya installationer.
- Fixade sidofältsbrickans nyckel från "plans" till "drafts" efter namnbyte.
- Fixade dubbla rubriker och styling i dialogrutan Lägg till projekt.
- Fixade felaktig indexmatchning i dialogrutan för projektredigering efter att projekt lagts till.
- Fixade att rullgardinsmenyn för modell inte visade alternativet Default.
- Fixade matchning av Windows PTY-kommando till filtillägget .cmd.
- Fixade null-modeller vid byte av agent.
- Fixade prefixet "undefined:" i jobbstatusmeddelanden.
- Fixade att duplicerat projektnamn blockerade introduktionen.
- Fixade parsning av rå agentutdata vid introduktion till EventWire i realtid.
- Fixade extra fönster och saknad ikon i aktivitetsfältet vid start av Windows-appen.
- Fixade att verktygsresultat i AgentOutputView inte renderades.
- Fixade parsning av Claude Code-verktygsresultat från användarmeddelanden.
- Fixade cloudflared 502 genom att läsa faktisk serveradress.
- Fixade OpenCode `model: default` för att hoppa över flaggan --model.
- Fixade mellanliggande step_finish-händelser för OpenCode i utdatavyn.

## 1.0.35 (2026-05-20)

### Funktioner

- **Inbyggda OS-toast-aviseringar** — Skrivbordsaviseringar för slutförda planer, fel och andra händelser, med en dedikerad Aviseringar-flik i Inställningar.
- **Aktivitetsfältsbricka** — Antal aktiva jobb visas i skrivbordets aktivitetsfältsbricka för snabb statusöverblick.
- **Guidebaserad Lägg till projekt** — Ny projektinställning använder nu ett guidat flöde som matchar introduktionen, med möjlighet att hoppa över för erfarna användare.
- **CLI-kommandot Move-verification** — Ändra ordning på verifieringar via `tendril project move-verification` med ordningsinstruktioner.
- **Omdesignad introduktion** — "Ditt första projekt" är nu ett 3-stegsflöde med ny projektinställning, progressiv feedback och nyhetsbrevsanmälan vid slutförande.
- **CLI CRUD-kommandon** — Fullständig CRUD för verifieringar och projekt via CLI:n (`tendril project get`, `tendril verification add/remove/move`).
- **Synkronisering av plan-commits** — Synkronisera plan-commits på begäran via knappen Synkronisera i Review.
- **CRUD-gränssnitt för ReviewAction** — Konfigurera granskningsåtgärder direkt från Inställningar och introduktion.
- **Kommandot `tendril reset`** — Återställ Tendril-tillstånd via CLI:n.
- **Kommandot `tendril report-bug`** — Skicka felrapporter med systemkontext direkt från CLI:n.
- **Kommandot `promptware read-memory`** — Inspektera promptware-minne från CLI:n.
- **Utkastläge för PR-skapande** — Möjlighet att skapa PR som GitHub-utkast.
- **Acceptera/avvisa rekommendationer** — Acceptera eller avvisa rekommendationer direkt i Granskningsappen, med filtrering på Slutförda planer.
- **Git-flik: Rutan Worktrees** — Visar information om överordnat arkiv och grupperar commits under worktree-sektioner.
- **Behåll worktrees vid misslyckade planer** — Worktrees för misslyckade planer bevaras för felsökning istället för att rensas bort.
- **OpenCode-agentleverantör** — Lade till OpenCode som en stödd kodningsagent.
- **Copilot CLI-agentleverantör** — Lade till GitHub Copilot CLI som en stödd kodningsagent.
- **CLI-flaggan `--plans-dir`** — Åsidosätt plankatalogen för E2E-testning och anpassade konfigurationer.
- **TendrilProcessView-widget** — Extern widget för att visualisera Tendril-processer.

### Förbättringar

- **Finjustering av Git-flik** — Ikoner på sektionsrubriker och tomt tillstånd, hierarkiskt träd med färgindikatorer för ändrade filer.
- **Stabilitet i fliken Ändringar** — Fixade blinkande under 30 sekunders bakgrundsrevalidering, expandera som standard-beteende och fullbreddslayout.
- **Rensning av fliken Granskning** — Tomma flikar för Artefakter och Rekommendationer är nu dolda; planvyer använder artikeltypografi.
- **Förenklade commit-meddelanden** — Tog bort plan-ID-prefix från instruktioner för commit-meddelanden för renare git-historik.
- **Förfinad Importera ärenden från GitHub** — Förbättrad användarupplevelse för importflödet av GitHub-ärenden.
- **Fönsterstorlek** — Uppdaterade standardfönstermått för att fungera korrekt på macOS Retina-skärmar, med tvingad minimistorlek.
- **Förbättringar av RetryPlan** — Lägger till fixsektioner i befintlig sammanfattning, tydliggör konfiguration för multi-repo worktree, strömmar rålogg till disk.
- **VerbosityService borttagen** — Ersattes med standard ILogger-nivåer för enklare loggningskonfiguration.
- **Extrahering av ServiceRegistration** — Tjänstregistreringar flyttades från TendrilServer till en dedikerad `ServiceRegistration.cs`.
- **Kodkvalitet i introduktion** — Extraherade hjälpare, lade till AgentOnboardingInfo, primära konstruktorer och förbättrade UX-texter.
- **Verktygsbehörigheter i Promptware** — Uppdaterade standardverktygsbehörigheter för säkrare agentkörning.
- **Omstrukturerad CLI-dokumentation** — Omfattande omskrivning av CLI-referensen med uppdaterad kommandosyntax och exempel.
- **Fullbredds-markdown i planvyer** — Rullningsbart innehåll med maxbreddsbegränsning för läsbarhet.
- **Responsiv jobbtabell** — Hög densitet på surfplatta, medel på skrivbord för bättre utrymmesutnyttjande.
- **Ta bort generera verifieringar** — Borttagen från dialogrutan för projektredigering till förmån för CLI-baserad verifieringshantering.
- **Ramverksundantag dolda** — Ramverksinterna undantag visas inte längre som användarriktade aviseringar.

### Buggfixar

- Fixade att återställning till utkast inte uppdaterade användargränssnittet omedelbart efter bekräftelse.
- Fixade att projektverifieringsordning inte bevarades i introduktionens granskningssteg.
- Fixade att introduktionssteg fastnade efter att förloppet slutförts.
- Fixade blinkning av "Ingen sammanfattning tillgänglig" när en plan öppnas i Review.
- Fixade att fliken Ändringar blinkade var 30:e sekund under bakgrundsrevalidering.
- Fixade att testparallellism förorenade TeamIvyConfig `config.yaml`.
- Fixade att commit-hashar lagrades som korta hashar i synkroniseraren – lagrar nu fullständiga hashar och uppdaterar användargränssnittet efter synkronisering.
- Fixade att commits förlorades över RetryPlan-körningar.
- Fixade kommandosökvägar för granskningsåtgärder till att använda citerad PowerShell-syntax.
- Fixade felavisering när dialogrutor avbryts med ESC.
- Fixade skiftlägesmigrering för undermappar och trasiga rensningstester.
- Fixade korruption av `plan.yaml` under UpdatePlan-körning.
- Fixade duplicerat innehåll i Agent Output under liveströmning.
- Fixade att jobbutdata renderades två gånger när jobbet slutfördes.
- Fixade fel vid matchning av PromptwareRoot som orsakade saknade promptwares.
- Fixade avstånd och position för toasten Uppdatering tillgänglig.
- Fixade ofullständigt meddelande "Du har ." i WallpaperApp.
- Fixade saknad applikationsfönsterikon genom att uppdatera resursnamn.
- Fixade att `gh auth status` misslyckades med flera GitHub-konton.
- Fixade att utdataarket visade en tom panel för slutförda jobb.
- Fixade felaktigt ReportedPlanId när ingen matchande planmapp finns.
- Fixade sortering i jobbtabellen för att visa de senaste jobben först.
- Fixade att slutförda jobb filtrerades bort vid omstart.
- Fixade att delegerad verifieringsanropssyntax orsakade fel i IvyFrameworkVerification.
- Fixade att knappen Slutför installation hängde sig på obestämd tid under introduktionen.
- Fixade oändlig hängning vid start av bakgrundstjänster.
- Fixade problem med fliknamnsomfång i Review.

## 1.0.22 (2026-04-27)

### Förbättringar

- **Felhantering med GitResult\<T\>** — Introducerade en typad returtyp `GitResult<T>` i GitService för konsekvent, explicit felhantering istället för undantag.
- **Extrahering av DashboardRepository** — Extraherade `GetDashboardData` till ett dedikerat DashboardRepository, vilket separerar dataåtkomst från affärslogik.
- **Gränssnittet ISessionParser** — Extraherade sessionstolkning bakom ett `ISessionParser`-gränssnitt för testbarhet och framtida parser-varianter.
- **Extrahering av PlanYamlRepairService** — Flyttade logik för reparation av plan-YAML och borttagning av worktrees till dedikerade tjänster (`PlanYamlRepairService`, `WorktreeCleanupService`).
- **Extrahering av AppShellRouter** — Extraherade dirigeringslogik från `OpenApp` till en dedikerad `AppShellRouter`-klass.
- **IDoctorCheck-implementationer** — Refaktorerade doctor-diagnostikkontroller till individuella `IDoctorCheck`-klasser för utökningsbarhet.
- **Centraliserad MCP-autentisering** — Konsoliderade MCP-verktygsautentisering till en enda tjänst.
- **Spärr med BackgroundServiceActivator** — Lade till detektering och återställning vid tyst avslutning av bakgrundsprocesser.
- **IDisposable-mönster i PlanDatabaseService** — Korrekt resursrensning för databasanslutningar.
- **Asynkron SoftwareCheckStepView** — Ersatte blockerande `.Result`-anrop med `await` för ett responsivt användargränssnitt under hälsokontroller.
- **Omfattande kodkvalitetsgenomgång** — Minskade cyklomatisk komplexitet i ContentView, PlanController, PlanTools, ConfigService, GithubService, JobLauncher, ModelPricingService, TendrilAppShell och GetPromptDisplay via metodextrahering och datadrivna refaktoriseringar.
- **Testinfrastruktur** — Lade till mönstren `TempDirectoryFixture`, `ConfigServiceFixture`, `DatabaseFixture` och `IClassFixture`; utökade testtäckningen för GitService, PlanValidationService, JobLauncher och tilldelning av PlanId.
- **7-dagarsfönster i instrumentpanelen** — Statusantal och projektantal på instrumentpanelen filtrerar nu till de senaste 7 dagarna.

### Buggfixar

- Fixade kapplöpningstillstånd vid tilldelning av PlanId genom att centralisera tilldelningen i JobService.
- Fixade att `ModifyPlanEndpoint` returnerade felaktiga resultattyper.
- Fixade typmatchningsfel för loggare i `DashboardRepository`.
- Fixade automatisk stängning av GitHub-ärenden genom att flytta `Closes`-referensen efter trunkering av brödtext.
- Fixade kapplöpningstillstånd vid namnbyte av fil i `InboxWatcherService`.
- Fixade hantering av nullbara parametrar i `IsValidCommitHash`.
- Fixade undantagshantering i uppgiften för kostnadsspårning.
- Fixade åtkomst till tjänsteleverantör i `Program.cs`.
- Fixade `TabState`-referens i `AppShellRouter` och åtkomstmodifierare för hanterarmetoder.
- Tog bort arkivsamtidighetsblockering från JobService.
- Tog bort `DashboardLoggerAdapter` — använder loggaren direkt.
- Lade till loggning för svalda undantag i alla tjänster.
- Fixade CI/Docker: Node.js v22, korrekt hantering av `IvySource`, tog bort inaktuella referenser till Ivy-Framework.

## 1.0.14 (2026-04-10)

### Funktioner

- **Jobbprioritetskör** — Planer körs nu i prioritetsordning. Planer på buggnivå körs före NiceToHave, vilket säkerställer att kritiska fixar levereras först.
- **Importera ärenden från GitHub** — Importera befintliga GitHub-ärenden direkt till Tendril som utkastplaner via den nya Import-dialogrutan.
- **Skapande av planer för flera projekt** — Dialogrutan Skapa plan stöder nu val av flera projekt, vilket sammanställer deras repon i en enda plan.
- **WorktreeLifecycleLogger** — Centraliserat granskningsspår för skapande-, rensnings- och felhändelser för worktrees över PlanReaderService, WorktreeCleanupService och JobService.
- **Fliken Avancerade inställningar** — Ny flik i Setup för konfiguration av alternativ på lägre nivå.

### Förbättringar

- **Progressiv feedback vid hälsokontroller** — Hälsokontroller strömmar nu individuella resultat allt eftersom de slutförs istället för att vänta på att alla kontroller ska slutföras.
- **PR-status lagrad i SQLite** — PR-sammanslagningsstatus cachelagras nu i den lokala databasen med en bakgrundssynkroniseringstjänst, vilket minskar anrop till GitHub-API:et.
- **Förenklad PlanWatcher** — Ersatte tung användning av FileSystemWatcher med ett enklare tillvägagångssätt för att undvika buffertöverskridande från worktree-aktivitet.
- **Diagnostisk loggning för worktrees** — Lade till fail-fast-kontroller för saknade `.git`-filer och förbättrade felmeddelanden för fel vid skapande av worktrees.
- **Rekursiv detektering av worktree-artefakter** — ExecutePlan upptäcker och tar nu bort kapslade worktree-artefakter som lämnats kvar i Plans-katalogen från tidigare körningar.
- **Defensiv ordlisteåtkomst** — MakeSoftwareRow använder `GetValueOrDefault` för att förhindra KeyNotFoundException i gränsfall.

### Buggfixar

- Fixade att Geminis hälsokontroll öppnade webbläsarfönster under autentisering.
- Fixade `anyAgentHealthy`-kontrollen till att använda installationsstatus för Gemini-agenten.
- Fixade testbarhet för ConfigService-konstruktor.
- Fixade YAML-tolkningsfel i `recommendations.yaml`.
- Tog bort redundant Watch Remove från `Ivy.Tendril.csproj`.
- Tog bort oanvänd `_prStatusCache` från GithubService.

## 1.0.12 (2026-04-10)

### Funktioner

- **Stöd för flera agenter** — Tendril stöder nu flera kodningsagenter (Claude, Codex, Gemini) med konfigurerbara profiler (deep, balanced, quick) per agent.
- **Windows-installationsprogram** — Nytt `install.ps1`-skript för strömlinjeformad Windows-installation.
- **Doctor-kommando** — Kör `tendril doctor` för att diagnostisera konfigurations- och miljöproblem.

### Förbättringar

- **Översyn av dokumentation** — Omfattande omskrivning av all Tendril-dokumentation med förbättrad struktur, exempel och introduktionsflöde.
- **Finjustering av introduktionsguide** — Förbättrat användargränssnitt, texter och steglayout för förstagångsupplevelsen.
- **Stack-oberoende promptwares** — Tog bort stackspefikia referenser från ExecutePlan, CreatePlan och andra promptwares för att stödja alla teknikstackar via `config.yaml`-verifieringar.
- **Ersatte FolderInput med TextInput** — Förenklade sökvägsinmatning i alla Tendril-appar.

### Buggfixar

- Fixade hantering av miljövariabeln `TENDRIL_HOME` i tester.
- Lade till felhantering i `PlatformHelper.OpenInTerminal` och `OpenInFileManager`.
- Lade till kontroll av `File.Exists` innan `plan.yaml` läses i PlanReaderService.

## 1.0.9 (2026-04-09)

### Funktioner

- **Stabila NuGet-utgåvor** — Tendril publicerar nu stabila versionerade NuGet-paket med hjälp av `Directory.Build.props` för centraliserad versionshantering.
- **SQLite-databas** — Lokal datalagring för planer, jobb och PR-status med migreringsstöd.
- **Rekommendationssystem** — Planer kan nu generera uppföljningsrekommendationer som visas i Rekommendationer-appen.
- **Hantering av planlivscykel** — Fullständig tillståndsmaskin för planer: Draft, Approved, Executing, Review, Completed, Failed, med automatiska övergångar.

### Förbättringar

- **Kostnadsspårning** — Kostnads- och tokenspårning per jobb med visualisering på instrumentpanelen per projekt och promptware-typ.
- **Omfattande jobbstatus-enum** — Stöd för strängkonvertering för alla jobbstatusar.
- **Förbättringar av felhantering** — Detektering av duplicerade migreringsversioner och FTS5-felhantering.

## 1.0.0 (2026-04-03)

### Funktioner

- **Första utgåvan** av Tendril planhanteringssystem.
- **Planappar** — Vyerna Dashboard, Review, Drafts, Jobs, Icebox, Pull Requests, Recommendations och Trash.
- **Promptwares** — CreatePlan, ExecutePlan, CreatePr, UpdatePlan, SplitPlan, ExpandPlan och CreateIssue.
- **Plattformsoberoende stöd** — macOS och Windows med automatisk plattformsidentifiering.
- **Worktree-baserad exekvering** — Planer körs i isolerade git-worktrees för att hålla huvudarkivet rent.
- **Konfigurerbara verifieringar** — Build, Test, Format, Lint och CheckResult (med stackspecifika varianter som DotnetBuild, NpmTest).
- **GitHub-integration** — Automatiskt PR-skapande, statusspårning och sammanslagningsdetektering.
- **Kortkommandon** — `Ctrl+Alt+D` för nya utkast, med anpassningsbara bindningar.
