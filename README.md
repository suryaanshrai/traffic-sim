# The SUPREME TRAFFIC SIMULATOR

> **_A cutting‑edge, interactive traffic flow simulation platform built with modern web technologies._**

## 📖 Overview

The **Supreme Traffic Simulator** (STS) is an immersive web‑based application that visualises and simulates real‑time traffic patterns. It is designed for educators, urban planners, and developers who want to experiment with traffic algorithms, road network designs, and vehicle behaviours.

- **Interactive UI** – Drag‑and‑drop roads, set traffic lights, and watch cars flow in real time.
- **Modular Architecture** – Core simulation engine is decoupled from rendering, making it easy to plug‑in custom models.
- **Responsive Design** – Works seamlessly on desktop, tablet, and mobile browsers.
- **Extensible** – Add new vehicle types, AI drivers, or data sources with a simple plug‑in system.

## 🚀 Features

- **Dynamic vehicle spawning** with configurable entry/exit points.
- **Real‑time traffic‑light control** (fixed timers, sensor‑based, or user‑controlled).
- **Collision detection** and realistic physics.
- **Statistical dashboards** showing average speed, congestion heat‑maps, and throughput.
- **Export & Import** of road network layouts in JSON format.
- **Themed visual styles** – dark mode, glass‑morphism UI, and smooth micro‑animations.

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your‑org/supreme‑traffic‑sim.git
   cd supreme‑traffic‑sim
   ```
2. **Install dependencies** (Node 18+ required)
   ```bash
   npm install
   ```
3. **Run the development server**
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## 🛠️ Usage

- Open the app in a browser.
- Use the **Toolbar** on the left to add roads, intersections, and traffic lights.
- Press **Play** to start the simulation. Vehicles will spawn according to the configured entry points.
- Adjust traffic‑light timings on‑the‑fly or enable the **AI controller** for adaptive behaviour.
- View live statistics in the **Dashboard** panel on the right.

### Command‑Line Options

| Flag | Description |
|------|-------------|
| `--port <number>` | Override the default dev‑server port (default: 3000). |
| `--no‑open` | Prevent automatic opening of the browser window. |
| `--mode <dev|prod>` | Force the build mode (default respects `NODE_ENV`). |

## 📚 Documentation

For deeper dives, see the docs folder:
- `docs/architecture.md` – High‑level design and component diagram.
- `docs/api.md` – Public JavaScript API for plug‑ins.
- `docs/customization.md` – How to create custom vehicle models and UI themes.

## 🤝 Contributing

We welcome contributions! Please follow these steps:
1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/awesome‑feature`).
3. Write tests for any new functionality.
4. Ensure the existing test suite passes (`npm test`).
5. Open a pull request with a clear description of your changes.

> **Tip:** Run `npm run lint` before submitting to keep the codebase clean and consistent.

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

*Built with ❤️ by the Antigravity team.*
