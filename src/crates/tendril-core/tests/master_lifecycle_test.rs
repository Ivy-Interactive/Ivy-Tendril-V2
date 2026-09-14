use tendril_core::config::{
    default_capabilities, read_master, write_master, write_master_info, MasterGuard, MasterInfo,
};

#[test]
fn test_atomic_write_master_permissions() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-atomic-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    write_master(&test_dir, 5010, "secret-token-123", "127.0.0.1").unwrap();

    let master_file = test_dir.join(".master");
    assert!(master_file.exists());

    let mut tmp_files = 0;
    for entry in std::fs::read_dir(&test_dir).unwrap().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(".master.tmp.") {
            tmp_files += 1;
        }
    }
    assert_eq!(tmp_files, 0);

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let metadata = std::fs::metadata(&master_file).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "Expected file permissions to be 0600, got {:o}",
            mode
        );
    }

    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_master_info_version_and_capabilities() {
    let legacy_json = r#"{
        "port": 5010,
        "pid": 12345,
        "secret": "legacy-secret",
        "startedAt": "2026-09-01T00:00:00Z"
    }"#;
    let legacy_info: MasterInfo = serde_json::from_str(legacy_json).unwrap();
    assert_eq!(legacy_info.port, 5010);
    assert_eq!(legacy_info.pid, 12345);
    assert_eq!(legacy_info.secret, "legacy-secret");
    assert_eq!(legacy_info.host, "127.0.0.1");
    assert_eq!(legacy_info.api_version, 1);
    assert!(legacy_info.capabilities.is_empty());

    let full_info = MasterInfo {
        port: 5020,
        pid: 67890,
        secret: "new-secret".to_string(),
        started_at: "2026-09-05T12:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: vec![
            "jobs".to_string(),
            "plans".to_string(),
            "auth_bearer".to_string(),
        ],
    };
    let json = serde_json::to_string(&full_info).unwrap();
    let deserialized: MasterInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.port, 5020);
    assert_eq!(deserialized.host, "127.0.0.1");
    assert_eq!(deserialized.version, "0.1.0");
    assert_eq!(deserialized.api_version, 1);
    assert_eq!(deserialized.capabilities.len(), 3);
}

#[test]
fn test_stale_master_detection_and_cleanup() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-stale-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let stale_info = MasterInfo {
        port: 49199,
        pid: 99999999,
        secret: "stale-secret".to_string(),
        started_at: "2020-01-01T00:00:00Z".to_string(),
        host: "127.0.0.1".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
    };
    write_master_info(&test_dir, &stale_info).unwrap();
    assert!(read_master(&test_dir).is_some());

    let guard = MasterGuard::acquire(&test_dir, 5010, "fresh-secret", "127.0.0.1").unwrap();
    assert_eq!(guard.pid(), std::process::id());

    let current = read_master(&test_dir).unwrap();
    assert_eq!(current.pid, std::process::id());
    assert_eq!(current.secret, "fresh-secret");

    drop(guard);
    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_live_master_collision_prevention() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-collision-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();

    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    let running_clone = running.clone();

    let server_thread = std::thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        while running_clone.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut socket, _)) => {
                    use std::io::{Read, Write};
                    let mut buf = [0u8; 1024];
                    let _ = socket.read(&mut buf);
                    let resp =
                        "HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\npong";
                    let _ = socket.write_all(resp.as_bytes());
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => break,
            }
        }
    });

    let live_info = MasterInfo {
        port,
        pid: std::process::id(),
        secret: "live-secret".to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: "127.0.0.1".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
    };
    write_master_info(&test_dir, &live_info).unwrap();

    let err = MasterGuard::acquire(&test_dir, 5011, "second-secret", "127.0.0.1");
    assert!(err.is_err());
    let err_msg = err.err().unwrap().to_string();
    assert!(
        err_msg.contains("Another Tendril instance is running"),
        "Expected collision error, got: {}",
        err_msg
    );

    running.store(false, std::sync::atomic::Ordering::Relaxed);
    let _ = server_thread.join();
    let _ = std::fs::remove_dir_all(test_dir);
}

#[test]
fn test_master_guard_drop_preserves_foreign_pid() {
    let test_dir = std::env::temp_dir().join(format!(
        "tendril-foreign-test-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&test_dir).unwrap();

    let guard = MasterGuard::acquire(&test_dir, 5010, "guard-secret", "127.0.0.1").unwrap();
    assert!(read_master(&test_dir).is_some());

    let foreign_info = MasterInfo {
        port: 5012,
        pid: 99999998,
        secret: "foreign-secret".to_string(),
        started_at: chrono::Utc::now().to_rfc3339(),
        host: "127.0.0.1".to_string(),
        version: "0.1.0".to_string(),
        api_version: 1,
        capabilities: default_capabilities(),
    };
    write_master_info(&test_dir, &foreign_info).unwrap();

    drop(guard);

    let after_drop = read_master(&test_dir);
    assert!(
        after_drop.is_some(),
        ".master should not have been deleted on drop of foreign guard"
    );
    assert_eq!(after_drop.unwrap().pid, 99999998);

    let _ = std::fs::remove_dir_all(test_dir);
}
