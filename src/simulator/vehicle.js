export class Vehicle {
  constructor(id, route, graph, spawnTime) {
    this.id = id;
    this.route = route; // Array of road IDs
    this.graph = graph;
    
    this.currentRoadIndex = 0;
    this.currentRoad = graph.roads.get(route[0]);
    this.position = 0; // Distance along current road in pixels
    
    // Choose the least congested lane on the first road
    this.lane = this.chooseLane(this.currentRoad);
    this.currentRoad.vehicles.push(this);

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

  chooseLane(road) {
    if (!road) return 0;
    const laneCounts = Array(road.lanes).fill(0);
    road.vehicles.forEach(veh => {
      if (veh.lane < road.lanes) {
        laneCounts[veh.lane]++;
      }
    });
    // Return lane with minimum vehicles
    return laneCounts.indexOf(Math.min(...laneCounts));
  }

  update(dt, currentTime) {
    if (this.isArrived) return;

    this.totalTravelTime = currentTime - this.spawnTime;
    if (this.v < 5) {
      this.waitTime += dt;
    }

    // 1. Identify leader in the same lane
    let leader = null;
    let leaderDist = Infinity;

    this.currentRoad.vehicles.forEach(veh => {
      if (veh.id !== this.id && veh.lane === this.lane && veh.position > this.position) {
        const dist = veh.position - this.position;
        if (dist < leaderDist) {
          leaderDist = dist;
          leader = veh;
        }
      }
    });

    let s = Infinity; // Distance to obstacle
    let deltaV = 0;   // Speed difference

    // 2. Adjust target speed if road speed limit changed (dynamic roadblocks/repairs)
    const activeSpeedLimit = this.currentRoad.getEffectiveSpeedLimit();
    this.v0 = activeSpeedLimit;

    if (leader) {
      // Leader is ahead in the same lane
      s = leaderDist - this.width; // Bumper-to-bumper distance
      deltaV = this.v - leader.v;
    } else {
      // No vehicle ahead in lane, check the intersection at the end of the road
      const distToJunction = this.currentRoad.length - this.position;
      
      const isSinkAhead = this.currentRoad.toNode.role === 'sink';
      const isLastRoad = this.currentRoadIndex === this.route.length - 1;

      if (isSinkAhead) {
        // Drive straight into the sink at full speed (no decelerating)
        s = Infinity;
        deltaV = 0;
      } else if (isLastRoad) {
        // Stop at the very end of the final road
        s = distToJunction;
        deltaV = this.v - 0;
      } else {
        // Check traffic light at the next junction
        const nextRoadId = this.route[this.currentRoadIndex + 1];
        const nextRoad = this.graph.roads.get(nextRoadId);
        const junction = this.currentRoad.toNode;
        const light = junction.trafficLight;

        if (light) {
          const isGreen = light.isGreenForRoad(this.currentRoad.id);
          const isYellow = light.isYellowForRoad(this.currentRoad.id);

          if (!isGreen) {
            // Light is Red
            s = distToJunction - 10; // Stop 10px before junction
            deltaV = this.v - 0;
          } else if (isYellow) {
            // Light is Yellow: slow down if we have enough distance, otherwise commit and go
            if (distToJunction > 40) {
              s = distToJunction - 10;
              deltaV = this.v - 0;
            } else {
              // Commit to passing
              s = Infinity;
              deltaV = 0;
            }
          }
        }
      }
    }

    // 3. IDM Acceleration Calculation
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

    // 4. Check for road/junction transition
    if (this.position >= this.currentRoad.length) {
      const isLastRoad = this.currentRoadIndex === this.route.length - 1;
      const isSink = this.currentRoad.toNode.role === 'sink';

      if (isLastRoad || isSink) {
        // Vehicle has reached destination or hit a sink!
        this.arrive();
      } else {
        // Move to next road
        const nextRoadId = this.route[this.currentRoadIndex + 1];
        const nextRoad = this.graph.roads.get(nextRoadId);
        
        if (nextRoad) {
          const oldRoadLength = this.currentRoad.length;

          // Remove from current road
          this.currentRoad.vehicles = this.currentRoad.vehicles.filter(veh => veh.id !== this.id);
          
          // Move to next road
          this.currentRoadIndex++;
          this.currentRoad = nextRoad;
          this.position = this.position - oldRoadLength; // subtract previous road length for accurate overflow position
          this.position = Math.max(0, this.position);
          this.lane = this.chooseLane(this.currentRoad);
          
          this.currentRoad.vehicles.push(this);
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
    // Remove reference from road
    if (this.currentRoad) {
      this.currentRoad.vehicles = this.currentRoad.vehicles.filter(veh => veh.id !== this.id);
    }
  }
}
