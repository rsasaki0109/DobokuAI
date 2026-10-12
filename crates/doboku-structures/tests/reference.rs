use doboku_structures::{solve, GravityDam};

#[test]
fn compares_independent_integrated_loads_moments_and_contact() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../examples/dam-reference.json")).unwrap();
    for case in fixture["cases"].as_array().unwrap() {
        let input: GravityDam = serde_json::from_value(case["input"].clone()).unwrap();
        let actual = serde_json::to_value(solve(&input).unwrap()).unwrap();
        for (key, expected) in case["expected"].as_object().unwrap() {
            match expected.as_f64() {
                Some(number) => {
                    let value = actual[key].as_f64().unwrap();
                    assert!(
                        (value - number).abs() <= 1e-9 * number.abs().max(1.0),
                        "{}: {key}: {value} vs {number}",
                        case["name"]
                    );
                }
                None => assert_eq!(&actual[key], expected, "{}: {key}", case["name"]),
            }
        }
    }
}
