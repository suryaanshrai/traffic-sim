<div align="center">

```
████████╗██████╗  █████╗ ███████╗███████╗██╗ ██████╗
╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██╔════╝██║██╔════╝
   ██║   ██████╔╝███████║█████╗  █████╗  ██║██║     
   ██║   ██╔══██╗██╔══██║██╔══╝  ██╔══╝  ██║██║     
   ██║   ██║  ██║██║  ██║██║     ██║     ██║╚██████╗
   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝     ╚═╝ ╚═════╝
              S I M U L A T O R  🚗💨
```

*like SimCity but make it browser-native and actually fast*

[![Deploy](https://github.com/suryaanshrai/traffic-sim/actions/workflows/deploy.yml/badge.svg)](https://github.com/suryaanshrai/traffic-sim/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Made with Vite](https://img.shields.io/badge/made%20with-vite-646CFF?logo=vite)](https://vitejs.dev)
[![Leaflet](https://img.shields.io/badge/maps-leaflet-199900?logo=leaflet)](https://leafletjs.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/suryaanshrai/traffic-sim/issues)

**[🚀 Live Demo](https://suryaanshrai.github.io/traffic-sim/) · [🐛 Report Bug](https://github.com/suryaanshrai/traffic-sim/issues) · [💡 Request Feature](https://github.com/suryaanshrai/traffic-sim/issues)**

</div>

---

## what even is this

you know how traffic just... sucks? we didn't fix it. but we did make a pretty sim that lets you *watch* it suck — in real time, on a map, with physics.

it's a browser-based traffic flow simulator. draw roads. spawn cars. set traffic lights. watch chaos emerge organically like a CS dissertation you never wanted to write.

no install. no backend. no nonsense. just open [the link](https://suryaanshrai.github.io/traffic-sim/) and vibe.

> *"All models are wrong, but some are useful."*  
> — George Box, who definitely had traffic in mind

---

## the goods

| feature | vibe |
|---------|-------|
| 🗺️ **Real map tiles** | OpenStreetMap under the hood. actual streets. |
| 🚗 **IDM vehicle physics** | Intelligent Driver Model. cars that actually brake. |
| 🚦 **Traffic light control** | fixed timers, sensor-based, or you play god |
| 📊 **Live dashboards** | speed, throughput, congestion heatmaps. the works. |
| 🧱 **Road builder** | drag to draw. intersections snap. it just works. |
| 💾 **Save / Load** | JSON export of your entire road network |
| 🌑 **Dark mode only** | light mode is a crime. we don't support it. |
| ⚡ **Zero backend** | pure client-side. deploys on a napkin. |

---

## run it locally

```bash
# 1. grab it
git clone https://github.com/suryaanshrai/traffic-sim.git
cd traffic-sim

# 2. dependencies (you know the drill)
npm install

# 3. go
npm run dev
```

open `http://localhost:5173` and you're cooking.

> node 18+ please. we're not animals.

---

## how to use it

```
1. open the app
2. draw some roads  →  left toolbar
3. drop traffic lights at intersections
4. hit ▶ Play
5. watch the cars do their thing
6. question everything you know about urban planning
```

the dashboard on the right updates live. tweak light timings mid-sim. cars react. it's oddly satisfying.

---

## tech stack

```
vite          →  build tool. fast. no cap.
leaflet       →  map rendering
chart.js      →  those pretty real-time graphs
vanilla js    →  no framework. pure chaos. pure power.
github pages  →  hosting. free. based.
```

---

## project layout

```
traffic-sim/
├── src/
│   ├── main.js           # entry point
│   ├── simulator/        # the brain — IDM, physics, routing
│   ├── ui/               # panels, toolbar, dashboard
│   └── assets/           # icons, svgs
├── public/               # static stuff
├── .github/workflows/    # auto-deploy on push ✓
└── index.html            # the one true html
```

---

## deploy your own fork

already wired up. push to `main` → github actions builds → github pages serves. done.

```bash
git push origin main
# ☕ go make chai
# come back, it's live
```

forking? cool.
1. fork the repo
2. **Settings → Pages → Source → GitHub Actions**
3. push. done. you're welcome.

---

## contributing

found a bug → open an issue. be cool about it.  
fixed a bug → open a PR. we'll merge fast.  
want a feature → describe it in one sentence. no manifestos.

```bash
git checkout -b fix/that-one-annoying-bug
# write code. actually test it.
git push origin fix/that-one-annoying-bug
# open PR with a one-liner description
```

> *"First, solve the problem. Then, write the code."*  
> — John Johnson, not a traffic engineer

---

## known quirks

- very dense networks slow down. blame physics, not us.
- mobile works but road drawing is fiddly. touch events are hard, man.
- cars pile up and freeze? that's not a bug. that's a Monday morning.

---

## license

MIT. take it, build it, ship it. just don't claim you made it when you didn't.

---

<div align="center">

*made with spite, caffeine, and an unhealthy interest in traffic flow theory*

🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒

*if you read this far, you are the target audience. welcome.*

<!-- 🥚 psst. konami code works on the live site. ↑↑↓↓←→←→BA. just saying. -->

</div>
