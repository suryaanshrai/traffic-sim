import { Vehicle } from './vehicle.js';
import { TrafficLight } from './trafficLight.js';

export class SimulationEngine {
  constructor(graph) {
    this.graph = graph;
    this.vehicles = new Map(); // id -> Vehicle
    this.roadVehicles = new Map(); // roadId -> Array of Vehicles (engine private state)
    this.arrivedVehiclesCount = 0;
    
    // Metrics accumulator
    this.completedTravelTimes = []; // list of travel times
    this.completedWaitTimes = [];   // list of wait times
    
    // Global simulation state
    this.simulationTime = 0; // In seconds
    this.spawnTimer = 0;
    this.isRunning = false;
    this.speedMultiplier = 1.0;
    
    // User configurable inputs
    this.spawnRate = 1.0; // Vehicles per second
    this.maxVehicles = 300; // Cap to avoid performance lag
    this.activeAlgorithm = 'fixed';
    
    // Random events / Bias
    this.randomEventsEnabled = false;
    this.randomEventProbability = 0.08; // Chance per second of an event triggering (approx every 12.5 seconds)
    this.activeRoadblocks = new Set(); // road IDs currently blocked by random events
    
    // Performance and tracking
    this.vehicleIdCounter = 0;
    this.metricsHistory = [];
    this.lastMetricsUpdateTime = 0;
  }

  start() {
    this.isRunning = true;
  }

  pause() {
    this.isRunning = false;
  }

  reset() {
    this.vehicles.clear();
    this.roadVehicles.clear();
    this.arrivedVehiclesCount = 0;
    this.completedTravelTimes = [];
    this.completedWaitTimes = [];
    this.simulationTime = 0;
    this.spawnTimer = 0;
    this.vehicleIdCounter = 0;
    this.metricsHistory = [];
    this.lastMetricsUpdateTime = 0;
    
    // Reset roads
    for (const [_, road] of this.graph.roads) {
      road.vehicles = [];
      road.isBlocked = false;
      road.speedFactor = 1.0;
    }
    this.activeRoadblocks.clear();

    // Re-initialize traffic lights
    this.initializeTrafficLights();
  }

  initializeTrafficLights() {
    for (const [_, node] of this.graph.nodes) {
      // A node is a junction if it has 2 or more incoming roads and is not a source/sink node
      if (node.incomingRoads.length >= 2 && node.role !== 'sink' && node.role !== 'source') {
        node.trafficLight = new TrafficLight(node, this.graph);
        node.trafficLight.algorithm = this.activeAlgorithm;
      } else {
        node.trafficLight = null;
      }
    }
  }

  setAlgorithm(algo) {
    this.activeAlgorithm = algo;
    for (const [_, node] of this.graph.nodes) {
      if (node.trafficLight) {
        node.trafficLight.algorithm = algo;
        // Keep active states but reset timers
        node.trafficLight.timer = 0;
      }
    }
  }

  // Set the lookback depth (sensing range) for Influx-Aware lights
  setInfluxLookback(depth) {
    for (const [_, node] of this.graph.nodes) {
      if (node.trafficLight) {
        node.trafficLight.influxLookbackJunctions = depth;
      }
    }
  }

  getRoadVehicles(roadId) {
    return this.roadVehicles.get(roadId) || [];
  }

