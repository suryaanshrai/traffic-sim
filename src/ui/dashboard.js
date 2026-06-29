import Chart from 'chart.js/auto';

export class DashboardController {
  constructor(engine, graph, mapController, builder) {
    this.engine = engine;
    this.graph = graph;
    this.mapController = mapController;
    this.builder = builder;
    
    this.chart = null;
    this.activePresetName = '';

    this.initDOM();
    this.initChart();
    this.initEvents();
  }

  initDOM() {
    // Cache DOM Elements
    this.btnModeBuilder = document.getElementById('btn-mode-builder');
    this.btnModeMap = document.getElementById('btn-mode-map');
    
    this.sectionBuilder = document.getElementById('builder-controls-section');
    this.sectionMap = document.getElementById('map-controls-section');
    
    this.propertiesSection = document.getElementById('properties-section');
    this.roadProperties = document.getElementById('road-properties');
    this.nodeProperties = document.getElementById('node-properties');
    this.nodeLightStatus = document.getElementById('node-light-status');
    
    this.propLanes = document.getElementById('prop-lanes');
    this.propLanesVal = document.getElementById('prop-lanes-val');
    this.propSpeed = document.getElementById('prop-speed');
    this.propSpeedVal = document.getElementById('prop-speed-val');
    this.btnToggleBlock = document.getElementById('btn-toggle-block');

    this.sliderSpawnRate = document.getElementById('slider-spawn-rate');
    this.valSpawnRate = document.getElementById('val-spawn-rate');
    this.selectAlgo = document.getElementById('select-algo');
    
    this.influxConfigGroup = document.getElementById('influx-config-group');
    this.sliderLookback = document.getElementById('slider-lookback');
    this.valLookback = document.getElementById('val-lookback');
    
    this.checkboxEvents = document.getElementById('checkbox-events');

    this.btnPause = document.getElementById('btn-speed-pause');
    this.btnSpeed1x = document.getElementById('btn-speed-1x');
    this.btnSpeed2x = document.getElementById('btn-speed-2x');
    this.btnSpeed4x = document.getElementById('btn-speed-4x');
    this.valSpeedMult = document.getElementById('val-speed-mult');

    // Metrics text nodes
    this.valMetricWait = document.getElementById('metric-wait-time');
    this.valMetricCongestion = document.getElementById('metric-congestion');
    this.valMetricCO2Savings = document.getElementById('metric-co2-savings');
    this.valMetricThroughput = document.getElementById('metric-throughput');
    this.valMetricSpeed = document.getElementById('metric-speed');
    this.valMetricMaxQueue = document.getElementById('metric-max-queue');

    // Map controls
    this.mapSearchInput = document.getElementById('map-search-input');
    this.btnMapSearch = document.getElementById('btn-map-search');
    this.btnBboxSelect = document.getElementById('btn-bbox-select');
    this.btnImportOSM = document.getElementById('btn-import-osm');
    
    this.btnClearGrid = document.getElementById('btn-clear-grid');

    // Bidirectional and Node Role controls
    this.propBidirectional = document.getElementById('prop-bidirectional');
    this.propNodeRole = document.getElementById('prop-node-role');

    // Comparison view selectors and baseline tools
    this.btnViewLive = document.getElementById('btn-view-live');
    this.btnViewCompare = document.getElementById('btn-view-compare');
    this.liveChartWrapper = document.getElementById('live-chart-wrapper');
    this.comparisonPanelWrapper = document.getElementById('comparison-panel-wrapper');
    this.comparisonDataTable = document.getElementById('comparison-data-table');
    this.chartPanelTitle = document.getElementById('chart-panel-title');

    // Baseline database & active view
    this.baselines = new Map(); // algoId -> metrics
    this.activeDashboardView = 'live';
  }

