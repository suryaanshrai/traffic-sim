import './styles/main.css';
import { Graph } from './simulator/graph.js';
import { SimulationEngine } from './simulator/engine.js';
import { NetworkBuilder } from './ui/builder.js';
import { MapController } from './ui/mapController.js';
import { CanvasRenderer } from './ui/canvasRenderer.js';
import { DashboardController } from './ui/dashboard.js';

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Graph & Parallel Simulation Engines
  const graph = new Graph();
  
  const engines = {
    fixed: new SimulationEngine(graph),
    influx: new SimulationEngine(graph),
    max_pressure: new SimulationEngine(graph),
    green_wave: new SimulationEngine(graph)
  };

  // Set hardcoded algorithms for each engine
  engines.fixed.setAlgorithm('fixed');
  engines.influx.setAlgorithm('influx');
  engines.max_pressure.setAlgorithm('max_pressure');
  engines.green_wave.setAlgorithm('green_wave');

  // Track active engine
  let activeAlgo = 'fixed';
  let activeEngine = engines[activeAlgo];

  // Set background flags: only the active engine handles random spawns
  for (const algo in engines) {
    engines[algo].isBackground = (algo !== activeAlgo);
  }

  // Synchronize random spawns and roadblock events across all engines
  for (const algo in engines) {
    engines[algo].onVehicleSpawned = (id, route, spawnTime) => {
      // Only propagate spawns from the currently active engine!
      if (algo === activeAlgo) {
        for (const otherAlgo in engines) {
          if (otherAlgo !== algo) {
            engines[otherAlgo].spawnVehicleDirectly(id, route, spawnTime);
          }
        }
      }
    };

    engines[algo].onRoadblockTriggered = (roadId, isFullBlock) => {
      if (algo === activeAlgo) {
        for (const otherAlgo in engines) {
          if (otherAlgo !== algo) {
            engines[otherAlgo].syncRoadblock(roadId, isFullBlock);
          }
        }
      }
    };

    engines[algo].onRoadblockCleared = (roadId) => {
      if (algo === activeAlgo) {
        for (const otherAlgo in engines) {
          if (otherAlgo !== algo) {
            engines[otherAlgo].syncClearRoadblock(roadId);
          }
        }
      }
    };
  }

  // Cache viewport DOM elements
  const viewportArea = document.getElementById('viewport-area');
  const canvas = document.getElementById('simulation-canvas');

  // Properties element selection callback
  const onElementSelected = (type, element) => {
    dashboard.handleElementSelection(type, element);
  };

  // Bounding box ready callback
  const onMapSelectionChange = (bbox) => {
    dashboard.handleMapSelection(bbox);
  };

  // 2. Instantiate controllers and renderers
  const builder = new NetworkBuilder(canvas, graph, activeEngine, onElementSelected);
  const mapController = new MapController('map-container', graph, activeEngine, onMapSelectionChange);
  const canvasRenderer = new CanvasRenderer(canvas, graph, activeEngine, builder);
  const dashboard = new DashboardController(activeEngine, graph, mapController, builder);
  
  // Wire references
  mapController.builder = builder;
  builder.canvasRenderer = canvasRenderer;
  dashboard.setCanvasRenderer(canvasRenderer);
  dashboard.setEngines(engines); // Pass parallel engines to dashboard for live comparisons

  // Reset and restart all engines when mapController finishes loading/parsing OSM network
  mapController.onNetworkLoaded = () => {
    for (const algo in engines) {
      engines[algo].reset();
      engines[algo].start();
    }
  };

  // Synchronize builder modifications across all engines
  builder.onGraphChanged = () => {
    for (const algo in engines) {
      engines[algo].initializeTrafficLights();
    }
  };

  // Synchronize road removals to clean up vehicles active on deleted paths
  const handleRoadRemoval = (roadId) => {
    for (const algo in engines) {
      engines[algo].removeRoadFromSimulation(roadId);
    }
  };
  builder.onRoadRemoved = handleRoadRemoval;
  dashboard.onRoadRemoved = handleRoadRemoval;

  // Sync canvas size
  function resizeCanvas() {
    const rect = viewportArea.getBoundingClientRect();
    canvasRenderer.resize(rect.width, rect.height);
    if (mapController) {
      mapController.syncCanvasCoordinates();
    }
  }

  // Set up resize observer to trigger canvas sizing correctly
  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(viewportArea);
  resizeCanvas();

  // 3. Build a beautiful default intersection on startup so the simulator is alive
  function loadDefaultIntersection() {
    // Pause and reset all engines
    for (const algo in engines) {
      engines[algo].pause();
    }
    graph.clear();

    const rect = viewportArea.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    // Dynamically calculate horizontal and vertical node offsets to fit any screen size
    const dx = Math.min(250, rect.width * 0.38);
    const dy = Math.min(180, rect.height * 0.28);

    // Add nodes with default sources & sinks roles to absorb traffic
    graph.addNode('c', cx, cy);
    graph.addNode('n', cx, cy - dy).role = 'source';   // North Spawn
    graph.addNode('s', cx, cy + dy).role = 'sink';     // South Sink
    graph.addNode('w', cx - dx, cy).role = 'source';   // West Spawn
    graph.addNode('e', cx + dx, cy).role = 'sink';     // East Sink

    // Add roads: opposite directions to showcase lanes separation
    graph.addRoad('n_c', 'n', 'c', 3, 90);
    graph.addRoad('c_s', 'c', 's', 3, 90);
    
    graph.addRoad('s_c', 's', 'c', 3, 90);
    graph.addRoad('c_n', 'c', 'n', 3, 90);

    graph.addRoad('w_c', 'w', 'c', 2, 60);
    graph.addRoad('c_e', 'c', 'e', 2, 60);

    graph.addRoad('e_c', 'e', 'c', 2, 60);
    graph.addRoad('c_w', 'c', 'w', 2, 60);

    // Initialize all engines clock
    for (const algo in engines) {
      engines[algo].reset();
      engines[algo].start();
    }
  }

  // Load default network layout
  loadDefaultIntersection();

  // Hide Leaflet initially
  mapController.hide();

  // Mode Toggles: clear graph and reset all simulation engines to prevent overlays
  document.getElementById('btn-mode-builder').addEventListener('click', () => {
    graph.clear();
    for (const algo in engines) {
      engines[algo].reset();
    }
    loadDefaultIntersection();
  });

  document.getElementById('btn-mode-map').addEventListener('click', () => {
    graph.clear();
    for (const algo in engines) {
      engines[algo].reset();
    }
  });

  // Wire dashboard setting changes to ALL engines
  document.getElementById('slider-spawn-rate').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    for (const algo in engines) {
      engines[algo].spawnRate = val;
    }
  });

  document.getElementById('select-algo').addEventListener('change', (e) => {
    const nextAlgo = e.target.value;
    
    // Switch active algorithm
    activeAlgo = nextAlgo;
    activeEngine = engines[activeAlgo];

    // Reset background roles
    for (const algo in engines) {
      engines[algo].isBackground = (algo !== activeAlgo);
    }

    // Bind new active engine to controllers and renderer
    builder.engine = activeEngine;
    mapController.engine = activeEngine;
    canvasRenderer.engine = activeEngine;
    dashboard.engine = activeEngine;

    // Reset properties selection state
    builder.deselect();
  });

  document.getElementById('slider-lookback').addEventListener('input', (e) => {
    const depth = parseInt(e.target.value);
    for (const algo in engines) {
      engines[algo].setInfluxLookback(depth);
    }
  });

  document.getElementById('checkbox-events').addEventListener('change', (e) => {
    const checked = e.target.checked;
    for (const algo in engines) {
      engines[algo].randomEventsEnabled = checked;
    }
  });

  // Speed controls sync
  const setActiveSpeed = (mult) => {
    for (const algo in engines) {
      if (mult === 0) {
        engines[algo].pause();
      } else {
        engines[algo].speedMultiplier = mult;
        engines[algo].start();
      }
    }
  };
  document.getElementById('btn-speed-pause').addEventListener('click', () => setActiveSpeed(0));
  document.getElementById('btn-speed-1x').addEventListener('click', () => setActiveSpeed(1.0));
  document.getElementById('btn-speed-2x').addEventListener('click', () => setActiveSpeed(2.0));
  document.getElementById('btn-speed-4x').addEventListener('click', () => setActiveSpeed(4.0));

  // 3b. Mobile Panel Navigation Controller
  const mobileNavBar = document.getElementById('mobile-nav-bar');
  const sidebarPanel = document.getElementById('sidebar-panel');
  const dashboardPanel = document.getElementById('dashboard-panel');
  const backdrop = document.getElementById('mobile-backdrop');
  
  const btnNavSim = document.getElementById('btn-nav-sim');
  const btnNavTools = document.getElementById('btn-nav-tools');
  const btnNavAnalytics = document.getElementById('btn-nav-analytics');

  function closeAllPanels() {
    sidebarPanel.classList.remove('active');
    dashboardPanel.classList.remove('active');
    backdrop.classList.add('hidden');
    
    btnNavSim.classList.add('active');
    btnNavTools.classList.remove('active');
    btnNavAnalytics.classList.remove('active');
  }

  function openPanel(panel) {
    closeAllPanels();
    panel.classList.add('active');
    backdrop.classList.remove('hidden');
    btnNavSim.classList.remove('active');
    
    if (panel === sidebarPanel) {
      btnNavTools.classList.add('active');
    } else if (panel === dashboardPanel) {
      btnNavAnalytics.classList.add('active');
    }
    
    // Trigger canvas resize to ensure renderer knows the exact layout client rect immediately
    setTimeout(resizeCanvas, 100);
  }

  if (btnNavSim) {
    btnNavSim.addEventListener('click', closeAllPanels);
  }
  if (btnNavTools) {
    btnNavTools.addEventListener('click', () => {
      if (sidebarPanel.classList.contains('active')) {
        closeAllPanels();
      } else {
        openPanel(sidebarPanel);
      }
    });
  }
  if (btnNavAnalytics) {
    btnNavAnalytics.addEventListener('click', () => {
      if (dashboardPanel.classList.contains('active')) {
        closeAllPanels();
      } else {
        openPanel(dashboardPanel);
      }
    });
  }
  if (backdrop) {
    backdrop.addEventListener('click', closeAllPanels);
  }
  document.addEventListener('close-all-panels', closeAllPanels);

  // 4. Main Animation & Execution loop
  let lastTime = performance.now();
  let lastDashboardUpdateTime = 0;

  function loop(time) {
    const dt = (time - lastTime) / 1000; // Delta time in seconds
    lastTime = time;

    const cappedDt = Math.min(0.1, dt);

    // Update ALL 4 engines (active + 3 background engines)
    for (const algo in engines) {
      engines[algo].update(cappedDt);
    }

    // Redraw active engine layout
    canvasRenderer.draw();

    // Throttled dashboard refresh (twice per second / 500ms) for high performance
    if (time - lastDashboardUpdateTime >= 500) {
      dashboard.update();
      lastDashboardUpdateTime = time;
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
});
