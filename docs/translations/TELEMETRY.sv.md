# Policy för klassificering av telemetridata

## Syfte

Detta dokument definierar vilka data Tendril får och inte får skicka till tredjepartstelemetritjänster (PostHog). Målet är att samla in användbar analysdata och samtidigt respektera användarnas integritet.

Policyn följer koden: den har porterats från den ursprungliga Tendril-appens `TELEMETRY.md` och begränsats till de händelser som faktiskt är anslutna i V2.

## Opt-in, inte opt-out

**Telemetri är inaktiverad om du inte uttryckligen aktiverar den.** Endast ett explicit `telemetry: true` i `config.yaml` aktiverar insamlingen; en saknad nyckel och `telemetry: false` fungerar identiskt — ingen klient konstrueras, ingen händelse läggs i kö och inget nätverksanrop görs någonsin. Nyckeln läses på exakt ett ställe: `TendrilSettings::telemetry_enabled` i [config.rs](../src/crates/tendril-core/src/config.rs), och V2 introducerar aldrig nyckeln på eget bevåg: att spara en `config.yaml` som saknar den lämnar den tom i stället för att stämpla `telemetry: false`. Detta säkerställer att en fil som delas med originalappen — vilken tolkar en saknad nyckel som "på" — inte stänger av den appens telemetri. Ett explicit värde bevaras oförändrat.

**Detta är en medveten avvikelse.** Originalappen är opt-out: den sätter `Telemetry` till `true` som standard och dess egen `TELEMETRY.md` anger "Telemetry is opt-out: it is on by default." V2 sätter standardvärdet till avstängt eftersom aktivering av datainsamling inte är ett beslut en portering bör fatta i det tysta åt användaren. Avvikelsen är säker i en riktning — V2 underrapporterar i förhållande till originalet, men överrapporterar aldrig. För att återställa det, ändra fältets standardvärde och `Default`-implementationen i [config.rs](../src/crates/tendril-core/src/config.rs) tillbaka till `Some(true)`.

Användare identifieras uteslutande genom ett slumpmässigt UUID som sparas i `<TendrilHome>/.anonymous-id`. Det härleds aldrig från ett användarnamn, datornamn eller arkiv. (Originalet föredrar `<LocalAppData>/Tendril/.anonymous-id`; en dator som kör båda apparna räknas därför som två installationer.)

## Klassificeringsregler

### TILLÅTET — Sammanställda och icke-identifierande data

- **Antal (Counts)**: antal projekt, arkiv, planer, jobb (endast aggregerade totaler)
- **Varaktighet (Durations)**: tid det tar att slutföra operationer, i sekunder
- **Tillstånd/Typer (States/Types)**: enum-värden, tillståndsnamn, jobbtyper (t.ex. `CreatePlan`, `ExecutePlan`)
- **Nivåer (Levels)**: plannivåer (t.ex. `Bug`, `Feature`, `Epic`)
- **Versioner (Versions)**: versionssträngar för applikationen, operativsystemets namn och versionssträngar
- **Agentleverantörer (Agent providers)**: namn på kodningsagent (t.ex. `claude`, `codex`, `copilot`, `gemini`, `opencode`, `antigravity`, `apple`, `ivy`)
- **Booleska värden (Booleans)**: funktionsflaggor, konfigurationstillstånd (t.ex. `llm_configured: true`)
- **Teknikdeskriptorer**: projektets stack-hash (se nedan)
- **Installationssaltade envägshashar** av annars förbjudna identifierare (se nedan)

#### Stack-hash (`stack_hash`)

Stack-deskriptorhashen är en kanonisk, likhetsbevarande signatur för ett projekts teknikstack, t.ex. `fe.ts:react+next+tailwind/be.rs:axum/db:sqlite/test:vitest`. Den är enbart uppbyggd av ett slutet vokabulär av språk-, ramverks-, databas- och testramverks-sluggar — till sin konstruktion innehåller den inga namn, sökvägar, versioner, antal eller fritext. Den visar vilka stackar Tendril används på utan att avslöja vems projekt det är.

#### Installationssaltad planidentitet (`plan_uuid`)

Råa plan-ID:n förblir förbjudna, men händelser måste fortfarande kunna grupperas per plan.
`telemetry::derive_plan_uuid` genererar `SHA256("tendril-plan:" + anonymous_id + ":" + plan_id)` trunkerat till 16 byte och formaterat som ett RFC 9562 v8 UUID i stället för själva ID:t:

- det anonyma ID:t är ett salt per installation, så plan `00042` härleder ett unikt värde på varje installation och kan inte korrelera orelaterade användare
- hashen är enkelriktad (enkelvägs), så sekvensräknaren lämnar aldrig den lokala maskinen
- den är avgränsad till en enda anonym användare, vilket grupperar händelser utan att utöka identiteten

ID:n normaliseras först till fem siffror, så den heltalsformaterade formen från databasen (`42`) och mappformen (`00042`) härleder samma värde.

Eventuella framtida behov av att korrelera en förbjuden identifierare måste använda samma saltade hash-mönster, aldrig råvärdet.