  initChart() {
    const ctx = document.getElementById('performance-chart').getContext('2d');
    
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [], // Timestamps
        datasets: [
          {
            label: 'Congestion Index (%)',
            data: [],
            borderColor: '#ff007f', // Neon pink
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            yAxisID: 'y'
          },
          {
            label: 'Avg Wait Time (s)',
            data: [],
            borderColor: '#00f2fe', // Neon cyan
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            yAxisID: 'y'
          },
          {
            label: 'Speed Index',
            data: [],
            borderColor: '#ffaa00', // Gold yellow
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.4,
            yAxisID: 'ySpeed'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: {
                family: 'Outfit',
                size: 11
              },
              boxWidth: 12
            }
          },
          tooltip: {
            enabled: true,
            mode: 'index',
            intersect: false
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.03)'
            },
            ticks: {
              color: '#64748b',
              maxTicksLimit: 10
            }
          },
          y: {
            position: 'left',
            grid: {
              color: 'rgba(255, 255, 255, 0.03)'
            },
            ticks: {
              color: '#64748b'
            },
            min: 0
          },
          ySpeed: {
            position: 'right',
            grid: {
              drawOnChartArea: false // Only show grid lines for left axis
            },
            ticks: {
              color: '#64748b'
            },
            min: 0
          }
        }
      }
    });
  }

  initEvents() {
    // 1. Mode selection
    this.btnModeBuilder.addEventListener('click', () => {
      this.btnModeBuilder.classList.add('active');
      this.btnModeMap.classList.remove('active');
      this.sectionBuilder.classList.remove('hidden');
      this.sectionMap.classList.add('hidden');
      
      this.mapController.hide();
      this.engine.setInfluxLookback(2);
      this.engine.reset();
      this.canvasRenderer.setMapMode(false);
      this.canvasRenderer.canvas.style.pointerEvents = 'auto'; // allow canvas clicks
      this.deselectProperties();
    });

    this.btnModeMap.addEventListener('click', () => {
      this.btnModeMap.classList.add('active');
      this.btnModeBuilder.classList.remove('active'); // Fixed class name bug
      this.sectionBuilder.classList.add('hidden');
      this.sectionMap.classList.remove('hidden');
      
      this.mapController.show();
      this.canvasRenderer.setMapMode(true);
      this.canvasRenderer.canvas.style.pointerEvents = 'none'; // click falls through to Leaflet
      this.engine.reset();
      this.deselectProperties();
    });

    // 2. Map actions
    this.btnMapSearch.addEventListener('click', () => {
      const q = this.mapSearchInput.value.trim();
      this.mapController.searchLocation(q);
    });

    this.mapSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = this.mapSearchInput.value.trim();
        this.mapController.searchLocation(q);
      }
    });

    this.btnBboxSelect.addEventListener('click', () => {
      this.mapController.enableBoxDrawing();
      this.btnBboxSelect.classList.add('btn-success');
      this.btnBboxSelect.textContent = 'Drag box on map...';
    });

    this.btnImportOSM.addEventListener('click', async () => {
      this.btnImportOSM.textContent = 'Downloading OSM Data...';
      this.btnImportOSM.disabled = true;
      
      const success = await this.mapController.importOSMNetwork();
      
      this.btnImportOSM.textContent = 'Import Selection Area';
      if (!success) {
        this.btnImportOSM.disabled = false;
      }
    });

    // Preset hubs
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lat = parseFloat(btn.dataset.lat);
        const lng = parseFloat(btn.dataset.lng);
        const name = btn.dataset.name;
        
        this.mapController.gotoPreset(name);
      });
    });

    // 3. Construction Tool Selection
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const toolId = btn.id.replace('tool-', '');
        this.builder.setTool(toolId);
      });
    });

    this.btnClearGrid.addEventListener('click', () => {
      if (confirm('Clear the entire road network?')) {
        this.engine.pause();
        this.graph.clear();
        this.engine.reset();
        this.deselectProperties();
      }
    });

    // 4. Property updates
    this.propLanes.addEventListener('input', () => {
      const lanes = parseInt(this.propLanes.value);
      this.propLanesVal.textContent = lanes;
      if (this.builder.selectedElement && this.builder.selectedElement.type === 'road') {
        const road = this.builder.selectedElement.obj;
        road.lanes = lanes;
        road.capacity = lanes * 25;
      }
    });

    this.propSpeed.addEventListener('input', () => {
      const speed = parseInt(this.propSpeed.value);
      this.propSpeedVal.textContent = speed;
      if (this.builder.selectedElement && this.builder.selectedElement.type === 'road') {
        const road = this.builder.selectedElement.obj;
        road.speedLimit = speed;
      }
    });

    this.btnToggleBlock.addEventListener('click', () => {
      if (this.builder.selectedElement && this.builder.selectedElement.type === 'road') {
        const road = this.builder.selectedElement.obj;
        road.isBlocked = !road.isBlocked;
        road.speedFactor = road.isBlocked ? 0.0 : 1.0;
        
        if (road.isBlocked) {
          this.engine.activeRoadblocks.add(road.id);
          this.engine.rerouteVehiclesAvoiding(road.id);
          if (this.engine.onRoadblockTriggered) {
            this.engine.onRoadblockTriggered(road.id, true);
          }
        } else {
          this.engine.activeRoadblocks.delete(road.id);
          if (this.engine.onRoadblockCleared) {
            this.engine.onRoadblockCleared(road.id);
          }
        }
        
        this.updatePropertiesDisplay('road', road);
      }
    });

    // 5. Spawning & Configuration sliders
    this.sliderSpawnRate.addEventListener('input', () => {
      const val = parseFloat(this.sliderSpawnRate.value);
      this.valSpawnRate.textContent = `${val.toFixed(1)} /s`;
      this.engine.spawnRate = val;
    });

    this.selectAlgo.addEventListener('change', () => {
      const algo = this.selectAlgo.value;
      this.engine.setAlgorithm(algo);
      
      if (algo === 'influx') {
        this.influxConfigGroup.classList.remove('hidden');
      } else {
        this.influxConfigGroup.classList.add('hidden');
      }
    });

    this.sliderLookback.addEventListener('input', () => {
      const depth = parseInt(this.sliderLookback.value);
      this.valLookback.textContent = depth;
      this.engine.setInfluxLookback(depth);
    });

    this.checkboxEvents.addEventListener('change', () => {
      this.engine.randomEventsEnabled = this.checkboxEvents.checked;
    });

    // 6. Simulation Speed Buttons
    const setActiveSpeed = (activeBtn, mult, showVal) => {
      [this.btnPause, this.btnSpeed1x, this.btnSpeed2x, this.btnSpeed4x].forEach(b => b.classList.remove('btn-primary'));
      activeBtn.classList.add('btn-primary');
      this.valSpeedMult.textContent = showVal;
      
      if (mult === 0) {
        this.engine.pause();
      } else {
        this.engine.speedMultiplier = mult;
        this.engine.start();
      }
    };

    this.btnPause.addEventListener('click', () => setActiveSpeed(this.btnPause, 0, 'Paused'));
    this.btnSpeed1x.addEventListener('click', () => setActiveSpeed(this.btnSpeed1x, 1.0, '1.0x'));
    this.btnSpeed2x.addEventListener('click', () => setActiveSpeed(this.btnSpeed2x, 2.0, '2.0x'));
    this.btnSpeed4x.addEventListener('click', () => setActiveSpeed(this.btnSpeed4x, 4.0, '4.0x'));

    // 7. Bidirectional checkbox events
    this.propBidirectional.addEventListener('change', () => {
      if (this.builder.selectedElement && this.builder.selectedElement.type === 'road') {
        const road = this.builder.selectedElement.obj;
        const isBidi = this.propBidirectional.checked;
        const revId = `road_${road.toNode.id}_${road.fromNode.id}`;
        
        if (isBidi) {
          // Add reverse road if missing
          if (!this.graph.roads.has(revId)) {
            this.graph.addRoad(revId, road.toNode.id, road.fromNode.id, road.lanes, road.speedLimit);
            this.builder.notifyGraphChanged();
          }
        } else {
          // Delete reverse road if present
          if (this.graph.roads.has(revId)) {
            if (this.onRoadRemoved) {
              this.onRoadRemoved(revId);
            }
            this.graph.removeRoad(revId);
            this.builder.notifyGraphChanged();
          }
        }
      }
    });

    // 8. Node role selection events
    this.propNodeRole.addEventListener('change', () => {
      if (this.builder.selectedElement && this.builder.selectedElement.type === 'node') {
        const node = this.builder.selectedElement.obj;
        node.role = this.propNodeRole.value;
        this.builder.notifyGraphChanged();
        this.updatePropertiesDisplay('node', node);
      }
    });

    // 9. Comparison View switches
    this.btnViewLive.addEventListener('click', () => this.setView('live'));
    this.btnViewCompare.addEventListener('click', () => this.setView('compare'));
  }

  // Hook bounding box state
  handleMapSelection(bbox) {
    if (bbox) {
      this.btnBboxSelect.classList.remove('btn-success');
      this.btnBboxSelect.textContent = 'Draw Bounding Box';
      this.btnImportOSM.disabled = false;
    }
  }

  // Update properties sidebar UI
  handleElementSelection(type, element) {
    if (!type || !element) {
      this.deselectProperties();
      return;
    }

    this.propertiesSection.classList.remove('hidden');
    
    if (type === 'road') {
      this.roadProperties.classList.remove('hidden');
      this.nodeProperties.classList.add('hidden');
      this.updatePropertiesDisplay('road', element);
    } else {
      this.roadProperties.classList.add('hidden');
      this.nodeProperties.classList.remove('hidden');
      this.updatePropertiesDisplay('node', element);
    }
  }

  updatePropertiesDisplay(type, element) {
    if (type === 'road') {
      this.propLanes.value = element.lanes;
      this.propLanesVal.textContent = element.lanes;
      
      // Speed limit maps back roughly
      this.propSpeed.value = Math.round(element.speedLimit);
      this.propSpeedVal.textContent = Math.round(element.speedLimit);
      
      this.btnToggleBlock.textContent = element.isBlocked ? 'Clear Roadblock' : 'Toggle Roadblock';
      if (element.isBlocked) {
        this.btnToggleBlock.classList.replace('btn-danger', 'btn-success');
      } else {
        this.btnToggleBlock.classList.replace('btn-success', 'btn-danger');
      }

      // Bidirectional check
      const revId = `road_${element.toNode.id}_${element.fromNode.id}`;
      this.propBidirectional.checked = this.graph.roads.has(revId);
    } else if (type === 'node') {
      this.propNodeRole.value = element.role;
      if (element.trafficLight && element.trafficLight.phases.length > 0) {
        const light = element.trafficLight;
        const phaseInfo = `Active Phase: ${light.currentPhaseIndex + 1}/${light.phases.length} [State: ${light.state}]`;
        this.nodeLightStatus.textContent = `Traffic Light Installed. ${phaseInfo}`;
      } else {
        this.nodeLightStatus.textContent = 'No traffic light. Nodes require at least 2 incoming roads to install signal controllers.';
      }
    }
  }

  deselectProperties() {
    this.propertiesSection.classList.add('hidden');
    this.roadProperties.classList.add('hidden');
    this.nodeProperties.classList.add('hidden');
  }

  // Hook canvas renderer reference
  setCanvasRenderer(renderer) {
    this.canvasRenderer = renderer;
  }

  // Hook parallel engines reference
  setEngines(engines) {
    this.engines = engines;
  }

  setView(view) {
    this.activeDashboardView = view;
    if (view === 'live') {
      this.btnViewLive.classList.add('active');
      this.btnViewCompare.classList.remove('active');
      this.liveChartWrapper.classList.remove('hidden');
      this.comparisonPanelWrapper.classList.add('hidden');
      this.chartPanelTitle.textContent = 'Realtime Performance Index';
    } else {
      this.btnViewLive.classList.remove('active');
      this.btnViewCompare.classList.add('active');
      this.liveChartWrapper.classList.add('hidden');
      this.comparisonPanelWrapper.classList.remove('hidden');
      this.chartPanelTitle.textContent = 'Algorithm Comparison (Live)';
      this.renderComparisonTable();
    }
  }

  renderComparisonTable() {
    if (!this.engines) return;

    // Read live metrics from all 4 engines
    const data = {
      fixed: this.engines.fixed.getMetrics(),
      influx: this.engines.influx.getMetrics(),
      max_pressure: this.engines.max_pressure.getMetrics(),
      green_wave: this.engines.green_wave.getMetrics()
    };

    const algoNames = {
      fixed: 'Fixed-Time Control',
      influx: 'Influx-Aware Dynamic',
      max_pressure: 'Max-Pressure Adaptive',
      green_wave: 'Green Wave Coordinated'
    };

    // Find maximum values for visual bars normalization
    let maxWait = 0.1, maxCong = 0.1, maxSpeed = 0.1, maxSavings = 0.1;
    for (const algo in data) {
      const m = data[algo];
      if (m.avgWaitTime > maxWait) maxWait = m.avgWaitTime;
      if (m.congestionIndex > maxCong) maxCong = m.congestionIndex;
      if (m.avgSpeed > maxSpeed) maxSpeed = m.avgSpeed;
      if (m.co2Savings > maxSavings) maxSavings = m.co2Savings;
    }

    let html = `
      <table class="comp-table">
        <thead>
          <tr>
            <th>Algorithm</th>
            <th>Avg Wait Time</th>
            <th>Congestion Index</th>
            <th>Avg Flow Speed</th>
            <th>Est. CO₂ Savings</th>
            <th>Throughput</th>
          </tr>
        </thead>
        <tbody>
    `;

    for (const algo in data) {
      const m = data[algo];
      const waitPercent = (m.avgWaitTime / maxWait) * 100;
      const congPercent = (m.congestionIndex / maxCong) * 100;
      const speedPercent = (m.avgSpeed / maxSpeed) * 100;
      const savingsPercent = (m.co2Savings / Math.max(1, maxSavings)) * 100;

      const isCurrent = (algo === this.engine.activeAlgorithm);
      const rowStyle = isCurrent ? 'style="background: rgba(0, 242, 254, 0.05); border-left: 2px solid var(--neon-cyan);"' : '';

      html += `
        <tr ${rowStyle}>
          <td class="comp-metric-name" style="${isCurrent ? 'color: var(--neon-cyan); font-weight: 700;' : ''}">
            ${algoNames[algo]} ${isCurrent ? '<span style="font-size:0.7rem; color:#00ff87;">(Active)</span>' : ''}
          </td>
          <td>
            <div class="comp-bar-container"><div class="comp-bar-fill" style="width: ${waitPercent}%; background: linear-gradient(90deg, #00f2fe, #ff0055);"></div></div>
            <span>${m.avgWaitTime.toFixed(1)}s</span>
          </td>
          <td>
            <div class="comp-bar-container"><div class="comp-bar-fill" style="width: ${congPercent}%; background: linear-gradient(90deg, #00f2fe, #ffaa00);"></div></div>
            <span>${m.congestionIndex.toFixed(1)}%</span>
          </td>
          <td>
            <div class="comp-bar-container"><div class="comp-bar-fill" style="width: ${speedPercent}%; background: linear-gradient(90deg, #7928CA, #00ff87);"></div></div>
            <span>${m.avgSpeed.toFixed(1)} km/h</span>
          </td>
          <td>
            <div class="comp-bar-container"><div class="comp-bar-fill" style="width: ${savingsPercent}%; background: linear-gradient(90deg, #7928CA, #00ff87);"></div></div>
            <span>${Math.round(m.co2Savings)}g</span>
          </td>
          <td>
            <strong>${m.arrivedVehicles}</strong> <span style="color:#64748b;">cars</span>
          </td>
        </tr>
      `;
    }

    html += `
        </tbody>
      </table>
    `;

    this.comparisonDataTable.innerHTML = html;
  }

  // Updates live values & historical chart
  update() {
    const metrics = this.engine.getMetrics();

    // 1. Update card texts
    this.valMetricWait.textContent = metrics.avgWaitTime.toFixed(1);
    this.valMetricCongestion.textContent = metrics.congestionIndex.toFixed(1);
    this.valMetricCO2Savings.textContent = Math.round(metrics.co2Savings);
    this.valMetricThroughput.textContent = metrics.arrivedVehicles;
    this.valMetricSpeed.textContent = metrics.avgSpeed.toFixed(1);
    this.valMetricMaxQueue.textContent = metrics.maxQueue;

    // Adjust color coding of congestion index card
    const congestionCard = document.querySelector('.metric-card.congestion');
    if (metrics.congestionIndex > 50) {
      congestionCard.style.borderColor = 'rgba(255, 0, 85, 0.4)';
    } else if (metrics.congestionIndex > 25) {
      congestionCard.style.borderColor = 'rgba(255, 170, 0, 0.4)';
    } else {
      congestionCard.style.borderColor = 'rgba(0, 255, 135, 0.2)';
    }

    // 2. Update properties text if node is currently selected (keeps phase info updated)
    if (this.builder.selectedElement && this.builder.selectedElement.type === 'node') {
      this.updatePropertiesDisplay('node', this.builder.selectedElement.obj);
    }

    // 2b. Refresh comparison table live if active
    if (this.activeDashboardView === 'compare') {
      this.renderComparisonTable();
    }

    // 3. Update Chart datasets
    const history = this.engine.metricsHistory;
    if (history.length > 0) {
      const labels = history.map(h => `${Math.round(h.simulationTime)}s`);
      const congestionData = history.map(h => h.congestionIndex);
      const waitTimeData = history.map(h => h.avgWaitTime);
      const velocityData = history.map(h => h.avgSpeed);

      this.chart.data.labels = labels;
      this.chart.data.datasets[0].data = congestionData;
      this.chart.data.datasets[1].data = waitTimeData;
      this.chart.data.datasets[2].data = velocityData;

      // Update without transitions for smooth drawing
      this.chart.update('none');
    }
  }
}
