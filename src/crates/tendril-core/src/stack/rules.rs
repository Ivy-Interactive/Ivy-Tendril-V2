//! Static detection tables: what a declared dependency, a marker file or a container image
//! means in stack terms. Adding a technology is a one-line change here.

/// Technology category. Only the *defining* categories reach the report — see
/// [`TechCategory::is_defining`]. Everything else (linters, UI kits, HTTP clients, CI
/// providers, ...) is incidental noise that must never enter a project's stack hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TechCategory {
    Framework,
    Build,
    Styling,
    Orm,
    Database,
    Testing,
    Iac,
    Linting,
    Formatting,
    UiLibrary,
    HttpClient,
    Runtime,
    StateManagement,
    Animation,
    Ci,
    Hosting,
    Analytics,
}

impl TechCategory {
    /// Lowercase slug, as emitted in the report.
    pub fn slug(&self) -> &'static str {
        match self {
            Self::Framework => "framework",
            Self::Build => "build",
            Self::Styling => "styling",
            Self::Orm => "orm",
            Self::Database => "database",
            Self::Testing => "testing",
            Self::Iac => "iac",
            Self::Linting => "linting",
            Self::Formatting => "formatting",
            Self::UiLibrary => "ui-library",
            Self::HttpClient => "http-client",
            Self::Runtime => "runtime",
            Self::StateManagement => "state-management",
            Self::Animation => "animation",
            Self::Ci => "ci",
            Self::Hosting => "hosting",
            Self::Analytics => "analytics",
        }
    }

    /// Categories that define a stack. The report keeps only these.
    pub fn is_defining(&self) -> bool {
        matches!(
            self,
            Self::Framework
                | Self::Build
                | Self::Styling
                | Self::Orm
                | Self::Database
                | Self::Testing
                | Self::Iac
        )
    }
}

/// How sure the detector is. `Low` signals are dropped from the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Confidence {
    Low,
    Medium,
    High,
}

impl Confidence {
    pub fn slug(&self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }
}

/// A language a file extension maps to. Only programming and markup languages are reported;
/// data and prose (JSON, YAML, Markdown, ...) are excluded by omission from [`LANGUAGES`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanguageKind {
    Programming,
    Markup,
}

/// `extension -> (language name, kind)`.
pub const LANGUAGES: &[(&str, &str, LanguageKind)] = &[
    ("rs", "Rust", LanguageKind::Programming),
    ("ts", "TypeScript", LanguageKind::Programming),
    ("tsx", "TypeScript", LanguageKind::Programming),
    ("mts", "TypeScript", LanguageKind::Programming),
    ("cts", "TypeScript", LanguageKind::Programming),
    ("js", "JavaScript", LanguageKind::Programming),
    ("jsx", "JavaScript", LanguageKind::Programming),
    ("mjs", "JavaScript", LanguageKind::Programming),
    ("cjs", "JavaScript", LanguageKind::Programming),
    ("py", "Python", LanguageKind::Programming),
    ("go", "Go", LanguageKind::Programming),
    ("cs", "C#", LanguageKind::Programming),
    ("fs", "F#", LanguageKind::Programming),
    ("java", "Java", LanguageKind::Programming),
    ("kt", "Kotlin", LanguageKind::Programming),
    ("kts", "Kotlin", LanguageKind::Programming),
    ("rb", "Ruby", LanguageKind::Programming),
    ("php", "PHP", LanguageKind::Programming),
    ("swift", "Swift", LanguageKind::Programming),
    ("m", "Objective-C", LanguageKind::Programming),
    ("c", "C", LanguageKind::Programming),
    ("h", "C", LanguageKind::Programming),
    ("cpp", "C++", LanguageKind::Programming),
    ("cc", "C++", LanguageKind::Programming),
    ("cxx", "C++", LanguageKind::Programming),
    ("hpp", "C++", LanguageKind::Programming),
    ("sh", "Shell", LanguageKind::Programming),
    ("bash", "Shell", LanguageKind::Programming),
    ("zsh", "Shell", LanguageKind::Programming),
    ("ps1", "PowerShell", LanguageKind::Programming),
    ("sql", "SQL", LanguageKind::Programming),
    ("lua", "Lua", LanguageKind::Programming),
    ("dart", "Dart", LanguageKind::Programming),
    ("scala", "Scala", LanguageKind::Programming),
    ("ex", "Elixir", LanguageKind::Programming),
    ("exs", "Elixir", LanguageKind::Programming),
    ("zig", "Zig", LanguageKind::Programming),
    ("hs", "Haskell", LanguageKind::Programming),
    ("tf", "HCL", LanguageKind::Programming),
    ("html", "HTML", LanguageKind::Markup),
    ("css", "CSS", LanguageKind::Markup),
    ("scss", "SCSS", LanguageKind::Markup),
    ("sass", "Sass", LanguageKind::Markup),
    ("less", "Less", LanguageKind::Markup),
    ("vue", "Vue", LanguageKind::Markup),
    ("svelte", "Svelte", LanguageKind::Markup),
    ("razor", "Razor", LanguageKind::Markup),
];