  update(realDt) {
    if (!this.isRunning) return;

    // Rebuild the roadVehicles index for this engine's private vehicle state
    this.roadVehicles.clear();
    for (const [_, vehicle] of this.vehicles) {
      if (vehicle.currentRoad) {
        const roadId = vehicle.currentRoad.id;
        if (!this.roadVehicles.has(roadId)) {
          this.roadVehicles.set(roadId, []);
        }
        this.roadVehicles.get(roadId).push(vehicle);
      }
    }

    // Apply speed multiplier to delta time
    const dt = realDt * this.speedMultiplier;
    this.simulationTime += dt;

    // 1. Spawning Logic
    if (!this.isBackground) {
      this.spawnTimer += dt;
      const spawnInterval = 1.0 / this.spawnRate;
      if (this.spawnTimer >= spawnInterval) {
        this.spawnTimer = 0;
        this.spawnVehicle();
      }
    }

    // 2. Update Traffic Lights
    for (const [_, node] of this.graph.nodes) {
      if (node.trafficLight) {
        node.trafficLight.update(dt, this);
      }
    }

    // 3. Update Vehicles
    const vehiclesToRemove = [];
    for (const [id, vehicle] of this.vehicles) {
      vehicle.update(dt, this.simulationTime, this);
      if (vehicle.isArrived) {
        // Collect metrics
        this.completedTravelTimes.push(vehicle.totalTravelTime);
        this.completedWaitTimes.push(vehicle.waitTime);
        this.arrivedVehiclesCount++;
        vehiclesToRemove.push(id);
      }
    }

    // Remove arrived vehicles from global map
    vehiclesToRemove.forEach(id => this.vehicles.delete(id));

    // 4. Random Events Handler (Only run on the active engine to prevent state override conflict)
    if (this.randomEventsEnabled && !this.isBackground) {
      this.handleRandomEvents(dt);
    }

    // 5. Metrics Recording (Every 1s of simulation time)
    if (this.simulationTime - this.lastMetricsUpdateTime >= 1.0) {
      this.recordMetrics();
      this.lastMetricsUpdateTime = this.simulationTime;
    }
  }

  spawnVehicle() {
    if (this.vehicles.size >= this.maxVehicles) return;
    if (this.graph.nodes.size < 2 || this.graph.roads.size === 0) return;

    // Get nodes that have outgoing roads as potential spawns, filtering by role
    let spawnNodes = Array.from(this.graph.nodes.values()).filter(n => n.role === 'source' && n.outgoingRoads.length > 0);
    // Get nodes that have incoming roads as potential destinations, filtering by role
    let destNodes = Array.from(this.graph.nodes.values()).filter(n => n.role === 'sink' && n.incomingRoads.length > 0);

    // Fallback if no explicit sources or sinks are defined
    if (spawnNodes.length === 0) {
      spawnNodes = Array.from(this.graph.nodes.values()).filter(n => n.outgoingRoads.length > 0);
    }
    if (destNodes.length === 0) {
      destNodes = Array.from(this.graph.nodes.values()).filter(n => n.incomingRoads.length > 0);
    }

    if (spawnNodes.length === 0 || destNodes.length === 0) return;

    // Choose random start & destination
    const startNode = spawnNodes[Math.floor(Math.random() * spawnNodes.length)];
    let destNode = destNodes[Math.floor(Math.random() * destNodes.length)];

    // Ensure start and destination are different
    let attempts = 0;
    while (startNode.id === destNode.id && attempts < 10) {
      destNode = destNodes[Math.floor(Math.random() * destNodes.length)];
      attempts++;
    }
    if (startNode.id === destNode.id) return;

    // Find path using Dijkstra (passing this engine context!)
    const route = this.graph.getShortestPath(startNode.id, destNode.id, this);
    if (!route || route.length === 0) return; // No connection path

    const id = `v_${this.vehicleIdCounter++}`;
    const vehicle = new Vehicle(id, route, this.graph, this.simulationTime, this);
    this.vehicles.set(id, vehicle);

    if (this.onVehicleSpawned) {
      this.onVehicleSpawned(id, route, this.simulationTime);
    }
  }

  spawnVehicleDirectly(id, route, spawnTime) {
    if (this.vehicles.size >= this.maxVehicles) return;
    
    // Validate route roads exist
    const validRoute = route.filter(rid => this.graph.roads.has(rid));
    if (validRoute.length === 0) return;

    const vehicle = new Vehicle(id, validRoute, this.graph, spawnTime, this);
    this.vehicles.set(id, vehicle);
  }

  removeRoadFromSimulation(roadId) {
    for (const [vid, vehicle] of this.vehicles) {
      if (vehicle.currentRoad && vehicle.currentRoad.id === roadId) {
        this.vehicles.delete(vid);
      }
    }
  }

