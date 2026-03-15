# Parametric Rolling Calculator

Professional mariner-standard parametric rolling calculator with live weather integration.

## Features

- **IMO MSC.1/Circ.1228** compliant parametric roll risk assessment
- **Nautical coordinate input** (DD-MM.M N/S, DDD-MM.M E/W) matching bridge equipment conventions
- **Live weather integration** via Open-Meteo Marine API (DWD ICON + ECMWF WAM wave models)
- **Risk gauges** for parametric roll, synchronous roll, and wavelength/ship-length ratio
- **Compass rose** with wave, swell, and heading vectors
- **7-day forecast timeline** with interactive risk-shaded zones
- **Polar risk diagram** and speed/heading matrix
- **6 vessel presets** (Container, PCC, VLCC, Bulker, Ro-Ro) plus custom configuration

## Quick Start

```bash
npm install
npm run dev
```

Opens automatically at http://localhost:3000

## Build

```bash
npm run build
npm run preview
```

## Physics

- Natural Roll Period: Tᵣ = 2·C·B / √GM (IMO 2008 IS Code)
- Wave Encounter Period: Tₑ = Tw / |1 − V·cos(α) / Vw|
- Parametric Risk Ratio: R = Tᵣ / (2·Tₑ) — CRITICAL when R ≈ 1.0
- Synchronous Risk Ratio: R = Tᵣ / Tₑ — CRITICAL when R ≈ 1.0

## License

MIT
