use serde_json::Value;
use voxy_games::chess::{Action, ChessGame};
fn normalize(mut value: Value) -> Value {
    for key in ["moves", "claimMoves"] {
        value[key].as_array_mut().unwrap().sort_by_key(|m| {
            format!(
                "{}{}{}",
                m["from"].as_str().unwrap(),
                m["to"].as_str().unwrap(),
                m["promotion"].as_str().unwrap_or("")
            )
        });
    }
    value
}
#[test]
fn typescript_chess_wrapper_oracle_matches_native_rules() {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../../evidence/native-2.0/functional/chess-fixtures.json"
    ))
    .unwrap();
    for scenario in fixtures["scenarios"].as_array().unwrap() {
        let mut game = ChessGame::new(scenario["fen"].as_str()).unwrap();
        for (i, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
            let context = format!("{} step {i} {}", scenario["name"], step["op"]);
            let id = step["id"].as_str().unwrap_or("");
            let now = step["now"].as_i64().unwrap_or(0);
            let result = match step["op"].as_str().unwrap() {
                "join" => game.join(id, now, step["seat"].as_u64().map(|v| v as usize)),
                "leave" => game.leave(id),
                "sync" => game.sync(
                    &step["online"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| v.as_str().unwrap().to_string())
                        .collect(),
                    now,
                ),
                "act" => game.act(
                    id,
                    serde_json::from_value::<Action>(step["action"].clone()).unwrap(),
                    step["revision"].as_u64().unwrap_or(game.revision()),
                    now,
                ),
                _ => panic!("unknown operation"),
            };
            match result {
                Ok(()) => assert!(
                    step["error"].is_null(),
                    "{context}: expected {}",
                    step["error"]
                ),
                Err(error) => assert_eq!(
                    error.to_string(),
                    step["error"].as_str().unwrap_or("NO ERROR"),
                    "{context}"
                ),
            }
            for (viewer, expected) in [None, Some("white"), Some("black")]
                .into_iter()
                .zip(step["views"].as_array().unwrap())
            {
                assert_eq!(
                    normalize(serde_json::to_value(game.view(viewer)).unwrap()),
                    normalize(expected.clone()),
                    "{context}, viewer {viewer:?}"
                );
            }
        }
    }
}
