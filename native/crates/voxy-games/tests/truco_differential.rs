use serde_json::{Value, json};
use voxy_games::truco::{Action, TrucoGame};
#[test]
fn every_card_strength_manilha_and_tie_combination_matches_typescript() {
    use voxy_games::truco::{Card, card_strength, hand_winner, manilha};
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../evidence/native-2.0/functional/truco-fixtures.json"
    ))
    .unwrap();
    assert_eq!(fixture["strengths"].as_array().unwrap().len(), 1600);
    for case in fixture["strengths"].as_array().unwrap() {
        let vira: Card = serde_json::from_value(case["vira"].clone()).unwrap();
        let card: Card = serde_json::from_value(case["card"].clone()).unwrap();
        assert_eq!(
            card_strength(card, vira) as i64,
            case["strength"].as_i64().unwrap()
        );
        assert_eq!(
            serde_json::to_value(manilha(vira)).unwrap(),
            case["manilha"]
        );
    }
    for case in fixture["ties"].as_array().unwrap() {
        let tricks: Vec<Option<usize>> = serde_json::from_value(case["tricks"].clone()).unwrap();
        let result = hand_winner(&tricks);
        assert_eq!(result.is_some(), case["complete"].as_bool().unwrap());
        assert_eq!(
            serde_json::to_value(result.flatten()).unwrap(),
            case["winner"]
        );
    }
}

#[test]
fn typescript_oracle_matches_every_public_and_private_snapshot() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../../evidence/native-2.0/functional/truco-fixtures.json"
    ))
    .unwrap();
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let mut seed = scenario["seed"].as_u64().unwrap() as u32;
        let mut game = TrucoGame::with_random(move |max| {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            seed as usize % max
        });
        for (index, step) in scenario["steps"].as_array().unwrap().iter().enumerate() {
            let context = format!("{} step {index}: {}", scenario["name"], step["op"]);
            let now = step["now"].as_i64().unwrap_or(0);
            let result: anyhow::Result<Value> = match step["op"].as_str().unwrap() {
                "join" => game
                    .join(
                        step["id"].as_str().unwrap(),
                        now,
                        step["seat"].as_u64().map(|v| v as usize),
                    )
                    .map(|_| Value::Null),
                "leave" => game
                    .leave(step["id"].as_str().unwrap())
                    .map(|_| Value::Null),
                "advance" => game.advance(now).map(|v| json!(v)),
                "sync" => game
                    .sync(
                        &step["online"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|v| v.as_str().unwrap().to_string())
                            .collect(),
                        now,
                    )
                    .map(|v| json!(v)),
                "act" => game
                    .act(
                        step["id"].as_str().unwrap(),
                        serde_json::from_value::<Action>(step["action"].clone()).unwrap(),
                        step["revision"].as_u64().unwrap(),
                        now,
                    )
                    .map(|_| Value::Null),
                _ => panic!("unknown operation"),
            };
            match result {
                Ok(result) => {
                    assert!(
                        step["error"].is_null(),
                        "{context}: expected error {}",
                        step["error"]
                    );
                    assert_eq!(result, step["result"], "{context}");
                }
                Err(error) => assert_eq!(
                    error.to_string(),
                    step["error"].as_str().unwrap_or("NO ERROR"),
                    "{context}"
                ),
            }
            for (viewer, expected) in [None, Some("p0"), Some("p1"), Some("p2"), Some("p3")]
                .into_iter()
                .zip(step["views"].as_array().unwrap())
            {
                assert_eq!(
                    serde_json::to_value(game.view(viewer)).unwrap(),
                    *expected,
                    "{context}, viewer {viewer:?}"
                );
            }
        }
    }
}