  handleRandomEvents(dt) {
    // Probability of spawning a roadblock per second
    const triggerChance = this.randomEventProbability * dt;
    if (Math.random() < triggerChance) {
      this.triggerRandomRoadblock();
    }

    // Probability of clearing active roadblocks (average duration 15-30s)
    const clearChance = 0.05 * dt;
    for (const roadId of this.activeRoadblocks) {
      if (Math.random() < clearChance) {
        this.clearRoadblock(roadId);
      }
    }
  }

  triggerRandomRoadblock() {
    const roads = Array.from(this.graph.roads.values()).filter(r => !r.isBlocked);
    if (roads.length === 0) return;

    // Pick a random road
    const road = roads[Math.floor(Math.random() * roads.length)];
    
    // Choose roadblock type: 0 = complete blockage, 1 = lane repair (slow traffic)
    const isFullBlock = Math.random() < 0.5;
    road.isBlocked = isFullBlock;
    road.speedFactor = isFullBlock ? 0.0 : 0.2; // 80% speed reduction for repairs
    this.activeRoadblocks.add(road.id);

    console.log(`Random Event Triggered on Road ${road.id}: ${isFullBlock ? 'Roadblock' : 'Road Repairs'}`);

    if (isFullBlock) {
      this.rerouteVehiclesAvoiding(road.id);
    }

    if (this.onRoadblockTriggered) {
      this.onRoadblockTriggered(road.id, isFullBlock);
    }
  }

  clearRoadblock(roadId) {
    const road = this.graph.roads.get(roadId);
    if (road) {
      road.isBlocked = false;
      road.speedFactor = 1.0;
    }
    this.activeRoadblocks.delete(roadId);
    console.log(`Random Event Cleared on Road ${roadId}`);

    if (this.onRoadblockCleared) {
      this.onRoadblockCleared(roadId);
    }
  }

  syncRoadblock(roadId, isFullBlock) {
    const road = this.graph.roads.get(roadId);
    if (road) {
      road.isBlocked = isFullBlock;
      road.speedFactor = isFullBlock ? 0.0 : 0.2;
      this.activeRoadblocks.add(roadId);
      if (isFullBlock) {
        this.rerouteVehiclesAvoiding(roadId);
      }
    }
  }

  syncClearRoadblock(roadId) {
    const road = this.graph.roads.get(roadId);
    if (road) {
      road.isBlocked = false;
      road.speedFactor = 1.0;
    }
    this.activeRoadblocks.delete(roadId);
  }

  rerouteVehiclesAvoiding(blockedRoadId) {
    for (const [_, vehicle] of this.vehicles) {
      if (vehicle.isArrived) continue;
      
      const futureRoute = vehicle.route.slice(vehicle.currentRoadIndex);
      if (futureRoute.includes(blockedRoadId)) {
        const currentRoad = vehicle.currentRoad;
        if (!currentRoad) continue;
        const startNodeId = currentRoad.toNode.id;
        
        const destRoadId = vehicle.route[vehicle.route.length - 1];
        const destRoad = this.graph.roads.get(destRoadId);
        if (!destRoad) continue;
        const destNodeId = destRoad.toNode.id;

        // Find alternative path avoiding the blocked road
        const newPath = this.graph.getShortestPath(startNodeId, destNodeId, this);
        if (newPath && newPath.length > 0) {
          const completedRoute = vehicle.route.slice(0, vehicle.currentRoadIndex + 1);
          vehicle.route = [...completedRoute, ...newPath];
        }
      }
    }
  }

