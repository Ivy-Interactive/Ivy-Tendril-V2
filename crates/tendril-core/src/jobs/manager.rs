use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use chrono::Utc;
use tokio::sync::{RwLock, Semaphore};
use crate::agents::providers::{build_agent_spec, AgentLaunchConfig};
use crate::agents::runner::run_agent_process;
use crate::config::TendrilSettings;
use crate::db::jobs::{get_job, insert_job, list_jobs};
use crate::db::open_database;
use crate::error::Result;
use crate::jobs::logger::{append_agent_log, append_to_eventwire, append_to_raw_log};
use crate::models::{JobArgs, JobItem, JobStatus, PlanStatus};
use crate::plans::reader::read_plan_yaml;
use crate::plans::writer::write_plan_yaml;
use crate::promptware::compiler::compile_firmware;

pub struct JobManager {
    tendril_home: PathBuf,
    settings: Arc<RwLock<TendrilSettings>>,
    jobs: Arc<RwLock<HashMap<String, JobItem>>>,
    semaphore: Arc<Semaphore>,
}

impl JobManager {
    pub fn new(tendril_home: PathBuf, settings: TendrilSettings) -> Self {
        let max_jobs = settings.max_concurrent_jobs.max(1) as usize;
        Self {
            tendril_home,
            settings: Arc::new(RwLock::new(settings)),
            jobs: Arc::new(RwLock::new(HashMap::new())),
            semaphore: Arc::new(Semaphore::new(max_jobs)),
        }
    }

    pub async fn allocate_job_id(&self) -> Result<String> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;

        let mut stmt = conn.prepare("SELECT Id FROM Jobs WHERE Id GLOB '[0-9][0-9][0-9][0-9][0-9]' ORDER BY Id DESC LIMIT 1")?;
        let mut rows = stmt.query([])?;
        let max_id = if let Some(row) = rows.next()? {
            let id_str: String = row.get(0)?;
            id_str.parse::<i32>().unwrap_or(0)
        } else {
            0
        };

