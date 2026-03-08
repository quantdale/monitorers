use std::collections::HashMap;

// ── CPU TEMPERATURE (WMI ROOT\CIMV2) ───────────────────────────────────────────

/// Tenths of Kelvin to Celsius. Returns None if outside -50..=150 °C.
pub fn tenths_kelvin_to_celsius_checked(tenths_kelvin: f64) -> Option<f64> {
    let temp_c = (tenths_kelvin / 10.0) - 273.15;
    if temp_c >= -50.0 && temp_c <= 150.0 {
        Some(temp_c)
    } else {
        None
    }
}

/// Extract tenths-of-Kelvin from a WMI Variant. Handles UI4, UI8, I4, I8, R4, R8, String.
pub fn variant_to_tenths_kelvin(v: Option<&wmi::Variant>) -> Option<f64> {
    let tenths = match v? {
        wmi::Variant::UI4(n) => *n as f64,
        wmi::Variant::UI8(n) => *n as f64,
        wmi::Variant::I4(n) => (*n).max(0) as f64,
        wmi::Variant::I8(n) => (*n).max(0) as f64,
        wmi::Variant::R4(n) => *n as f64,
        wmi::Variant::R8(n) => *n,
        wmi::Variant::String(s) => s.parse::<f64>().unwrap_or(0.0),
        _ => return None,
    };
    Some(tenths)
}

/// Query CPU temperature from thermal zone info (ROOT\CIMV2).
/// Uses Win32_PerfFormattedData_Counters_ThermalZoneInformation.HighPrecisionTemperature
/// (tenths of Kelvin). Iterates all zones and returns max temp in Celsius, or None.
pub fn query_cpu_temp_c(wmi_con: Option<&wmi::WMIConnection>) -> Option<f64> {
    let con = wmi_con?;
    let rows = con
        .raw_query::<HashMap<String, wmi::Variant>>(
            "SELECT HighPrecisionTemperature FROM Win32_PerfFormattedData_Counters_ThermalZoneInformation",
        )
        .ok()?;
    let mut max_c: Option<f64> = None;
    for row in &rows {
        let tenths = variant_to_tenths_kelvin(row.get("HighPrecisionTemperature"));
        if let Some(t) = tenths {
            if let Some(c) = tenths_kelvin_to_celsius_checked(t) {
                max_c = Some(max_c.map_or(c, |m| m.max(c)));
            }
        }
    }
    max_c
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- variant_to_tenths_kelvin ---

    #[test]
    fn test_variant_to_tenths_kelvin_ui4() {
        // 3232 tenths K ≈ 50 °C
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::UI4(3232))),
            Some(3232.0)
        );
    }

    #[test]
    fn test_variant_to_tenths_kelvin_ui8() {
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::UI8(2732))),
            Some(2732.0)
        );
    }

    #[test]
    fn test_variant_to_tenths_kelvin_i4() {
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::I4(3000))),
            Some(3000.0)
        );
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::I4(-1))),
            Some(0.0)
        ); // clamped
    }

    #[test]
    fn test_variant_to_tenths_kelvin_i8() {
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::I8(3232))),
            Some(3232.0)
        );
    }

    #[test]
    fn test_variant_to_tenths_kelvin_r4() {
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::R4(3232.0))),
            Some(3232.0)
        );
    }

    #[test]
    fn test_variant_to_tenths_kelvin_r8() {
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::R8(2731.5))),
            Some(2731.5)
        );
    }

    #[test]
    fn test_variant_to_tenths_kelvin_string() {
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::String("3232".into()))),
            Some(3232.0)
        );
        assert_eq!(
            variant_to_tenths_kelvin(Some(&wmi::Variant::String("invalid".into()))),
            Some(0.0)
        );
    }

    #[test]
    fn test_variant_to_tenths_kelvin_none() {
        assert_eq!(variant_to_tenths_kelvin(None), None);
    }

    // --- tenths_kelvin_to_celsius_checked ---

    #[test]
    fn test_tenths_kelvin_to_celsius_zero() {
        // 2732 tenths of K = 273.2 K ≈ 0.05 °C (water freezing)
        let r = tenths_kelvin_to_celsius_checked(2732.0).unwrap();
        assert!((r - 0.05).abs() < 1e-9, "expected ~0.05, got {}", r);
        // 2731.5 → 0 °C exactly
        assert_eq!(tenths_kelvin_to_celsius_checked(2731.5), Some(0.0));
    }

    #[test]
    fn test_tenths_kelvin_to_celsius_50c() {
        let r = tenths_kelvin_to_celsius_checked(3232.0).unwrap();
        assert!((r - 50.05).abs() < 1e-9, "expected ~50.05, got {}", r);
    }

    #[test]
    fn test_tenths_kelvin_to_celsius_below_range_returns_none() {
        // -51 °C: tenths = (-51 + 273.15) * 10 = 2221.5
        assert_eq!(tenths_kelvin_to_celsius_checked(2221.5), None);
    }

    #[test]
    fn test_tenths_kelvin_to_celsius_above_range_returns_none() {
        // 151 °C: tenths = (151 + 273.15) * 10 = 4241.5
        assert_eq!(tenths_kelvin_to_celsius_checked(4241.5), None);
    }

    #[test]
    fn test_tenths_kelvin_to_celsius_boundary_minus_50() {
        // -50 °C: tenths = (-50 + 273.15) * 10 = 2231.5
        let r = tenths_kelvin_to_celsius_checked(2231.5).unwrap();
        assert!((r - (-50.0)).abs() < 1e-9, "expected ~-50.0, got {}", r);
    }

    #[test]
    fn test_tenths_kelvin_to_celsius_boundary_150() {
        // 150 °C: tenths = (150 + 273.15) * 10 = 4231.5
        assert_eq!(tenths_kelvin_to_celsius_checked(4231.5), Some(150.0));
    }
}
