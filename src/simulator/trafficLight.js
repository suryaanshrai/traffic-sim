export class TrafficLight {
  constructor(junctionNode, graph) {
    this.junction = junctionNode;
    this.graph = graph;

    // Phasing and scheduling state
    this.phases = []; // Array of arrays: [ [roadId1, roadId2], [roadId3] ]
    this.currentPhaseIndex = 0;
    this.targetPhaseIndex = 0; // Next target phase index for adaptive algorithms
    this.state = 'GREEN'; // 'GREEN', 'YELLOW', 'RED_ALL' (transition)
    this.timer = 0; // Timer in seconds

    // Configuration parameters
    this.algorithm = 'fixed'; // 'fixed', 'influx', 'max_pressure', 'green_wave'
    this.greenDuration = 15; // Fixed green time
    this.yellowDuration = 3;  // Yellow time
    this.redAllDuration = 1;  // Transition buffer time
    this.phaseGreenDurations = []; // Optional phase-specific green times

    // Influx config
    this.influxLookbackJunctions = 2;

    // Max pressure config
    this.evaluationInterval = 8; // Evaluate every 8 seconds
    this.pressureThreshold = 2;  // Min difference to switch phases

    // Initialize phases based on geometry
    this.initializePhases();
  }

  // Group incoming roads into phases by angle to prevent intersection collisions
  initializePhases() {
    const incomingRoadIds = this.junction.incomingRoads;
    if (incomingRoadIds.length === 0) {
      this.phases = [];
      return;
    }

    if (incomingRoadIds.length <= 2) {
      // 1 or 2 incoming roads can just have their own phases
      this.phases = incomingRoadIds.map(rid => [rid]);
      return;
    }

    // Calculate angles of incoming roads (from starting node to the junction)
    const roadsWithAngles = incomingRoadIds.map(rid => {
      const road = this.graph.roads.get(rid);
      const dx = this.junction.x - road.fromNode.x;
      const dy = this.junction.y - road.fromNode.y;
      let angle = Math.atan2(dy, dx); // -PI to PI
      if (angle < 0) angle += 2 * Math.PI; // Normalize to 0 to 2PI
      return { id: rid, angle };
    });

    // Sort roads by angle
    roadsWithAngles.sort((a, b) => a.angle - b.angle);

    // Group opposite directions together.
    // e.g. North-South incoming roads should be in Phase 0. East-West in Phase 1.
    // Two roads are "opposite" if their angle difference is around PI (180 degrees)
    const phase0 = [];
    const phase1 = [];

    // Let the first road define Phase 0
    phase0.push(roadsWithAngles[0].id);
    const refAngle = roadsWithAngles[0].angle;

    for (let i = 1; i < roadsWithAngles.length; i++) {
      const { id, angle } = roadsWithAngles[i];
      const diff = Math.abs(angle - refAngle);
      // Normalized angle difference
      const normalizedDiff = Math.min(diff, 2 * Math.PI - diff);

      // If angle difference is close to PI (opposite) or close to 0 (same direction merge),
      // group them in Phase 0. Otherwise Phase 1.
      // Tolerance of 45 degrees (PI/4)
      if (Math.abs(normalizedDiff - Math.PI) < Math.PI / 4 || normalizedDiff < Math.PI / 4) {
        phase0.push(id);
      } else {
        phase1.push(id);
      }
    }

    // If Phase 1 is empty (e.g. 3-way T-junction where other 2 roads got merged into Phase 0),
    // split Phase 0 roads or put the third road in Phase 1
    if (phase1.length === 0 && phase0.length > 1) {
      const popped = phase0.pop();
      phase1.push(popped);
    }

    this.phases = [phase0, phase1].filter(p => p.length > 0);
  }

  isGreenForRoad(roadId) {
    if (this.phases.length === 0) return true; // No lights if no incoming roads
    if (this.state !== 'GREEN') return false;
    const activePhase = this.phases[this.currentPhaseIndex];
    return activePhase.includes(roadId);
  }

  isYellowForRoad(roadId) {
    if (this.phases.length === 0) return false;
    if (this.state !== 'YELLOW') return false;
    const activePhase = this.phases[this.currentPhaseIndex];
    return activePhase.includes(roadId);
  }

  update(dt, engine) {
    if (this.phases.length <= 1) return; // No switching needed for single phase

    this.timer += dt;

    // Run active algorithm
    switch (this.algorithm) {
      case 'fixed':
        this.updateFixed(dt);
        break;
      case 'influx':
        this.updateInflux(dt, engine);
        break;
      case 'max_pressure':
        this.updateMaxPressure(dt, engine);
        break;
      case 'green_wave':
        this.updateGreenWave(dt, engine);
        break;
    }
  }

  // 1. DETERMINISTIC FIXED-TIME ALGORITHM (with phase-specific splits)
  updateFixed() {
    const activeGreenDuration = (this.phaseGreenDurations && this.phaseGreenDurations[this.currentPhaseIndex] !== undefined) ? 
                                 this.phaseGreenDurations[this.currentPhaseIndex] : this.greenDuration;
    const currentLimit = this.state === 'GREEN' ? activeGreenDuration : 
                         this.state === 'YELLOW' ? this.yellowDuration : this.redAllDuration;

    if (this.timer >= currentLimit) {
      this.timer = 0;
      this.transitionPhase();
    }
  }

  // 2. INFLUX-AWARE DYNAMIC ALGORITHM (Looks N junctions away with routing-aware validation & distance decay)
  updateInflux(dt, engine) {
    // Only evaluate switching when we are in GREEN state
    if (this.state !== 'GREEN') {
      const currentLimit = this.state === 'YELLOW' ? this.yellowDuration : this.redAllDuration;
      if (this.timer >= currentLimit) {
        this.timer = 0;
        this.transitionPhase();
      }
      return;
    }

    // Dynamic green duration based on upstream traffic
    // Count approaching vehicles up to N junctions away for each phase
    const phaseWeights = this.phases.map(phaseRoads => {
      let count = 0;
      phaseRoads.forEach(roadId => {
        // Validate routing path intersection: only count vehicles whose paths include roadId
        count += this.getUpstreamVehicleCount(roadId, this.influxLookbackJunctions, roadId, new Set(), engine, 0);
      });
      return count;
    });

    const activeWeight = phaseWeights[this.currentPhaseIndex];
    
    // Find the other phase with the maximum upstream traffic weight
    let maxOtherWeight = 0;
    let maxOtherIndex = (this.currentPhaseIndex + 1) % this.phases.length;

    for (let i = 0; i < this.phases.length; i++) {
      if (i !== this.currentPhaseIndex) {
        const w = phaseWeights[i];
        if (w > maxOtherWeight) {
          maxOtherWeight = w;
          maxOtherIndex = i;
        }
      }
    }

    // Minimum green time of 5s to avoid rapid flickering
    if (this.timer < 5) return;

    // Switch if:
    // 1. Hard max green time of 40s reached
    // 2. Active phase is empty (low demand < 0.2) and other phase has waiting traffic (demand > 0.5)
    // 3. Other phase has significantly higher demand (differential >= 1.5)
    const shouldSwitch = (this.timer >= 40) || 
                         (activeWeight < 0.2 && maxOtherWeight > 0.5) || 
                         (maxOtherWeight > activeWeight + 1.5);

    if (shouldSwitch) {
      this.timer = 0;
      this.state = 'YELLOW';
      this.targetPhaseIndex = maxOtherIndex; // Target the highest demand phase!
    }
  }

  // Helper: Traverse graph backwards to count incoming vehicles (avoiding cycles & routing mismatch, applying distance decay)
  getUpstreamVehicleCount(roadId, depth, approachRoadId, visited = new Set(), engine = null, accumulatedDistance = 0) {
    if (visited.has(roadId)) return 0;
    visited.add(roadId);

    let weightSum = 0;
    const road = this.graph.roads.get(roadId);
    if (!road) return 0;

    // Only count vehicles that have the target approach road in their routing path
    const vehiclesOnRoad = engine ? engine.getRoadVehicles(roadId) : road.vehicles;
    vehiclesOnRoad.forEach(vehicle => {
      if (vehicle.route && vehicle.route.includes(approachRoadId)) {
        const distToJunction = (road.length - vehicle.position) + accumulatedDistance;
        // Linear decay: close vehicles weight 1.0, vehicles 600px away weight 0.1
        const vWeight = Math.max(0.1, 1.0 - (distToJunction / 600));
        weightSum += vWeight;
      }
    });

    if (depth <= 0) return weightSum;

    // Go back one junction
    const fromNode = road.fromNode;
    // Iterate through all incoming roads to the upstream node
    fromNode.incomingRoads.forEach(upstreamRoadId => {
      weightSum += this.getUpstreamVehicleCount(upstreamRoadId, depth - 1, approachRoadId, visited, engine, accumulatedDistance + road.length);
    });

    return weightSum;
  }

  // 3. MAX-PRESSURE ALGORITHM (Queue density storage normalized)
  // Pressure = (Queued density on incoming roads) - (Queued density on outgoing roads)
  updateMaxPressure(dt, engine) {
    if (this.state !== 'GREEN') {
      const currentLimit = this.state === 'YELLOW' ? this.yellowDuration : this.redAllDuration;
      if (this.timer >= currentLimit) {
        this.timer = 0;
        this.transitionPhase();
      }
      return;
    }

    // Minimum green duration to prevent rapid flickering
    if (this.timer < 5) return;

    // Evaluate pressure every evaluationInterval seconds
    // Or if the green duration exceeds the safety limit (e.g. 45s)
    const shouldEvaluate = (this.timer >= this.evaluationInterval) || (this.timer >= 45);
    
    if (shouldEvaluate) {
      const pressures = this.phases.map(phaseRoadIds => {
        let pressure = 0;
        phaseRoadIds.forEach(roadId => {
          const road = this.graph.roads.get(roadId);
          if (!road) return;

          // Incoming queue: vehicles moving very slowly (referenced from engine state)
          const roadVehicles = engine ? engine.getRoadVehicles(roadId) : road.vehicles;
          const incomingQueue = roadVehicles.filter(v => v.v < 10).length;
          // Normalize by physical storage capacity (assuming approx 20px per vehicle)
          const storageCapacity = Math.max(1, (road.length / 20) * road.lanes);
          const incomingDensity = incomingQueue / storageCapacity;

          // Outgoing capacity: queue densities on the outgoing roads connected from this junction
          let outgoingSpace = 0;
          this.junction.outgoingRoads.forEach(outRoadId => {
            const outRoad = this.graph.roads.get(outRoadId);
            if (!outRoad) return;
            const outRoadVehicles = engine ? engine.getRoadVehicles(outRoadId) : outRoad.vehicles;
            const outgoingQueue = outRoadVehicles.filter(v => v.v < 10).length;
            const outStorageCapacity = Math.max(1, (outRoad.length / 20) * outRoad.lanes);
            outgoingSpace += outgoingQueue / outStorageCapacity;
          });

          // Pressure = incoming density - average outgoing density
          pressure += incomingDensity - (outgoingSpace / Math.max(1, this.junction.outgoingRoads.length));
        });
        return Math.max(0, pressure);
      });

      const activePressure = pressures[this.currentPhaseIndex];
      
      // Find phase with max pressure
      let maxPressureIndex = this.currentPhaseIndex;
      let maxPressureVal = activePressure;

      pressures.forEach((p, idx) => {
        if (p > maxPressureVal) {
          maxPressureVal = p;
          maxPressureIndex = idx;
        }
      });

      // Switch phase if the pressure difference is above a threshold
      if (maxPressureIndex !== this.currentPhaseIndex && (maxPressureVal - activePressure >= this.pressureThreshold)) {
        this.timer = 0;
        this.state = 'YELLOW';
        this.targetPhaseIndex = maxPressureIndex; // Target the highest pressure phase!
      } else {
        // Reset timer to evaluate again in the next cycle, but clamp green duration
        if (this.timer >= 45) {
          this.timer = 0;
          this.state = 'YELLOW';
          this.targetPhaseIndex = (this.currentPhaseIndex + 1) % this.phases.length; // Cycle sequentially on timeout
        }
      }
    }
  }

  // 4. ADAPTIVE GREEN WAVE COORDINATION ALGORITHM (Dynamic speed adjusted)
  // Uses global simulation clock to offset phases based on real-time average progression speed.
  updateGreenWave(dt, engine) {
    const globalTime = engine.simulationTime;
    const cycleLength = this.greenDuration + this.yellowDuration + this.redAllDuration;

    // Find if we have an upstream junction we coordinate with
    // We look for the most busy incoming road
    let offset = 0;
    if (this.junction.incomingRoads.length > 0) {
      // Find the longest incoming road (major corridor)
      let longestIncomingRoad = null;
      let maxLength = 0;
      this.junction.incomingRoads.forEach(rid => {
        const road = this.graph.roads.get(rid);
        if (road && road.length > maxLength) {
          maxLength = road.length;
          longestIncomingRoad = road;
        }
      });

      if (longestIncomingRoad) {
        // Calculate dynamic average progression speed of vehicles on segment
        const vehiclesOnRoad = engine ? engine.getRoadVehicles(longestIncomingRoad.id) : longestIncomingRoad.vehicles;
        const avgSpeed = vehiclesOnRoad.length > 0 ? 
                         (vehiclesOnRoad.reduce((sum, v) => sum + v.v, 0) / vehiclesOnRoad.length) : 
                         longestIncomingRoad.speedLimit;
        
        // Offset = Travel Time (distance / average speed). Clamp to minimum 5px/s.
        const travelTime = longestIncomingRoad.length / Math.max(5, avgSpeed);
        offset = travelTime; // Adaptive Offset in seconds
      }
    }

    // Calculate current phase from global time with offset
    const adjustedTime = (globalTime - offset) % (cycleLength * this.phases.length);
    const normalizedTime = adjustedTime < 0 ? adjustedTime + (cycleLength * this.phases.length) : adjustedTime;

    const phaseCycleIndex = Math.floor(normalizedTime / cycleLength);
    const timeInCycle = normalizedTime % cycleLength;

    let targetState = 'GREEN';
    if (timeInCycle >= this.greenDuration) {
      if (timeInCycle < this.greenDuration + this.yellowDuration) {
        targetState = 'YELLOW';
      } else {
        targetState = 'RED_ALL';
      }
    }

    this.currentPhaseIndex = phaseCycleIndex % this.phases.length;
    this.state = targetState;
  }

  transitionPhase() {
    if (this.state === 'GREEN') {
      this.state = 'YELLOW';
    } else if (this.state === 'YELLOW') {
      this.state = 'RED_ALL';
    } else {
      this.state = 'GREEN';
      this.currentPhaseIndex = this.targetPhaseIndex;
      // Setup the next sequential target phase as the default fallback
      this.targetPhaseIndex = (this.currentPhaseIndex + 1) % this.phases.length;
    }
  }
}