/// `declared dependency -> (display name, category, confidence)`.
///
/// Matched case-insensitively against the whole dependency identifier and — for Go module
/// paths and Maven coordinates — against its last segment.
pub const TECHNOLOGIES: &[(&str, &str, TechCategory, Confidence)] = &[
    // Frameworks
    ("react", "React", TechCategory::Framework, Confidence::High),
    (
        "react-dom",
        "React",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "react-native",
        "React Native",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("next", "Next.js", TechCategory::Framework, Confidence::High),
    ("nuxt", "Nuxt", TechCategory::Framework, Confidence::High),
    ("vue", "Vue", TechCategory::Framework, Confidence::High),
    (
        "svelte",
        "Svelte",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "@sveltejs/kit",
        "SvelteKit",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "@angular/core",
        "Angular",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("astro", "Astro", TechCategory::Framework, Confidence::High),
    ("remix", "Remix", TechCategory::Framework, Confidence::High),
    (
        "solid-js",
        "Solid",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "express",
        "Express",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "fastify",
        "Fastify",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "@nestjs/core",
        "NestJS",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "@tauri-apps/api",
        "Tauri",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("tauri", "Tauri", TechCategory::Framework, Confidence::High),
    (
        "electron",
        "Electron",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("axum", "Axum", TechCategory::Framework, Confidence::High),
    (
        "actix-web",
        "Actix Web",
        TechCategory::Framework,
        Confidence::High,
    ),
    (
        "rocket",
        "Rocket",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("warp", "Warp", TechCategory::Framework, Confidence::High),
    (
        "django",
        "Django",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("flask", "Flask", TechCategory::Framework, Confidence::High),
    (
        "fastapi",
        "FastAPI",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("gin", "Gin", TechCategory::Framework, Confidence::High),
    ("echo", "Echo", TechCategory::Framework, Confidence::Medium),
    (
        "spring-boot-starter",
        "Spring Boot",
        TechCategory::Framework,
        Confidence::High,
    ),
    ("rails", "Rails", TechCategory::Framework, Confidence::High),
    (
        "laravel",
        "Laravel",
        TechCategory::Framework,
        Confidence::High,
    ),
    // Build tooling
    ("vite", "Vite", TechCategory::Build, Confidence::High),
    ("vite-plus", "Vite+", TechCategory::Build, Confidence::High),
    ("webpack", "Webpack", TechCategory::Build, Confidence::High),
    ("rollup", "Rollup", TechCategory::Build, Confidence::High),
    (
        "rolldown",
        "Rolldown",
        TechCategory::Build,
        Confidence::High,
    ),
    ("esbuild", "esbuild", TechCategory::Build, Confidence::High),
    ("parcel", "Parcel", TechCategory::Build, Confidence::High),
    ("turbo", "Turborepo", TechCategory::Build, Confidence::High),
    ("nx", "Nx", TechCategory::Build, Confidence::High),
    ("lerna", "Lerna", TechCategory::Build, Confidence::Medium),
    ("@swc/core", "SWC", TechCategory::Build, Confidence::Medium),
    (
        "@babel/core",
        "Babel",
        TechCategory::Build,
        Confidence::Medium,
    ),
    (
        "typescript",
        "TypeScript",
        TechCategory::Build,
        Confidence::High,
    ),
    // Styling
    (
        "tailwindcss",
        "Tailwind CSS",
        TechCategory::Styling,
        Confidence::High,
    ),
    (
        "styled-components",
        "styled-components",
        TechCategory::Styling,
        Confidence::High,
    ),
    (
        "@emotion/react",
        "Emotion",
        TechCategory::Styling,
        Confidence::High,
    ),
    ("sass", "Sass", TechCategory::Styling, Confidence::High),
    ("less", "Less", TechCategory::Styling, Confidence::High),
    (
        "bootstrap",
        "Bootstrap",
        TechCategory::Styling,
        Confidence::High,
    ),
    (
        "@mui/material",
        "MUI",
        TechCategory::Styling,
        Confidence::High,
    ),
    // ORMs
    ("prisma", "Prisma", TechCategory::Orm, Confidence::High),
    (
        "@prisma/client",
        "Prisma",
        TechCategory::Orm,
        Confidence::High,
    ),
    (
        "drizzle-orm",
        "Drizzle ORM",
        TechCategory::Orm,
        Confidence::High,
    ),
    ("typeorm", "TypeORM", TechCategory::Orm, Confidence::High),
    (
        "sequelize",
        "Sequelize",
        TechCategory::Orm,
        Confidence::High,
    ),
    ("mongoose", "Mongoose", TechCategory::Orm, Confidence::High),
    ("diesel", "Diesel", TechCategory::Orm, Confidence::High),
    ("sqlx", "SQLx", TechCategory::Orm, Confidence::High),
    ("sea-orm", "SeaORM", TechCategory::Orm, Confidence::High),
    (
        "sqlalchemy",
        "SQLAlchemy",
        TechCategory::Orm,
        Confidence::High,
    ),
    ("gorm", "GORM", TechCategory::Orm, Confidence::High),
    (
        "microsoft.entityframeworkcore",
        "Entity Framework Core",
        TechCategory::Orm,
        Confidence::High,
    ),
    // Databases (client libraries)
    ("pg", "PostgreSQL", TechCategory::Database, Confidence::High),
    (
        "postgres",
        "PostgreSQL",
        TechCategory::Database,
        Confidence::High,
    ),
    ("mysql2", "MySQL", TechCategory::Database, Confidence::High),
    (
        "rusqlite",
        "SQLite",
        TechCategory::Database,
        Confidence::High,
    ),
    (
        "sqlite3",
        "SQLite",
        TechCategory::Database,
        Confidence::High,
    ),
    (
        "better-sqlite3",
        "SQLite",
        TechCategory::Database,
        Confidence::High,
    ),
    (
        "@libsql/client",
        "libSQL",
        TechCategory::Database,
        Confidence::High,
    ),
    ("redis", "Redis", TechCategory::Database, Confidence::High),
    (
        "mongodb",
        "MongoDB",
        TechCategory::Database,
        Confidence::High,
    ),
    // Testing
    ("vitest", "Vitest", TechCategory::Testing, Confidence::High),
    ("jest", "Jest", TechCategory::Testing, Confidence::High),
    ("mocha", "Mocha", TechCategory::Testing, Confidence::High),
    (
        "@playwright/test",
        "Playwright",
        TechCategory::Testing,
        Confidence::High,
    ),
    (
        "playwright",
        "Playwright",
        TechCategory::Testing,
        Confidence::High,
    ),
    (
        "cypress",
        "Cypress",
        TechCategory::Testing,
        Confidence::High,
    ),
    (
        "@testing-library/react",
        "Testing Library",
        TechCategory::Testing,
        Confidence::High,
    ),
    (
        "@storybook/react",
        "Storybook",
        TechCategory::Testing,
        Confidence::High,
    ),
    (
        "storybook",
        "Storybook",
        TechCategory::Testing,
        Confidence::High,
    ),
    ("pytest", "pytest", TechCategory::Testing, Confidence::High),
    ("xunit", "xUnit", TechCategory::Testing, Confidence::High),
    ("nunit", "NUnit", TechCategory::Testing, Confidence::High),
    (
        "criterion",
        "Criterion",
        TechCategory::Testing,
        Confidence::High,
    ),
    // Infrastructure as code
    ("pulumi", "Pulumi", TechCategory::Iac, Confidence::High),
    (
        "aws-cdk-lib",
        "AWS CDK",
        TechCategory::Iac,
        Confidence::High,
    ),
    // Non-defining: matched so they are recognised, then dropped from the report.
    ("eslint", "ESLint", TechCategory::Linting, Confidence::High),
    ("oxlint", "Oxlint", TechCategory::Linting, Confidence::High),
    (
        "prettier",
        "Prettier",
        TechCategory::Formatting,
        Confidence::High,
    ),
    (
        "lucide-react",
        "Lucide",
        TechCategory::UiLibrary,
        Confidence::High,
    ),
    (
        "@radix-ui/react-dialog",
        "Radix UI",
        TechCategory::UiLibrary,
        Confidence::High,
    ),
    (
        "framer-motion",
        "Framer Motion",
        TechCategory::Animation,
        Confidence::High,
    ),
    ("axios", "Axios", TechCategory::HttpClient, Confidence::High),
    (
        "reqwest",
        "reqwest",
        TechCategory::HttpClient,
        Confidence::High,
    ),
    ("tokio", "Tokio", TechCategory::Runtime, Confidence::High),
    (
        "redux",
        "Redux",
        TechCategory::StateManagement,
        Confidence::High,
    ),
    (
        "zustand",
        "Zustand",
        TechCategory::StateManagement,
        Confidence::High,
    ),
];

/// A file (or directory) whose presence in a component implies a technology.
///
/// `pattern` matches a file name, either exactly or as a `name.` prefix for the
/// `foo.config.*` family.
pub struct MarkerRule {
    pub pattern: &'static str,
    pub name: &'static str,
    pub category: TechCategory,
    pub confidence: Confidence,
}

pub const MARKERS: &[MarkerRule] = &[
    MarkerRule {
        pattern: "tailwind.config",
        name: "Tailwind CSS",
        category: TechCategory::Styling,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "next.config",
        name: "Next.js",
        category: TechCategory::Framework,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "vite.config",
        name: "Vite",
        category: TechCategory::Build,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "vitest.config",
        name: "Vitest",
        category: TechCategory::Testing,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "playwright.config",
        name: "Playwright",
        category: TechCategory::Testing,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "svelte.config",
        name: "Svelte",
        category: TechCategory::Framework,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "astro.config",
        name: "Astro",
        category: TechCategory::Framework,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: ".storybook",
        name: "Storybook",
        category: TechCategory::Testing,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "Cargo.toml",
        name: "Cargo",
        category: TechCategory::Build,
        confidence: Confidence::High,
    },
    MarkerRule {
        pattern: "main.tf",
        name: "Terraform",
        category: TechCategory::Iac,
        confidence: Confidence::High,
    },
];

/// `container image -> (kind, category slug)` for `docker-compose` services.
/// Images that are not recognised are skipped rather than guessed at, so they never enter a
/// project's stack hash.
pub const INFRASTRUCTURE_IMAGES: &[(&str, &str, &str)] = &[
    ("postgres", "Postgres", "database"),
    ("postgis", "Postgres", "database"),
    ("pgvector", "Postgres", "database"),
    ("mysql", "MySQL", "database"),
    ("mariadb", "MariaDB", "database"),
    ("mssql", "SQL Server", "database"),
    ("mongo", "MongoDB", "database"),
    ("clickhouse", "ClickHouse", "database"),
    ("cockroach", "CockroachDB", "database"),
    ("redis", "Redis", "cache"),
    ("valkey", "Valkey", "cache"),
    ("memcached", "Memcached", "cache"),
    ("rabbitmq", "RabbitMQ", "queue"),
    ("kafka", "Kafka", "queue"),
    ("nats", "NATS", "queue"),
    ("elasticsearch", "Elasticsearch", "search"),
    ("opensearch", "OpenSearch", "search"),
    ("meilisearch", "Meilisearch", "search"),
    ("minio", "MinIO", "storage"),
    ("nginx", "Nginx", "proxy"),
    ("traefik", "Traefik", "proxy"),
    ("caddy", "Caddy", "proxy"),
    ("prometheus", "Prometheus", "observability"),
    ("grafana", "Grafana", "observability"),
    ("jaeger", "Jaeger", "observability"),
    ("localstack", "LocalStack", "cloud-emulator"),
    ("mailhog", "MailHog", "mail"),
    ("mailpit", "Mailpit", "mail"),
];

/// Directories that never carry stack signal and would dominate the walk if included.
pub const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "bin",
    "obj",
    "dist",
    "build",
    ".venv",
    "vendor",
];

/// Path segments that mark a component as auxiliary (tests, samples, tooling).
pub const AUXILIARY_SEGMENTS: &[&str] = &[
    "test",
    "tests",
    "example",
    "examples",
    "sample",
    "samples",
    "fixture",
    "fixtures",
    "benches",
    "benchmarks",
    "scripts",
    "tools",
    "docs",
];