### FÖRBJUDET — Identifierande information

Spåra aldrig:

- **URL:er**: arkiv-, PR- eller ärende-URL:er
- **Sökvägar**: filsökvägar, katalogsökvägar, absoluta sökvägar till arkiv
- **Användarnamn**: GitHub-användarnamn, organisationsnamn, e-postadresser
- **Arkivnamn** och **projektnamn** — även generiska namn avslöjar arbetskontext
- **Sekventiella ID:n**: plan-ID:n, ärendenummer, PR-nummer (hasha dem per installation i stället — se `plan_uuid`)
- **Användarinmatning**: uppgiftsbeskrivningar, commit-meddelanden, planinnehåll
- **Titlar**: plantitlar, ärenderubriker, commit-ämnesrader
- **Agentutdata**: transkriptioner, verktygsanrop eller felmeddelanden som kan innehålla användarinnehåll

## Beslutsramverk

1. Kan detta fält identifiera en person eller organisation? → Förbjudet
2. Kan det avslöja privat arkivinformation? → Förbjudet
3. Kan det avslöja vad användaren arbetar med? → Förbjudet
4. Kan det korreleras mellan användare för att avidentifiera dem? → Förbjudet, såvida det inte saltas med det anonyma ID:t och hashas enkelriktat
5. Ger det användbara aggregerade insikter? → Tillåtet

**Om du är osäker, utelämna det.**

## Bifogas till varje händelse

Superegenskaper, inställda en gång per process i [client.rs](../src/crates/tendril-core/src/telemetry/client.rs):

| Egenskap | Status | Anteckningar |
|---|---|---|
| `$session_id` | Följer policy | Slumpmässigt UUID, nytt per process |
| `$geoip_disable: false` | Accepterad | PostHog matchar förfrågans IP till ett land; själva IP-adressen sparas inte som händelseegenskap |
| `app_version` | Följer policy | Crate-version |
| `os` | Följer policy | Plattformsnamn |
| `os_version` | Följer policy | `uname`-version på unix, plattformsfamilj på andra system |

`distinct_id` (det anonyma ID:t) bifogas till varje händelse. Originalets egenskaper `distribution` / `source` utelämnas: de innehåller en .NET-`AppBrand` utan motsvarighet i V2.

## Granskning av nuvarande händelser

Alla händelser följer denna policy. Kontexter är typade strukturer i [events.rs](../src/crates/tendril-core/src/telemetry/events.rs), så en uppsättning egenskaper är ett beslut vid kompileringstillfället snarare än en flexibel uppslagsmappning.

| Händelse | Egenskaper | Skickas från |
|---|---|---|
| `app_started` | `version`, `project_count`, `llm_configured` | `run_server`, efter att huvudlåset har erhållits |
| `job_created` | `job_type`, `agent`, `plan_uuid` | `JobManager::start_job_with` |
| `job_completed` | `job_type`, `status`, `duration_seconds`, `agent`, `plan_uuid` | `finish_job` |
| `plan_created` | `level`, `duration_seconds`, `agent`, `stack_hash`, `plan_uuid` | `finish_job`, `CreatePlan` med leverans |
| `pr_created` | `duration_seconds`, `agent`, `plan_uuid` | `finish_job`, `CreatePr` |
| `plan_state_transition` | `from_state`, `to_state`, `plan_uuid` | `apply_plan_state`, när skrivningen nådde disken |

`plan_uuid` är alltid det härledda, installationssaltade värdet: anropsplatser skickar det råa plan-ID:t till den typade kontexten och klienten hashar det före insamling, vilket innebär att det råa ID:t inte kan nå PostHog även från anropskod som inte känner till regeln.

### Definierade men inte anslutna

`onboarding_completed` och `project_created` har kontextstrukturer i [events.rs](../src/crates/tendril-core/src/telemetry/events.rs) utan någon anropsplats: V2 har inget onboardingflöde, och skapande av projekt sker i CLI-processen där ingen klient installeras. De finns kvar så att en framtida plan kan lägga till en anropsplats i stället för att ändra schemat.

Klienten körs endast i daemon-processen. Ett CLI-anrop anropar aldrig `telemetry::install`, så `tendril plan ...` skickar ingenting.

## Implementation

- [events.rs](../src/crates/tendril-core/src/telemetry/events.rs) — typade kontexter som upprätthåller denna policy vid kompileringstillfället. Nya händelser får en struktur här, inte en samling lösa egenskaper.
- [client.rs](../src/crates/tendril-core/src/telemetry/client.rs) — PostHog-klient, anonymt ID, härledning av plan-uuid. Varje `track_*` fångar sina egna fel och skickar endast till en kö som töms av en bakgrundsaktivitet: telemetri får aldrig orsaka fel eller sakta ner ett jobb.
- [telemetry_test.rs](../src/crates/tendril-core/tests/telemetry_test.rs) — säkerställer noll nätverksanrop vid inaktivering, exakt egenskapsuppsättning för varje ansluten händelse och härledning av plan-uuid.
