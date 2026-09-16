use axum::{
    extract::Path,
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::json;
use std::collections::HashMap;
use std::net::SocketAddr;
use tendril_app_lib::models::{CreateSessionDto, EnqueueItemDto, ExecuteTurnDto, PostMessageDto};
use tendril_app_lib::service::ws_bridge::route_ws_message;
use tendril_app_lib::service::TendrilClient;
use tokio::net::TcpListener;

async fn spawn_mock_chat_service(
    secret: &'static str,
) -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let auth_check = move |headers: &HeaderMap| -> bool {
        if let Some(auth) = headers.get(axum::http::header::AUTHORIZATION) {
            if let Ok(s) = auth.to_str() {
                return s == format!("Bearer {secret}");
            }
        }
        false
    };

    let app = Router::new()
        .route(
            "/api/chat/sessions",
            get(move |headers: HeaderMap| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!([
                        {
                            "id": "session-1",
                            "title": "Existing Session",
                            "createdAt": "2026-09-07T12:00:00Z",
                            "updatedAt": "2026-09-07T12:00:00Z",
                            "messages": [],
                            "spawnedJobIds": []
                        }
                    ])),
                )
            })
            .post(move |headers: HeaderMap, Json(body): Json<CreateSessionDto>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::CREATED,
                    Json(json!({
                        "id": "session-new",
                        "title": body.title.unwrap_or_else(|| "New Chat".to_string()),
                        "createdAt": "2026-09-07T12:00:00Z",
                        "updatedAt": "2026-09-07T12:00:00Z",
                        "agentId": body.agent_id,
                        "modelId": body.model_id,
                        "effort": body.effort,
                        "planFolderName": body.plan_folder_name,
                        "messages": [],
                        "spawnedJobIds": []
                    })),
                )
            }),
        )
        .route(
            "/api/chat/sessions/{id}",
            get(move |headers: HeaderMap, Path(id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!({
                        "id": id,
                        "title": "Detailed Session",
                        "createdAt": "2026-09-07T12:00:00Z",
                        "updatedAt": "2026-09-07T12:00:00Z",
                        "messages": [
                            {
                                "id": "m1",
                                "role": "user",
                                "content": "Ping",
                                "timestamp": "2026-09-07T12:00:00Z"
                            }
                        ],
                        "spawnedJobIds": []
                    })),
                )
            })
            .put(move |headers: HeaderMap, Path(id): Path<String>, Json(body): Json<serde_json::Value>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!({
                        "id": id,
                        "title": body["title"],
                        "createdAt": "2026-09-07T12:00:00Z",
                        "updatedAt": "2026-09-07T12:01:00Z",
                        "messages": [],
                        "spawnedJobIds": []
                    })),
                )
            })
            .delete(move |headers: HeaderMap, Path(_id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "deleted": true })))
            }),
        )
        .route(
            "/api/chat/sessions/{id}/messages",
            post(move |headers: HeaderMap, Path(_id): Path<String>, Json(body): Json<PostMessageDto>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                if body.enqueue.unwrap_or(false) {
                    (StatusCode::ACCEPTED, Json(json!({ "queued": true, "id": "q-item-1" })))
                } else {
                    (StatusCode::OK, Json(json!({ "started": true })))
                }
            }),
        )
        .route(
            "/api/chat/sessions/{id}/execute",
            post(move |headers: HeaderMap, Path(_id): Path<String>, Json(_body): Json<ExecuteTurnDto>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "started": true })))
            }),
        )
        .route(
            "/api/chat/sessions/{id}/cancel",
            post(move |headers: HeaderMap, Path(_id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "cancelled": true })))
            }),
        )
        .route(
            "/api/chat/sessions/{session_id}/messages/{msg_id}/answers",
            post(move |headers: HeaderMap, Path((session_id, _msg_id)): Path<(String, String)>, Json(body): Json<serde_json::Value>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                let answers = body.get("answers").cloned().unwrap_or(json!({}));
                (
                    StatusCode::OK,
                    Json(json!({
                        "id": session_id,
                        "title": "Answered Session",
                        "createdAt": "2026-09-07T12:00:00Z",
                        "updatedAt": "2026-09-07T12:02:00Z",
                        "messages": [
                            {
                                "id": "m-ans",
                                "role": "assistant",
                                "content": format!("Received answers: {answers}"),
                                "timestamp": "2026-09-07T12:02:00Z"
                            }
                        ],
                        "spawnedJobIds": []
                    })),
                )
            }),
        )
        .route(
            "/api/chat/sessions/{id}/queue",
            get(move |headers: HeaderMap, Path(_id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::OK,
                    Json(json!([
                        {
                            "id": "q1",
                            "prompt": "Queued task 1",
                            "createdAt": "2026-09-07T12:03:00Z"
                        }
                    ])),
                )
            })
            .post(move |headers: HeaderMap, Path(_id): Path<String>, Json(body): Json<EnqueueItemDto>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (
                    StatusCode::CREATED,
                    Json(json!({
                        "id": "q-new",
                        "prompt": body.prompt,
                        "createdAt": "2026-09-07T12:04:00Z"
                    })),
                )
            })
            .delete(move |headers: HeaderMap, Path(_id): Path<String>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::NO_CONTENT, Json(json!({})))
            }),
        )
        .route(
            "/api/chat/sessions/{session_id}/queue/{item_id}",
            delete(move |headers: HeaderMap, Path((_session_id, _item_id)): Path<(String, String)>| async move {
                if !auth_check(&headers) {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
                }
                (StatusCode::OK, Json(json!({ "deleted": true })))
            }),
        );

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    (addr, handle)
}

