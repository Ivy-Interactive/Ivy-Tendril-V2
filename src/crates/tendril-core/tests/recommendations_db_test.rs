//! Guards the `Recommendations` projection. `plan.yaml` is the source of truth and the table is a
//! denormalised copy of it, so the risk here is drift: a mutation that updates the YAML and leaves
//! the table showing the old answer, or a table that keeps rows for plans that no longer exist. Every
//! test below compares the table against `list_recommendations` rather than against a literal, so a
//! write path that stops calling `sync_plan` fails here instead of being noticed in the UI.

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tendril_core::db::{
    get_recommendations, open_database, rebuild_recommendations_projection, sync_plan,
    RecommendationRow,
};
use tendril_core::models::RecommendationStatus;
use tendril_core::plans::{
    accept_recommendation, add_recommendation, create_plan, decline_recommendation,
    list_recommendations, read_plan_file, remove_recommendation, set_recommendation_field,
    CreatePlanOptions,
};

struct TempDir(PathBuf);

impl TempDir {
    fn new(prefix: &str) -> Self {
        let path =
            std::env::temp_dir().join(format!("{}-{}", prefix, uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        Self(path)
    }

    fn path(&self) -> &PathBuf {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn plans_options(title: &str, project: &str) -> CreatePlanOptions {
    CreatePlanOptions {
        title: title.to_string(),
        project: project.to_string(),
        level: Some("Feature".to_string()),
        initial_prompt: None,
        source_url: None,
        execution_profile: None,
        priority: None,
        repos: vec![],
        verifications: vec![],
        depends_on: vec![],
        related_plans: vec![],
        chat_session_id: None,
    }
}

/// A database plus a plans directory holding one plan, already synced.
fn setup(prefix: &str) -> (TempDir, Connection, PathBuf) {
    let dir = TempDir::new(prefix);
    let plans_dir = dir.path().join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    let conn = open_database(&dir.path().join("tendril.db")).expect("open database");

    let plan = create_plan(
        &plans_dir,
        plans_options("Tune The Scheduler", "TendrilService"),
    )
    .expect("create plan");
    let folder = PathBuf::from(&plan.folder_path);
    resync(&conn, &folder);

    (dir, conn, folder)
}

/// What every mutation path does after writing `plan.yaml`: re-read the folder and project it.
fn resync(conn: &Connection, folder: &Path) {
    let plan = read_plan_file(folder).expect("read plan file");
    sync_plan(conn, &plan).expect("sync plan");
}

fn rows_for(conn: &Connection, folder: &Path) -> Vec<RecommendationRow> {
    let plan = read_plan_file(folder).expect("read plan file");
    get_recommendations(conn, None, None)
        .expect("query recommendations")
        .into_iter()
        .filter(|r| r.plan_id == plan.metadata.id)
        .collect()
}

/// Asserts the projection says exactly what `plan.yaml` says, including the denormalised plan
/// columns the cross-plan view renders without joining back to `Plans`.
fn assert_projection_matches_yaml(conn: &Connection, folder: &Path) {
    let plan = read_plan_file(folder).expect("read plan file");
    let expected = list_recommendations(folder).expect("list recommendations");
    let actual = rows_for(conn, folder);

    assert_eq!(
        actual.len(),
        expected.len(),
        "the table and plan.yaml disagree on how many recommendations exist"
    );

    for rec in &expected {
        let row = actual
            .iter()
            .find(|r| r.title == rec.title)
            .unwrap_or_else(|| panic!("no projected row for '{}'", rec.title));
        assert_eq!(row.description, rec.description);
        assert_eq!(row.state, rec.state);
        assert_eq!(row.decline_reason, rec.decline_reason);
        assert_eq!(row.notes, rec.notes);
        assert_eq!(row.impact, rec.impact);
        assert_eq!(row.plan_title, plan.metadata.title);
        assert_eq!(row.plan_folder_name, plan.folder_name);
        assert_eq!(row.project, plan.metadata.project);
        assert_eq!(row.source_plan_status, plan.metadata.state.as_str());
    }
}

#[test]
fn every_mutation_keeps_the_projection_equal_to_plan_yaml() {
    let (_dir, conn, folder) = setup("tendril-rec-proj-test");

    add_recommendation(&folder, "Add Index", "Index the jobs table", Some("High")).expect("add");
    resync(&conn, &folder);
    assert_projection_matches_yaml(&conn, &folder);
    assert_eq!(rows_for(&conn, &folder).len(), 1);

    set_recommendation_field(&folder, "Add Index", "description", "Index Jobs(Status)")
        .expect("set description");
    resync(&conn, &folder);
    assert_projection_matches_yaml(&conn, &folder);

    // A rename is the one edit that changes the row's own key, so the old row has
    // to disappear rather than be left behind alongside the new one.
    set_recommendation_field(&folder, "Add Index", "title", "Add Jobs Index").expect("rename");
    resync(&conn, &folder);
    assert_projection_matches_yaml(&conn, &folder);
    let rows = rows_for(&conn, &folder);
    assert_eq!(rows.len(), 1, "the pre-rename row must not survive");
    assert_eq!(rows[0].title, "Add Jobs Index");

    accept_recommendation(&folder, "Add Jobs Index", Some("After the 0.2 migration"))
        .expect("accept");
    resync(&conn, &folder);
    assert_projection_matches_yaml(&conn, &folder);
    let rows = rows_for(&conn, &folder);
    assert_eq!(rows[0].state, RecommendationStatus::ACCEPTED_WITH_NOTES);
    assert_eq!(rows[0].notes.as_deref(), Some("After the 0.2 migration"));
    assert_eq!(rows[0].decline_reason, None);

    decline_recommendation(
        &folder,
        "Add Jobs Index",
        Some("Superseded by partitioning"),
    )
    .expect("decline");
    resync(&conn, &folder);
    assert_projection_matches_yaml(&conn, &folder);
    let rows = rows_for(&conn, &folder);
    assert_eq!(rows[0].state, RecommendationStatus::DECLINED);
    assert_eq!(
        rows[0].decline_reason.as_deref(),
        Some("Superseded by partitioning")
    );
    assert_eq!(
        rows[0].notes, None,
        "an accept note must not linger on a declined row"
    );

    remove_recommendation(&folder, "Add Jobs Index").expect("remove");
    resync(&conn, &folder);
    assert!(
        rows_for(&conn, &folder).is_empty(),
        "removing the last recommendation must leave no rows for the plan"
    );
}

#[test]
fn the_cross_plan_query_spans_plans_and_filters_by_project_and_state() {
    let dir = TempDir::new("tendril-rec-crossplan-test");
    let plans_dir = dir.path().join("Plans");
    std::fs::create_dir_all(&plans_dir).expect("create plans dir");
    let conn = open_database(&dir.path().join("tendril.db")).expect("open database");

    let first = PathBuf::from(
        &create_plan(&plans_dir, plans_options("Tune The Scheduler", "ProjA"))
            .expect("create plan A")
            .folder_path,
    );
    let second = PathBuf::from(
        &create_plan(&plans_dir, plans_options("Rework The Inbox", "ProjB"))
            .expect("create plan B")
            .folder_path,
    );

    add_recommendation(&first, "Add Index", "Index the jobs table", Some("High")).expect("add A1");
    add_recommendation(&first, "Cache Results", "Memoize the hot query", None).expect("add A2");
    add_recommendation(
        &second,
        "Batch Writes",
        "Coalesce inbox writes",
        Some("Small"),
    )
    .expect("add B1");
    accept_recommendation(
        &second,
        "Batch Writes",
        Some("Do it with the queue rewrite"),
    )
    .expect("accept B1");

    for folder in [&first, &second] {
        resync(&conn, folder);
    }

    // The whole point of the projection: one query answers across plans.
    let pending = get_recommendations(&conn, None, Some(RecommendationStatus::PENDING))
        .expect("query pending");
    assert_eq!(pending.len(), 2);
    assert!(pending
        .iter()
        .all(|r| r.state == RecommendationStatus::PENDING));

    let all = get_recommendations(&conn, None, None).expect("query all");
    assert_eq!(all.len(), 3);
    assert_eq!(
        all.iter().filter(|r| r.project == "ProjB").count(),
        1,
        "both plans must be represented"
    );

    let proj_a = get_recommendations(&conn, Some("ProjA"), None).expect("query ProjA");
    assert_eq!(proj_a.len(), 2);
    assert!(proj_a.iter().all(|r| r.project == "ProjA"));

    // Filters are case-insensitive, matching the loose parsing everywhere else.
    let loose = get_recommendations(&conn, Some("proja"), Some("pending")).expect("loose query");
    assert_eq!(loose.len(), 2);

    let combined = get_recommendations(
        &conn,
        Some("ProjB"),
        Some(RecommendationStatus::ACCEPTED_WITH_NOTES),
    )
    .expect("combined query");
    assert_eq!(combined.len(), 1);
    assert_eq!(combined[0].title, "Batch Writes");
    assert_eq!(
        combined[0].notes.as_deref(),
        Some("Do it with the queue rewrite")
    );
}

#[test]
fn rebuild_repairs_a_stale_table() {
    let (dir, conn, folder) = setup("tendril-rec-rebuild-test");
    let plans_dir = dir.path().join("Plans");

    add_recommendation(&folder, "Add Index", "Index the jobs table", Some("High")).expect("add");
    resync(&conn, &folder);
    let plan_id = read_plan_file(&folder).expect("read plan").metadata.id;

    // Two kinds of staleness a database predating the projection can hold: rows for a
    // plan whose folder is gone from disk, and a row that contradicts its own YAML.
    // The stale plan needs its `Plans` row, because `Recommendations.PlanId` is a
    // foreign key — the row cannot be orphaned in the database, only on disk.
    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw,
            RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (
            99999, 'Deleted Plan', 'TendrilService', 'Feature', 'Draft',
            '/gone/99999-DeletedPlan', '99999-DeletedPlan', '', 1, '',
            '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'
        )
        "#,
        [],
    )
    .expect("insert stale plan row");
    conn.execute(
        r#"
        INSERT INTO Recommendations (
            PlanId, Title, Description, State, DeclineReason, PlanTitle, PlanFolderName,
            Project, Date, SourcePlanStatus, Impact
        ) VALUES (
            99999, 'Ghost Recommendation', 'From a plan folder that is gone', 'Pending', NULL,
            'Deleted Plan', '99999-DeletedPlan', 'TendrilService', '2020-01-01T00:00:00Z',
            'Draft', 'Small'
        )
        "#,
        [],
    )
    .expect("insert stale row");
    conn.execute(
        "UPDATE Recommendations SET Description = 'Stale text', State = 'Declined' WHERE PlanId = ?1",
        rusqlite::params![plan_id],
    )
    .expect("corrupt the live row");

    assert_eq!(
        get_recommendations(&conn, None, None).expect("query").len(),
        2
    );

    let (rows, plans) =
        rebuild_recommendations_projection(&conn, &plans_dir).expect("rebuild projection");
    assert_eq!(rows, 1, "one recommendation exists on disk");
    assert_eq!(plans, 1, "one plan folder was walked");

    let all = get_recommendations(&conn, None, None).expect("query after rebuild");
    assert_eq!(
        all.len(),
        1,
        "the row for the vanished plan folder must be gone"
    );
    assert_eq!(all[0].plan_id, plan_id);
    assert_eq!(all[0].description, "Index the jobs table");
    assert_eq!(all[0].state, RecommendationStatus::PENDING);
    assert_projection_matches_yaml(&conn, &folder);

    // Rebuilding again is a no-op rather than a doubling: it deletes before it inserts.
    let (rows, _) = rebuild_recommendations_projection(&conn, &plans_dir).expect("rebuild twice");
    assert_eq!(rows, 1);
    assert_eq!(
        get_recommendations(&conn, None, None).expect("query").len(),
        1
    );
}

#[test]
fn rebuild_skips_unparseable_folders_rather_than_failing() {
    let (dir, conn, folder) = setup("tendril-rec-rebuild-junk-test");
    let plans_dir = dir.path().join("Plans");

    add_recommendation(&folder, "Add Index", "Index the jobs table", None).expect("add");

    // A directory that is not a plan, and a plan.yaml that is not YAML. Either one
    // stopping the rebuild would mean one bad folder blocks the daemon's startup
    // repair for every other plan.
    std::fs::create_dir_all(plans_dir.join("not-a-plan")).expect("create junk dir");
    let broken = plans_dir.join("00099-Broken");
    std::fs::create_dir_all(&broken).expect("create broken plan dir");
    std::fs::write(broken.join("plan.yaml"), "state: [unclosed").expect("write broken yaml");

    let (rows, plans) =
        rebuild_recommendations_projection(&conn, &plans_dir).expect("rebuild projection");
    assert_eq!(rows, 1);
    assert_eq!(plans, 1, "only the one readable plan counts");
    assert_projection_matches_yaml(&conn, &folder);
}

#[test]
fn a_database_without_the_notes_column_gains_it_on_open() {
    let dir = TempDir::new("tendril-rec-notes-column-test");
    let db_path = dir.path().join("tendril.db");

    {
        let conn = open_database(&db_path).expect("open database");
        // A database created before `notes` existed. `ensure_columns` is what has to
        // put it back, since the table itself is only created when absent.
        conn.execute("ALTER TABLE Recommendations DROP COLUMN Notes", [])
            .expect("drop the Notes column");
        let has_notes: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('Recommendations') WHERE name = 'Notes')",
                [],
                |r| r.get(0),
            )
            .expect("check column");
        assert!(
            !has_notes,
            "the fixture must actually be missing the column"
        );
    }

    let conn = open_database(&db_path).expect("reopen database");
    let has_notes: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('Recommendations') WHERE name = 'Notes')",
            [],
            |r| r.get(0),
        )
        .expect("check column");
    assert!(has_notes, "reopening must add the Notes column back");

    // The stamp stays at 25: the original app refuses to open a database stamped
    // past its own latest migration, and an additive nullable column needs no bump.
    let stamp: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .expect("read user_version");
    assert_eq!(stamp, 25);

    conn.execute(
        r#"
        INSERT INTO Plans (
            Id, Title, Project, Level, State, FolderPath, FolderName, YamlRaw,
            RevisionCount, LatestRevisionContent, Created, Updated
        ) VALUES (
            1, 'Tune The Scheduler', 'TendrilService', 'Feature', 'Draft',
            '/plans/00001-TuneTheScheduler', '00001-TuneTheScheduler', '', 1, '',
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        )
        "#,
        [],
    )
    .expect("insert plan the recommendation belongs to");

    conn.execute(
        r#"
        INSERT INTO Recommendations (
            PlanId, Title, Description, State, DeclineReason, Notes, PlanTitle, PlanFolderName,
            Project, Date, SourcePlanStatus, Impact
        ) VALUES (
            1, 'Add Index', 'Index the jobs table', 'AcceptedWithNotes', NULL, 'After 0.2',
            'Tune The Scheduler', '00001-TuneTheScheduler', 'TendrilService',
            '2026-01-01T00:00:00Z', 'Draft', 'High'
        )
        "#,
        [],
    )
    .expect("insert must succeed against the repaired table");

    let rows = get_recommendations(&conn, None, None).expect("query recommendations");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].notes.as_deref(), Some("After 0.2"));
}