        Ok(format!("{:05}", max_id + 1))
    }

    pub async fn start_job(&self, args: JobArgs) -> Result<String> {
        let job_id = self.allocate_job_id().await?;
        let job_type = args.job_type().to_string();
        let plan_folder_str = args.plan_folder().unwrap_or("").to_string();

        let settings = self.settings.read().await.clone();
        let default_agent = settings.coding_agent.clone();

        let mut job = JobItem::new(job_id.clone(), job_type.clone(), plan_folder_str.clone(), "Auto".to_string());
        job.provider = default_agent;
        job.status = JobStatus::Queued;
        job.started_at = Some(Utc::now());
        job.typed_args = Some(args.clone());
        job.args = serde_json::to_string(&args).ok();

        // Update plan state if applicable
        if !plan_folder_str.is_empty() {
            let p_folder = PathBuf::from(&plan_folder_str);
            if p_folder.exists() {
                if let Ok((mut plan, _)) = read_plan_yaml(&p_folder) {
                    if job_type == "ExecutePlan" || job_type == "RetryPlan" {
                        plan.state = PlanStatus::Executing.to_string();
                    } else if job_type == "CreatePlan" || job_type == "ExpandPlan" {
                        plan.state = PlanStatus::Creating.to_string();
                    } else if job_type == "UpdatePlan" || job_type == "SplitPlan" {
                        plan.state = PlanStatus::Updating.to_string();
                    }
                    plan.updated = Utc::now();
                    let _ = write_plan_yaml(&p_folder, &plan);
                }
            }
        }

        // Persist to DB and memory
        {
            let mut map = self.jobs.write().await;
            map.insert(job_id.clone(), job.clone());
        }

        let db_path = crate::config::get_database_path(&self.tendril_home);
        if let Ok(conn) = open_database(&db_path) {
            let _ = insert_job(&conn, &job);
        }

        // Spawn async execution
        let tendril_home_clone = self.tendril_home.clone();
        let jobs_map = self.jobs.clone();
        let sem = self.semaphore.clone();
        let job_id_clone = job_id.clone();

        tokio::spawn(async move {
            let _permit = match sem.acquire().await {
                Ok(p) => p,
                Err(_) => return,
            };

            // Transition to Running
            {
                let mut map = jobs_map.write().await;
                if let Some(j) = map.get_mut(&job_id_clone) {
                    j.status = JobStatus::Running;
                }
            }

            let start_time = std::time::Instant::now();
            let mut promptware_values = HashMap::new();
            promptware_values.insert("TendrilJobId".to_string(), job_id_clone.clone());

            let promptware_folder = tendril_home_clone.join("Promptwares").join(&job_type);
            let compiled_prompt = if promptware_folder.exists() {
                compile_firmware(&promptware_folder, &promptware_values).unwrap_or_else(|_| "Execute job".to_string())
            } else {
                format!("Execute {} for plan {}", job_type, plan_folder_str)
            };

            let working_dir = if !plan_folder_str.is_empty() {
                PathBuf::from(&plan_folder_str)
            } else {
                tendril_home_clone.clone()
            };

            let launch_config = AgentLaunchConfig {
                prompt: compiled_prompt,
                working_directory: working_dir,
                model: None,
                effort: None,
                allowed_tools: Vec::new(),
                extra_args: Vec::new(),
            };

            let spec = build_agent_spec(&job.provider, &launch_config);

            let th = tendril_home_clone.clone();
            let jid = job_id_clone.clone();

            let run_res = run_agent_process(spec, move |evt| {
                let _ = append_to_raw_log(&th, &jid, &evt.raw_line);
                let _ = append_to_eventwire(&th, &jid, &evt.raw_line);
            }).await;

            let duration = start_time.elapsed().as_secs() as i64;
            let (final_status, msg) = match run_res {
                Ok(0) => (JobStatus::Completed, "Completed successfully".to_string()),
                Ok(code) => (JobStatus::Failed, format!("Process exited with code {}", code)),
                Err(e) => (JobStatus::Failed, format!("Execution failed: {}", e)),
            };

            // Update in-memory & DB
            {
                let mut map = jobs_map.write().await;
                if let Some(j) = map.get_mut(&job_id_clone) {
                    j.status = final_status;
                    j.completed_at = Some(Utc::now());
                    j.duration_seconds = Some(duration);
                    j.status_message = Some(msg);

                    // If completed, update plan state if needed
                    if !j.plan_file.is_empty() && final_status == JobStatus::Completed {
                        let pf = PathBuf::from(&j.plan_file);
                        if pf.exists() {
                            if let Ok((mut plan, _)) = read_plan_yaml(&pf) {
                                if j.job_type == "ExecutePlan" {
                                    plan.state = PlanStatus::Review.to_string();
                                } else if j.job_type == "CreatePlan" || j.job_type == "UpdatePlan" {
                                    plan.state = PlanStatus::Draft.to_string();
                                }
                                plan.updated = Utc::now();
                                let _ = write_plan_yaml(&pf, &plan);
                            }
                        }
                    }

                    let db_path = crate::config::get_database_path(&tendril_home_clone);
                    if let Ok(conn) = open_database(&db_path) {
                        let _ = insert_job(&conn, j);
                    }
                }
            }
        });

        Ok(job_id)
    }

    pub async fn get_job(&self, id: &str) -> Result<Option<JobItem>> {
        {
            let map = self.jobs.read().await;
            if let Some(j) = map.get(id) {
                return Ok(Some(j.clone()));
            }
        }

        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        get_job(&conn, id).map_err(Into::into)
    }

    pub async fn update_job_status(&self, id: &str, message: &str, plan_id: Option<&str>, plan_title: Option<&str>) -> Result<bool> {
        let mut map = self.jobs.write().await;
        if let Some(job) = map.get_mut(id) {
            job.status_message = Some(message.to_string());
            if let Some(pid) = plan_id {
                job.reported_plan_id = Some(pid.to_string());
            }
            if let Some(title) = plan_title {
                job.reported_plan_title = Some(title.to_string());
            }

            let db_path = crate::config::get_database_path(&self.tendril_home);
            if let Ok(conn) = open_database(&db_path) {
                let _ = insert_job(&conn, job);
            }
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn report_job_failure(&self, id: &str, message: &str) -> Result<bool> {
        let mut map = self.jobs.write().await;
        if let Some(job) = map.get_mut(id) {
            job.status = JobStatus::Failed;
            job.reported_failure_reason = Some(message.to_string());
            job.completed_at = Some(Utc::now());

            let db_path = crate::config::get_database_path(&self.tendril_home);
            if let Ok(conn) = open_database(&db_path) {
                let _ = insert_job(&conn, job);
            }
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn cancel_job(&self, id: &str, message: Option<&str>) -> Result<bool> {
        let mut map = self.jobs.write().await;
        if let Some(job) = map.get_mut(id) {
            job.status = JobStatus::Stopped;
            if let Some(msg) = message {
                job.status_message = Some(msg.to_string());
            }
            job.completed_at = Some(Utc::now());

            let db_path = crate::config::get_database_path(&self.tendril_home);
            if let Ok(conn) = open_database(&db_path) {
                let _ = insert_job(&conn, job);
            }
            return Ok(true);
        }
        Ok(false)
    }

    pub fn add_log(&self, id: &str, action: &str, summary: Option<&str>) -> Result<PathBuf> {
        append_agent_log(&self.tendril_home, id, action, summary)
    }

    pub async fn list_jobs(&self, status_filter: Option<JobStatus>, limit: usize) -> Result<Vec<JobItem>> {
        let db_path = crate::config::get_database_path(&self.tendril_home);
        let conn = open_database(&db_path)?;
        list_jobs(&conn, status_filter, limit).map_err(Into::into)
    }
}