#[tokio::test]
async fn test_chat_client_crud_and_queue_methods() {
    let secret = "mock-secret-42";
    let (addr, _server) = spawn_mock_chat_service(secret).await;
    let base_url = format!("http://{}", addr);
    let client = TendrilClient::new(base_url, Some(secret.to_string()));

    // 1. List sessions
    let sessions = client
        .list_chat_sessions()
        .await
        .expect("list_chat_sessions");
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, "session-1");
    assert_eq!(sessions[0].title, "Existing Session");

    // 2. Create session
    let created = client
        .create_chat_session(CreateSessionDto {
            title: Some("My New Chat".to_string()),
            agent_id: Some("claude".to_string()),
            model_id: Some("sonnet".to_string()),
            effort: Some("high".to_string()),
            // The plan this session belongs to. `PlanChatSessions.BelongsTo` is defined on it, so it has
            // to reach the daemon on the way out *and* come back on the way in: the plan page finds its
            // own conversation by this field and nothing else, and a session that lost it would look
            // like no session at all, so the next message would attach a second one to the same plan.
            plan_folder_name: Some("00021-BuildDesktopOperator".to_string()),
        })
        .await
        .expect("create_chat_session");
    assert_eq!(created.id, "session-new");
    assert_eq!(created.title, "My New Chat");
    assert_eq!(created.agent_id.as_deref(), Some("claude"));
    assert_eq!(
        created.plan_folder_name.as_deref(),
        Some("00021-BuildDesktopOperator"),
        "the plan attachment must survive the round trip"
    );

    // And a session with no plan carries no attachment rather than an empty one, which is what keeps
    // "belongs to no plan" distinguishable from "belongs to a plan called nothing".
    let plain = client
        .create_chat_session(CreateSessionDto {
            title: Some("Just A Chat".to_string()),
            ..Default::default()
        })
        .await
        .expect("create_chat_session");
    assert_eq!(plain.plan_folder_name, None);

    // 3. Get session
    let fetched = client
        .get_chat_session("session-new")
        .await
        .expect("get_chat_session");
    assert_eq!(fetched.id, "session-new");
    assert_eq!(fetched.messages.len(), 1);

    // 4. Update session
    let updated = client
        .update_chat_session("session-new", "Renamed Title")
        .await
        .expect("update_chat_session");
    assert_eq!(updated.title, "Renamed Title");

    // 5. Post message (started)
    let post_res = client
        .post_chat_message(
            "session-new",
            PostMessageDto {
                prompt: "Hello world".to_string(),
                enqueue: Some(false),
                attachments: None,
                role: None,
            },
        )
        .await
        .expect("post_chat_message");
    assert_eq!(post_res["started"], true);

    // 6. Post message (enqueue)
    let queue_res = client
        .post_chat_message(
            "session-new",
            PostMessageDto {
                prompt: "Queue me".to_string(),
                enqueue: Some(true),
                attachments: None,
                role: None,
            },
        )
        .await
        .expect("post_chat_message enqueue");
    assert_eq!(queue_res["queued"], true);

    // 7. Execute turn
    client
        .execute_chat_turn(
            "session-new",
            ExecuteTurnDto {
                prompt: Some("Run now".to_string()),
                agent_id: None,
                model_id: None,
                effort: None,
            },
        )
        .await
        .expect("execute_chat_turn");

    // 8. Cancel turn
    let cancelled = client
        .cancel_chat_turn("session-new")
        .await
        .expect("cancel_chat_turn");
    assert!(cancelled);

    // 9. Answer questions
    let mut answers = HashMap::new();
    answers.insert("framework".to_string(), vec!["axum".to_string()]);
    let ans_session = client
        .answer_chat_questions("session-new", "m-q", answers)
        .await
        .expect("answer_chat_questions");
    assert!(ans_session.messages[0].content.contains("framework"));

    // 10. Get queue
    let queue = client
        .get_chat_queue("session-new")
        .await
        .expect("get_chat_queue");
    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].id, "q1");

    // 11. Enqueue item
    let enqueued = client
        .enqueue_chat_message(
            "session-new",
            EnqueueItemDto {
                prompt: "Enqueued task".to_string(),
                attachments: None,
            },
        )
        .await
        .expect("enqueue_chat_message");
    assert_eq!(enqueued.id, "q-new");

    // 12. Delete queued item
    client
        .delete_queued_chat_item("session-new", "q-new")
        .await
        .expect("delete_queued_chat_item");

    // 13. Clear queue
    client
        .clear_chat_queue("session-new")
        .await
        .expect("clear_chat_queue");

    // 14. Delete session
    client
        .delete_chat_session("session-new")
        .await
        .expect("delete_chat_session");
}

