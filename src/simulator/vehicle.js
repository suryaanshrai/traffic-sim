export class Vehicle {
  constructor(id, route, graph, spawnTime, engine) {
    this.id = id;
    this.route = route; // Array of road IDs
    this.graph = graph;
    
    this.currentRoadIndex = 0;
    this.currentRoad = graph.roads.get(route[0]);
    this.position = 0; // Distance along current road in pixels
    
    // Choose the least congested lane on the first road (isolated by engine context)
    this.lane = this.chooseLane(this.currentRoad, engine);

    // IDM Model Parameters (calibrated for canvas display)
    this.v0 = this.currentRoad.speedLimit; // Desired speed limit (px/s)
    this.v = this.v0 * (0.8 + Math.random() * 0.4); // Initial speed (with random variance)
    this.aMax = 120; // Max acceleration (px/s^2)
    this.bDecel = 160; // Comfortable deceleration (px/s^2)
    this.s0 = 15; // Minimum safety distance bumper-to-bumper (px)
    this.T = 1.0; // Safe time headway (seconds)
    this.accel = 0;

    // Visual attributes
    this.width = 8;
    this.height = 4;
    // Premium color options
    const colors = [
      '#00f2fe', // Electric Cyan
      '#00ff87', // Lime green
      '#ff007f', // Magenta/neon pink
      '#7928CA', // Deep neon purple
      '#ffaa00'  // Gold yellow
    ];
    this.color = colors[Math.floor(Math.random() * colors.length)];
    
    // Metrics
    this.spawnTime = spawnTime;
    this.waitTime = 0; // Accumulated seconds where speed < 5 px/s
    this.totalTravelTime = 0;
    this.isArrived = false;
  }

  chooseLane(road, engine = null) {
    if (!road) return 0;
    const laneCounts = Array(road.lanes).fill(0);
    const vehiclesOnRoad = engine ? engine.getRoadVehicles(road.id) : road.vehicles;
    vehiclesOnRoad.forEach(veh => {
      if (veh.lane < road.lanes) {
        laneCounts[veh.lane]++;
      }
    });
    // Return lane with minimum vehicles
    return laneCounts.indexOf(Math.min(...laneCounts));
  }

  update(dt, currentTime, engine = null) {
    if (this.isArrived) return;

    this.totalTravelTime = currentTime - this.spawnTime;
    if (this.v < 5) {
      this.waitTime += dt;
    }

    // 1. Identify leader in the same lane (isolated by engine context)
    let leader = null;
    let leaderDist = Infinity;

    const vehiclesOnRoad = engine ? engine.getRoadVehicles(this.currentRoad.id) : this.currentRoad.vehicles;
    vehiclesOnRoad.forEach(veh => {
      if (veh.id !== this.id && veh.lane === this.lane && veh.position > this.position) {
        const dist = veh.position - this.position;
        if (dist < leaderDist) {
          leaderDist = dist;
          leader = veh;
        }
      }
    });

    // Safety distance constraint parameters
    let s = Infinity; // distance to obstacle
    let deltaV = 0;   // speed difference to obstacle

    // 2. Adjust target speed if road speed limit changed (dynamic roadblocks/repairs)
    const activeSpeedLimit = this.currentRoad.getEffectiveSpeedLimit();
    this.v0 = activeSpeedLimit;

    if (leader) {
      // Leader is ahead in the same lane: bumper-to-bumper distance
      s = leaderDist - this.width;
      deltaV = this.v - leader.v;
    }

    // 3. Traffic light and end of road checks (evaluate independently of leader distance)
    const distToJunction = this.currentRoad.length - this.position;
    const isSinkAhead = this.currentRoad.toNode.role === 'sink';
    const isLastRoad = this.currentRoadIndex === this.route.length - 1;

    if (isSinkAhead || isLastRoad) {
      // Sinks and final destinations swallow vehicles; no stopping constraint needed
    } else {
      // Check if the next road in our route is blocked
      const nextRoadId = this.route[this.currentRoadIndex + 1];
      const nextRoad = this.graph.roads.get(nextRoadId);
      const isNextRoadBlocked = nextRoad && nextRoad.isBlocked;

      // Check traffic light at the next junction
      const junction = this.currentRoad.toNode;
      const light = junction.trafficLight;

      // Uncontrolled junction yielding logic
      let yieldToVehicle = false;
      if (!light && junction.incomingRoads.length >= 2) {
        // Iterate through conflicting incoming roads to this junction
        junction.incomingRoads.forEach(rid => {
          if (rid !== this.currentRoad.id) {
            const otherVehicles = engine ? engine.getRoadVehicles(rid) : [];
            otherVehicles.forEach(other => {
              if (other.isArrived || other.id === this.id) return;
              const otherDist = other.currentRoad.length - other.position;
              
              // Yield if other vehicle is closer, within 60px, and actually moving (not stopped/deadlocked)
              if (otherDist < 60 && otherDist < distToJunction && other.v > 1.0) {
                // Yield to the closer vehicle to avoid overlapping in the intersection!
                yieldToVehicle = true;
              }
            });
          }
        });
      }

      if (isNextRoadBlocked) {
        // Next road is blocked: stop at the junction stop bar
        const sLight = Math.max(0.1, distToJunction - 10);
        if (sLight < s) {
          s = sLight;
          deltaV = this.v - 0;
        }
      } else if (yieldToVehicle) {
        // Yield to another vehicle at uncontrolled intersection: stop at the stop line
        const sLight = Math.max(0.1, distToJunction - 10);
        if (sLight < s) {
          s = sLight;
          deltaV = this.v - 0;
        }
      } else if (light) {
        const isGreen = light.isGreenForRoad(this.currentRoad.id);
        const isYellow = light.isYellowForRoad(this.currentRoad.id);

        if (!isGreen) {
          // Light is Red: Stop 10px before junction
          const sLight = Math.max(0.1, distToJunction - 10);
          if (sLight < s) {
            s = sLight;
            deltaV = this.v - 0;
          }
        } else if (isYellow) {
          // Light is Yellow: slow down if we have enough distance, otherwise commit and go
          if (distToJunction > 40) {
            const sLight = Math.max(0.1, distToJunction - 10);
            if (sLight < s) {
              s = sLight;
              deltaV = this.v - 0;
            }
          }
        }
      }
    }

    // 4. IDM Acceleration Calculation
    // Safety distance constraint: s* = s0 + v * T + (v * deltaV) / (2 * sqrt(aMax * bDecel))
    if (this.v0 <= 0) {
      // Completely blocked road
      this.accel = -this.bDecel;
    } else {
      const sStar = this.s0 + this.v * this.T + (this.v * deltaV) / (2 * Math.sqrt(this.aMax * this.bDecel));
      
      // acceleration = aMax * [ 1 - (v/v0)^4 - (s*/s)^2 ]
      const ratio = this.v / this.v0;
      const term1 = 1 - Math.pow(ratio, 4);
      const term2 = s <= 0 ? 100 : Math.pow(sStar / s, 2); // Avoid division by zero
      
      this.accel = this.aMax * (term1 - term2);
    }

    // Clamp acceleration for physical limits
    this.accel = Math.max(-this.bDecel * 2.5, Math.min(this.aMax, this.accel));

    // Update speed & position
    this.v += this.accel * dt;
    this.v = Math.max(0, this.v); // Cannot drive backwards
    this.position += this.v * dt;

    // 5. Check for road/junction transition
    if (this.position >= this.currentRoad.length) {
      const isLastRoadTransition = this.currentRoadIndex === this.route.length - 1;
      const isSink = this.currentRoad.toNode.role === 'sink';

      if (isLastRoadTransition || isSink) {
        // Vehicle has reached destination or hit a sink!
        this.arrive();
      } else {
        const nextRoadId = this.route[this.currentRoadIndex + 1];
        const nextRoad = this.graph.roads.get(nextRoadId);

        // Prevent transitioning onto a blocked road segment
        if (nextRoad && nextRoad.isBlocked) {
          this.position = this.currentRoad.length;
          this.v = 0;
          this.accel = 0;
          return;
        }

        // Stop line enforcement: double check if traffic light has turned red/yellow
        // and prevent vehicle crossing if it shouldn't!
        const junction = this.currentRoad.toNode;
        const light = junction.trafficLight;
        if (light) {
          const isGreen = light.isGreenForRoad(this.currentRoad.id);
          if (!isGreen) {
            // Force halt at the stop bar, clamp position, do NOT transition!
            this.position = this.currentRoad.length;
            this.v = 0;
            this.accel = 0;
            return;
          }
        }

        if (nextRoad) {
          const oldRoadLength = this.currentRoad.length;

          // Move to next road
          this.currentRoadIndex++;
          this.currentRoad = nextRoad;
          this.position = this.position - oldRoadLength; // subtract previous road length for accurate overflow position
          this.position = Math.max(0, this.position);
          this.lane = this.chooseLane(this.currentRoad, engine);
        } else {
          // Fallback if next road deleted during simulation
          this.arrive();
        }
      }
    }
  }

  arrive() {
    this.isArrived = true;
    this.v = 0;
    this.accel = 0;
  }
}