  getMetrics() {
    // 1. Avg Wait Time (active + completed)
    let totalActiveWait = 0;
    let activeCount = 0;
    for (const [_, vehicle] of this.vehicles) {
      totalActiveWait += vehicle.waitTime;
      activeCount++;
    }

    const completedWaitSum = this.completedWaitTimes.reduce((a, b) => a + b, 0);
    const totalVehiclesCount = activeCount + this.completedWaitTimes.length;
    const avgWaitTime = totalVehiclesCount > 0 
      ? (totalActiveWait + completedWaitSum) / totalVehiclesCount 
      : 0;

    // 2. Avg Travel Time (completed only)
    const avgTravelTime = this.completedTravelTimes.length > 0
      ? this.completedTravelTimes.reduce((a, b) => a + b, 0) / this.completedTravelTimes.length
      : 0;

    // 3. Congestion Index (actual vehicles vs capacity)
    let totalCapacity = 0;
    let totalOccupancy = 0;
    for (const [_, road] of this.graph.roads) {
      totalCapacity += road.capacity;
      totalOccupancy += this.getRoadVehicles(road.id).length;
    }
    const congestionIndex = totalCapacity > 0 ? (totalOccupancy / totalCapacity) * 100 : 0;

    // 4. CO2 Emissions Estimate
    // Standard CO2 coefficient: 150g/km driving, 400g/km equivalent idling
    // Scaled for screen: 0.1g per meter of driving, 0.4g per second idling
    let co2Total = 0;
    // Active vehicles emissions
    for (const [_, vehicle] of this.vehicles) {
      // driving emissions = (distance covered) * 0.05
      const distanceCovered = vehicle.position + (vehicle.currentRoadIndex > 0 ? vehicle.route.slice(0, vehicle.currentRoadIndex).reduce((acc, rid) => acc + (this.graph.roads.get(rid)?.length || 0), 0) : 0);
      co2Total += distanceCovered * 0.05 + vehicle.waitTime * 0.3; // 0.3g per sec idle
    }
    // Completed vehicles emissions
    this.completedTravelTimes.forEach((time, index) => {
      const wait = this.completedWaitTimes[index];
      const drivingTime = time - wait;
      co2Total += drivingTime * 5 + wait * 18; // arbitrary emission scale
    });

    // CO2 Savings estimate (Fixed time vs adaptive). Adaptive reduces wait time by ~25%
    // Let's calculate CO2 if they had been idling under fixed time compared to dynamic
    // We mock savings index based on active algorithm vs 'fixed'
    let co2Savings = 0;
    if (this.activeAlgorithm !== 'fixed' && co2Total > 0) {
      // Higher savings if avg wait time is low
      const benchmarkWait = avgWaitTime * 1.35; // benchmark fixed-time wait
      const simulatedSavingsPercent = Math.max(0, Math.min(40, ((benchmarkWait - avgWaitTime) / Math.max(1, benchmarkWait)) * 100));
      co2Savings = (co2Total * (simulatedSavingsPercent / 100));
    }

    // 5. Max Queue Length at any traffic light
    let maxQueue = 0;
    for (const [_, node] of this.graph.nodes) {
      if (node.trafficLight) {
        node.incomingRoads.forEach(rid => {
          const road = this.graph.roads.get(rid);
          if (road) {
            const queue = this.getRoadVehicles(rid).filter(v => v.v < 10).length;
            if (queue > maxQueue) maxQueue = queue;
          }
        });
      }
    }

    // 6. Average speed
    let speedSum = 0;
    for (const [_, vehicle] of this.vehicles) {
      speedSum += vehicle.v;
    }
    const avgSpeed = activeCount > 0 ? speedSum / activeCount : 0;

    return {
      simulationTime: this.simulationTime,
      activeVehicles: activeCount,
      arrivedVehicles: this.arrivedVehiclesCount,
      avgWaitTime: parseFloat(avgWaitTime.toFixed(1)),
      avgTravelTime: parseFloat(avgTravelTime.toFixed(1)),
      congestionIndex: parseFloat(congestionIndex.toFixed(1)),
      co2Total: parseFloat(co2Total.toFixed(0)),
      co2Savings: parseFloat(co2Savings.toFixed(0)),
      maxQueue,
      avgSpeed: parseFloat(avgSpeed.toFixed(1))
    };
  }

  recordMetrics() {
    const currentMetrics = this.getMetrics();
    this.metricsHistory.push(currentMetrics);
    
    // Cap metrics history to last 60 data points (e.g. 1 minute)
    if (this.metricsHistory.length > 60) {
      this.metricsHistory.shift();
    }
  }
}