#[test]
fn test_ws_bridge_chat_event_routing() {
    // 1. stream_delta
    let delta = json!({
        "type": "chat.stream_delta",
        "sessionId": "s-10",
        "messageId": "m-10",
        "delta": "Stream chunk"
    })
    .to_string();
    let (event_name, payload) = route_ws_message(&delta);
    assert_eq!(event_name, "chat-event");
    assert_eq!(payload["delta"], "Stream chunk");

    // 2. message_added
    let msg_added = json!({
        "type": "chat.message_added",
        "sessionId": "s-10",
        "message": {
            "id": "m-10",
            "role": "assistant",
            "content": "Full response"
        }
    })
    .to_string();
    let (event_name, payload) = route_ws_message(&msg_added);
    assert_eq!(event_name, "chat-event");
    assert_eq!(payload["message"]["content"], "Full response");

    // 3. generating_state
    let gen_state = json!({
        "type": "chat.generating_state",
        "sessionId": "s-10",
        "isGenerating": true
    })
    .to_string();
    let (event_name, payload) = route_ws_message(&gen_state);
    assert_eq!(event_name, "chat-event");
    assert_eq!(payload["isGenerating"], true);

    // 4. question_answered
    let q_answered = json!({
        "type": "chat.question_answered",
        "sessionId": "s-10",
        "messageId": "m-10",
        "answers": {
            "choice": ["A"]
        }
    })
    .to_string();
    let (event_name, payload) = route_ws_message(&q_answered);
    assert_eq!(event_name, "chat-event");
    assert_eq!(payload["answers"]["choice"][0], "A");

    // 5. job_spawned
    let job_spawned = json!({
        "type": "chat.job_spawned",
        "sessionId": "s-10",
        "jobId": "00400"
    })
    .to_string();
    let (event_name, payload) = route_ws_message(&job_spawned);
    assert_eq!(event_name, "chat-event");
    assert_eq!(payload["jobId"], "00400");
}
