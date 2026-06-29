export class CanvasRenderer {
  constructor(canvas, graph, engine, builder) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.graph = graph;
    this.engine = engine;
    this.builder = builder; // Reference to get active tool/selections
    
    this.isMapMode = false;
    
    // Zoom and Pan states for Custom Grid Builder Mode
    this.zoom = 1.0;
    this.panOffset = { x: 0, y: 0 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    
    // Track mouse coordinates for hover grid effect
    this.mousePos = { x: 0, y: 0 };
    this.isMouseOver = false;

    // Track vehicle tail history for trails (since clearRect is used)
    this.vehicleHistory = new Map(); // vehId -> Array of {x, y}

    this.initEvents();
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      this.isMouseOver = true;
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isMouseOver = false;
    });
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  setMapMode(active) {
    this.isMapMode = active;
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // 1. Clear Canvas
    if (this.isMapMode) {
      // Map mode needs full transparency so OSM tiles show behind it
      ctx.clearRect(0, 0, w, h);
    } else {
      // Grid Builder mode gets dark background
      ctx.fillStyle = '#050508';
      ctx.fillRect(0, 0, w, h);
    }

    // 2. Draw Hover Glow (antigravity.google magnetic ripple)
    if (!this.isMapMode && this.isMouseOver && !this.isPanning) {
      this.drawMouseRipple(ctx);
    }

    // Apply zoom and panning transformations for grid builder mode
    ctx.save();
    if (!this.isMapMode) {
      ctx.translate(this.panOffset.x, this.panOffset.y);
      ctx.scale(this.zoom, this.zoom);
      this.drawDigitalGrid(ctx, w, h);
    }

    // 3. Draw Roads (edges)
    this.drawRoads(ctx);

    // 4. Draw Junctions (nodes)
    this.drawJunctions(ctx);

    // 5. Draw Construction dragging overlay
    this.drawBuilderHelpers(ctx);

    // 6. Draw Vehicles with neon trails
    this.drawVehicles(ctx);

    ctx.restore();

    // 7. Draw System Command HUD
    this.drawHUD(ctx, w, h);
  }

  drawDigitalGrid(ctx, w, h) {
    const gridSize = 40;
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.03)';
    ctx.lineWidth = 1;

    // Determine grid bounds based on panning and zoom
    const startX = Math.floor((-this.panOffset.x) / this.zoom / gridSize) * gridSize - gridSize;
    const endX = Math.ceil((w - this.panOffset.x) / this.zoom / gridSize) * gridSize + gridSize;
    const startY = Math.floor((-this.panOffset.y) / this.zoom / gridSize) * gridSize - gridSize;
    const endY = Math.ceil((h - this.panOffset.y) / this.zoom / gridSize) * gridSize + gridSize;

    // Vertical lines
    for (let x = startX; x < endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = startY; y < endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }

    // Draw little intersection cross dots
    ctx.fillStyle = 'rgba(0, 242, 254, 0.1)';
    for (let x = startX; x < endX; x += gridSize) {
      for (let y = startY; y < endY; y += gridSize) {
        if ((x + y) % 80 === 0) {
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
      }
    }
  }

  drawMouseRipple(ctx) {
    const mx = this.mousePos.x;
    const my = this.mousePos.y;

    const radialGrd = ctx.createRadialGradient(mx, my, 0, mx, my, 200);
    radialGrd.addColorStop(0, 'rgba(0, 242, 254, 0.08)');
    radialGrd.addColorStop(0.5, 'rgba(121, 40, 202, 0.03)');
    radialGrd.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = radialGrd;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawRoads(ctx) {
    for (const [id, road] of this.graph.roads) {
      const from = road.fromNode;
      const to = road.toNode;
      
      const isSelected = this.builder.selectedElement && 
                         this.builder.selectedElement.type === 'road' && 
                         this.builder.selectedElement.obj.id === id;

      // Check if road is One-Way
      const revId = `road_${road.toNode.id}_${road.fromNode.id}`;
      const isOneWay = !this.graph.roads.has(revId);

      // Normal vector for directional lane shifting (visual separation of opposite directions)
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const angle = Math.atan2(dy, dx);
      const roadLen = Math.max(1, road.length);
      const nx = -dy / roadLen;
      const ny = dx / roadLen;

      // Shift road to the right of its flow direction if bidirectional
      const roadOffset = (!isOneWay) ? 3.0 : 0;
      
      const fx = from.x + nx * roadOffset;
      const fy = from.y + ny * roadOffset;
      const tx = to.x + nx * roadOffset;
      const ty = to.y + ny * roadOffset;

      // 1. Draw Road Base background
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.lineWidth = road.lanes * 8;
      
      let roadColor = 'rgba(255, 255, 255, 0.04)';
      if (road.isBlocked) {
        roadColor = 'rgba(255, 0, 85, 0.08)'; // Hazard red glow
      } else if (isOneWay) {
        roadColor = isSelected ? 'rgba(139, 92, 246, 0.22)' : 'rgba(139, 92, 246, 0.07)'; // Violet one-way
      } else if (isSelected) {
        roadColor = 'rgba(0, 242, 254, 0.18)'; // Cyan select
      }
      
      ctx.strokeStyle = roadColor;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 2. Road roadblocks or repairs ( caution warning style )
      if (road.isBlocked) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.lineWidth = road.lanes * 5;
        ctx.strokeStyle = '#ff0055'; // neon red
        ctx.lineCap = 'round';
        ctx.setLineDash([5, 8]);
        ctx.lineDashOffset = -(Date.now() / 80) % 13;
        ctx.stroke();
        ctx.restore();
      } else if (road.speedFactor < 1.0) {
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.lineWidth = road.lanes * 5;
        ctx.strokeStyle = '#ffaa00'; // neon yellow
        ctx.lineCap = 'round';
        ctx.setLineDash([8, 8]);
        ctx.lineDashOffset = -(Date.now() / 150) % 16;
        ctx.stroke();
        ctx.restore();
      } else {
        // Regular roads: draw subtle dashed lanes division lines if lanes > 1
        if (road.lanes > 1) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(tx, ty);
          ctx.lineWidth = 1;
          ctx.strokeStyle = isOneWay ? 'rgba(139, 92, 246, 0.15)' : 'rgba(255, 255, 255, 0.08)';
          ctx.setLineDash([8, 12]);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Draw subtle boundary limits
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.lineWidth = road.lanes * 8;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.01)';
      ctx.stroke();

      // 3. Draw direction chevrons along the road lanes
      const arrowSpacing = isOneWay ? 35 : 55;
      const numArrows = Math.floor(road.length / arrowSpacing);
      if (numArrows > 0) {
        ctx.save();
        
        if (isOneWay) {
          ctx.strokeStyle = isSelected ? '#a855f7' : 'rgba(168, 85, 247, 0.55)'; // glowing violet arrows
          ctx.lineWidth = 1.4;
        } else {
          ctx.strokeStyle = road.isBlocked ? 'rgba(255, 0, 85, 0.15)' : 'rgba(0, 242, 254, 0.12)'; // cyan arrows
          ctx.lineWidth = 1.0;
        }
        
        ctx.lineCap = 'round';
        
        // Shift chevrons slightly to represent directional flow lane centering
        const shiftAmount = isOneWay ? 0 : 3.5; 
        
        for (let i = 1; i <= numArrows; i++) {
          const dist = i * arrowSpacing;
          if (dist > 15 && dist < road.length - 15) {
            const ax = fx + (dx / roadLen) * dist + nx * shiftAmount;
            const ay = fy + (dy / roadLen) * dist + ny * shiftAmount;
            
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(angle);
            ctx.beginPath();
            ctx.moveTo(-3, -2.5);
            ctx.lineTo(1, 0);
            ctx.lineTo(-3, 2.5);
            ctx.stroke();
            ctx.restore();
          }
        }
        ctx.restore();
      }
    }
  }

  drawJunctions(ctx) {
    for (const [id, node] of this.graph.nodes) {
      const isSelected = this.builder.selectedElement && 
                         this.builder.selectedElement.type === 'node' && 
                         this.builder.selectedElement.obj.id === id;

      // Color coding based on role
      let baseColor = 'rgba(255, 255, 255, 0.1)';
      let rimColor = 'rgba(255, 255, 255, 0.25)';
      let shadowColor = null;

      if (node.role === 'source') {
        baseColor = isSelected ? 'rgba(0, 242, 254, 0.4)' : 'rgba(0, 242, 254, 0.15)';
        rimColor = '#00f2fe'; // Neon cyan
        shadowColor = '#00f2fe';
      } else if (node.role === 'sink') {
        baseColor = isSelected ? 'rgba(255, 0, 127, 0.4)' : 'rgba(255, 0, 127, 0.15)';
        rimColor = '#ff007f'; // Neon pink
        shadowColor = '#ff007f';
      } else if (isSelected) {
        baseColor = 'rgba(0, 242, 254, 0.2)';
        rimColor = '#00f2fe';
      }

      // 1. Draw glowing background circle
      ctx.save();
      if (shadowColor) {
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, isSelected ? 8 : 5.5, 0, 2 * Math.PI);
      ctx.fillStyle = baseColor;
      ctx.fill();

      // Outer neon rim
      ctx.beginPath();
      ctx.arc(node.x, node.y, isSelected ? 8 : 5.5, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rimColor;
      ctx.stroke();
      ctx.restore();

      // 2. Draw traffic light indicators at junctions
      if (node.trafficLight && node.trafficLight.phases.length > 0) {
        // Draw a neon ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.stroke();

        // Draw individual lights at each incoming road entry boundary
        node.incomingRoads.forEach(roadId => {
          const road = this.graph.roads.get(roadId);
          if (!road) return;

          // Find direction vector of the road entering the junction
          const dx = node.x - road.fromNode.x;
          const dy = node.y - road.fromNode.y;
          const len = Math.max(1, road.length);
          
          // Place light 12 pixels away from node center along road path
          const lx = node.x - (dx / len) * 12;
          const ly = node.y - (dy / len) * 12;

          // Determine light color
          let color = '#ff0055'; // Red
          if (node.trafficLight.isGreenForRoad(roadId)) {
            color = '#00ff87'; // Green
          } else if (node.trafficLight.isYellowForRoad(roadId)) {
            color = '#ffaa00'; // Yellow
          }

          // Draw neon glowing light dot
          ctx.save();
          ctx.beginPath();
          ctx.arc(lx, ly, 3.5, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.restore();
        });
      }
    }
  }

  drawBuilderHelpers(ctx) {
    if (this.builder.isDragging && this.builder.dragStartNode) {
      const from = this.builder.dragStartNode;
      const to = this.builder.mousePos;

      // Draw dashed guideline for new road
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.4)';
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.restore();

      // Highlight target snapping node if hovered
      const hoveredNode = this.builder.findNodeAt(to.x, to.y);
      if (hoveredNode && hoveredNode.id !== from.id) {
        ctx.beginPath();
        ctx.arc(hoveredNode.x, hoveredNode.y, 10, 0, 2 * Math.PI);
        ctx.strokeStyle = '#00ff87';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  drawVehicles(ctx) {
    const currentActiveVehicles = new Set();

    for (const [id, vehicle] of this.engine.vehicles) {
      currentActiveVehicles.add(id);

      const road = vehicle.currentRoad;
      if (!road) continue;

      // 1. Calculate vehicle location on road segment
      const from = road.fromNode;
      const to = road.toNode;
      const progressRatio = vehicle.position / Math.max(1, road.length);

      const x = from.x + (to.x - from.x) * progressRatio;
      const y = from.y + (to.y - from.y) * progressRatio;

      // Perpendicular vector for lane shifting
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const roadLen = Math.max(1, road.length);
      const nx = -dy / roadLen;
      const ny = dx / roadLen;

      // Lane width approx 6px. Shift center
      const laneWidth = 6;
      const revId = `road_${road.toNode.id}_${road.fromNode.id}`;
      const isOneWay = !this.graph.roads.has(revId);
      const roadOffset = (!isOneWay) ? 3.0 : 0;
      const offset = (vehicle.lane - (road.lanes - 1) / 2) * laneWidth + roadOffset;

      const vx = x + nx * offset;
      const vy = y + ny * offset;

      // 2. Draw Vehicle Trails (history list)
      let history = this.vehicleHistory.get(id);
      if (!history) {
        history = [];
        this.vehicleHistory.set(id, history);
      }
      history.push({ x: vx, y: vy });
      if (history.length > 5) {
        history.shift();
      }

      if (history.length > 1) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (let i = 0; i < history.length - 1; i++) {
          const pt1 = history[i];
          const pt2 = history[i+1];
          const alpha = (i + 1) / history.length * 0.4;
          ctx.strokeStyle = this.hexToRgbA(vehicle.color, alpha);
          ctx.beginPath();
          ctx.moveTo(pt1.x, pt1.y);
          ctx.lineTo(pt2.x, pt2.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 3. Draw Vehicle tiny car shape
      const angle = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(vx, vy);
      ctx.rotate(angle);

      const w = vehicle.width;
      const h = vehicle.height;

      // Wheels (four tiny dark blocks)
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-w/3, -h/2 - 1, w/6, 1);
      ctx.fillRect(w/6 - 1, -h/2 - 1, w/6, 1);
      ctx.fillRect(-w/3, h/2, w/6, 1);
      ctx.fillRect(w/6 - 1, h/2, w/6, 1);

      // Body (neon rounded rect)
      ctx.shadowColor = vehicle.color;
      ctx.shadowBlur = 3;
      ctx.fillStyle = vehicle.color;
      ctx.beginPath();
      ctx.roundRect(-w/2, -h/2, w, h, 1.5);
      ctx.fill();

      // Cabin / windshield (small dark glass block)
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(-w/4, -h/2 + 1, w/2, h - 2, 1);
      ctx.fill();

      // Windshield highlight sheen
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.fillRect(w/12, -h/2 + 1, 1.5, h - 2);

      // Tiny headlights if traveling forward
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillRect(w/2 - 1.5, -h/2 + 0.5, 1.5, 1);
      ctx.fillRect(w/2 - 1.5, h/2 - 1.5, 1.5, 1);

      // Tiny brake taillights
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(-w/2, -h/2 + 0.5, 1, 1);
      ctx.fillRect(-w/2, h/2 - 1.5, 1, 1);

      ctx.restore();
    }

    // Clean up history of arrived/removed vehicles
    for (const [id] of this.vehicleHistory) {
      if (!currentActiveVehicles.has(id)) {
        this.vehicleHistory.delete(id);
      }
    }
  }

  // Helper helper function to parse hex to rgba
  hexToRgbA(hex, alpha) {
    let c;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length== 3){
            c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c= '0x' + c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return 'rgba(0, 242, 254, ' + alpha + ')'; // fallback
  }

  drawHUD(ctx, w, h) {
    ctx.save();
    
    // Draw HUD container in the top right
    ctx.fillStyle = 'rgba(10, 10, 18, 0.75)';
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(w - 240, 20, 220, 65, 6);
    ctx.fill();
    ctx.stroke();

    // Text labels
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '500 9px Space Grotesk';
    ctx.fillText('SYSTEM COMMAND HUD', w - 225, 34);

    ctx.fillStyle = '#fff';
    ctx.font = '600 10.5px Space Grotesk';
    
    const algoNames = {
      'fixed': 'FIXED-TIME CONTROL',
      'influx': 'INFLUX-AWARE DYNAMIC',
      'max_pressure': 'MAX-PRESSURE ADAPTIVE',
      'green_wave': 'GREEN WAVE COORD'
    };
    const algoStr = algoNames[this.engine.activeAlgorithm] || this.engine.activeAlgorithm.toUpperCase();
    
    ctx.fillStyle = '#00f2fe'; // Neon cyan
    ctx.fillText(`ALGORITHM: ${algoStr}`, w - 225, 50);

    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`SIMULATION STATE: ${this.engine.isRunning ? 'RUNNING (' + this.engine.speedMultiplier.toFixed(1) + 'x)' : 'PAUSED'}`, w - 225, 65);

    ctx.restore();
  }
}
