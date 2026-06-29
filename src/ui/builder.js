export class NetworkBuilder {
  constructor(canvas, graph, engine, onElementSelected) {
    this.canvas = canvas;
    this.graph = graph;
    this.engine = engine;
    this.onElementSelected = onElementSelected; // Callback: (type, element) => {}

    this.activeTool = 'select'; // 'select', 'node', 'road', 'oneway', 'hazard', 'delete'
    this.selectedElement = null; // { type: 'node'|'road', obj: Node|Road }

    // State for drawing roads
    this.dragStartNode = null;
    this.mousePos = { x: 0, y: 0 };
    this.isDragging = false;

    // State for dragging/moving nodes
    this.draggedNode = null;
    this.isMovingNode = false;

    // Node snapping/clicking radius
    this.clickRadius = 15;
    // Road selection width tolerance
    this.roadTolerance = 8;

    this.initEvents();
  }

  setTool(tool) {
    this.activeTool = tool;
    this.cancelDragging();
    this.deselect();
    this.updateCursor();
  }

  updateCursor() {
    this.canvas.classList.remove('cursor-crosshair', 'cursor-cell', 'cursor-pointer', 'cursor-blocked');
    switch (this.activeTool) {
      case 'select':
        this.canvas.classList.add('cursor-pointer');
        break;
      case 'node':
        this.canvas.classList.add('cursor-cell');
        break;
      case 'road':
      case 'oneway':
        this.canvas.classList.add('cursor-crosshair');
        break;
      case 'hazard':
        this.canvas.classList.add('cursor-pointer');
        break;
      case 'delete':
        this.canvas.classList.add('cursor-blocked');
        break;
    }
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

    // Map Touch Events to Mouse Events on mobile for seamless canvas drawing/drag
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
          clientX: touch.clientX,
          clientY: touch.clientY,
          bubbles: true,
          cancelable: true
        });
        this.canvas.dispatchEvent(mouseEvent);
        // Prevent default scrolling only when construction tool is active
        if (this.activeTool !== 'select') {
          e.preventDefault();
        }
      }
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
          clientX: touch.clientX,
          clientY: touch.clientY,
          bubbles: true,
          cancelable: true
        });
        this.canvas.dispatchEvent(mouseEvent);
        if (this.activeTool !== 'select') {
          e.preventDefault();
        }
      }
    }, { passive: false });

    this.canvas.addEventListener('touchend', (e) => {
      const mouseEvent = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true
      });
      window.dispatchEvent(mouseEvent);
    });
  }

  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  getGraphCoords(pos) {
    if (this.canvasRenderer && !this.canvasRenderer.isMapMode) {
      const zoom = this.canvasRenderer.zoom;
      const pan = this.canvasRenderer.panOffset;
      return {
        x: (pos.x - pan.x) / zoom,
        y: (pos.y - pan.y) / zoom
      };
    }
    return pos;
  }

  handleMouseDown(e) {
    // Avoid drawing when drag panning is active (right/middle click)
    if (this.canvasRenderer && this.canvasRenderer.isPanning) return;

    const pos = this.getMousePos(e);
    const graphPos = this.getGraphCoords(pos);
    
    // Find clicked node in graph space
    const clickedNode = this.findNodeAt(graphPos.x, graphPos.y);
    const clickedRoad = clickedNode ? null : this.findRoadAt(graphPos.x, graphPos.y);

    if (this.activeTool === 'select') {
      if (clickedNode) {
        this.selectElement('node', clickedNode);
        this.draggedNode = clickedNode;
        this.isMovingNode = true;
        this.mousePos = graphPos;
      } else if (clickedRoad) {
        this.selectElement('road', clickedRoad);
      } else {
        this.deselect();
      }
    } else if (this.activeTool === 'node') {
      if (clickedNode) {
        this.selectElement('node', clickedNode);
      } else {
        // Create new node at translated position
        const nodeId = `node_${Date.now()}`;
        const newNode = this.graph.addNode(nodeId, graphPos.x, graphPos.y);
        
        // Re-initialize traffic lights
        this.notifyGraphChanged();
        this.selectElement('node', newNode);
      }
    } else if (this.activeTool === 'road' || this.activeTool === 'oneway') {
      if (clickedNode) {
        this.dragStartNode = clickedNode;
        this.isDragging = true;
        this.mousePos = graphPos;
      }
    } else if (this.activeTool === 'hazard') {
      if (clickedRoad) {
        clickedRoad.isBlocked = !clickedRoad.isBlocked;
        clickedRoad.speedFactor = clickedRoad.isBlocked ? 0.0 : 1.0;
        
        if (clickedRoad.isBlocked) {
          this.engine.activeRoadblocks.add(clickedRoad.id);
        } else {
          this.engine.activeRoadblocks.delete(clickedRoad.id);
        }
        
        this.selectElement('road', clickedRoad);
      }
    } else if (this.activeTool === 'delete') {
      if (clickedNode) {
        // Notify road removals for all connected roads first
        const connectedRoads = [...clickedNode.incomingRoads, ...clickedNode.outgoingRoads];
        connectedRoads.forEach(rid => {
          if (this.onRoadRemoved) this.onRoadRemoved(rid);
        });
        this.graph.removeNode(clickedNode.id);
        this.notifyGraphChanged();
        this.deselect();
      } else if (clickedRoad) {
        if (this.onRoadRemoved) this.onRoadRemoved(clickedRoad.id);
        this.graph.removeRoad(clickedRoad.id);
        this.deselect();
      }
    }
  }

  handleMouseMove(e) {
    const pos = this.getMousePos(e);
    const graphPos = this.getGraphCoords(pos);

    if (this.isDragging) {
      this.mousePos = graphPos;
    }

    if (this.isMovingNode && this.draggedNode) {
      this.draggedNode.x = graphPos.x;
      this.draggedNode.y = graphPos.y;

      // Update connected roads lengths and capacities
      const affectedRoads = [...this.draggedNode.incomingRoads, ...this.draggedNode.outgoingRoads];
      affectedRoads.forEach(rid => {
        const road = this.graph.roads.get(rid);
        if (road) {
          road.length = road.calculateLength();
          road.capacity = road.lanes * 25;
        }
      });
    }
  }

  handleMouseUp(e) {
    if (this.isMovingNode) {
      this.isMovingNode = false;
      this.draggedNode = null;
      this.notifyGraphChanged();
    }

    if (!this.isDragging) return;

    const pos = this.getMousePos(e);
    const graphPos = this.getGraphCoords(pos);
    const clickedNode = this.findNodeAt(graphPos.x, graphPos.y);

    if (this.dragStartNode && clickedNode && this.dragStartNode.id !== clickedNode.id) {
      if (this.activeTool === 'road') {
        // Create bidirectional road
        const roadId1 = `road_${this.dragStartNode.id}_${clickedNode.id}`;
        const roadId2 = `road_${clickedNode.id}_${this.dragStartNode.id}`;
        
        this.graph.addRoad(roadId1, this.dragStartNode.id, clickedNode.id);
        this.graph.addRoad(roadId2, clickedNode.id, this.dragStartNode.id);
        
        this.notifyGraphChanged();
        this.selectElement('road', this.graph.roads.get(roadId1));
      } else if (this.activeTool === 'oneway') {
        // Create single directional road
        const roadId = `road_${this.dragStartNode.id}_${clickedNode.id}`;
        
        this.graph.addRoad(roadId, this.dragStartNode.id, clickedNode.id);
        this.notifyGraphChanged();
        this.selectElement('road', this.graph.roads.get(roadId));
      }
    }

    this.cancelDragging();
  }

  cancelDragging() {
    this.isDragging = false;
    this.dragStartNode = null;
  }

  selectElement(type, element) {
    this.selectedElement = { type, obj: element };
    if (this.onElementSelected) {
      this.onElementSelected(type, element);
    }
  }

  deselect() {
    this.selectedElement = null;
    if (this.onElementSelected) {
      this.onElementSelected(null, null);
    }
  }

  findNodeAt(x, y) {
    const zoom = (this.canvasRenderer && !this.canvasRenderer.isMapMode) ? this.canvasRenderer.zoom : 1.0;
    const adjustedRadius = this.clickRadius / zoom;

    for (const [_, node] of this.graph.nodes) {
      const dx = node.x - x;
      const dy = node.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < adjustedRadius) {
        return node;
      }
    }
    return null;
  }

  findRoadAt(x, y) {
    const zoom = (this.canvasRenderer && !this.canvasRenderer.isMapMode) ? this.canvasRenderer.zoom : 1.0;
    const adjustedTolerance = this.roadTolerance / zoom;

    for (const [_, road] of this.graph.roads) {
      const dist = this.getDistanceToSegment(x, y, road.fromNode.x, road.fromNode.y, road.toNode.x, road.toNode.y);
      if (dist < adjustedTolerance) {
        return road;
      }
    }
    return null;
  }

  getDistanceToSegment(px, py, x1, y1, x2, y2) {
    const l2 = Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(px - x1, 2) + Math.pow(py - y1, 2));

    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment boundaries

    const projX = x1 + t * (x2 - x1);
    const projY = y1 + t * (y2 - y1);

    return Math.sqrt(Math.pow(px - projX, 2) + Math.pow(py - projY, 2));
  }

  handleManualClick(x, y) {
    const clickedNode = this.findNodeAt(x, y);
    const clickedRoad = clickedNode ? null : this.findRoadAt(x, y);

    if (this.activeTool === 'hazard' && clickedRoad) {
      clickedRoad.isBlocked = !clickedRoad.isBlocked;
      clickedRoad.speedFactor = clickedRoad.isBlocked ? 0.0 : 1.0;
      if (clickedRoad.isBlocked) {
        this.engine.activeRoadblocks.add(clickedRoad.id);
      } else {
        this.engine.activeRoadblocks.delete(clickedRoad.id);
      }
      this.selectElement('road', clickedRoad);
    } else if (this.activeTool === 'delete') {
      if (clickedNode) {
        const connectedRoads = [...clickedNode.incomingRoads, ...clickedNode.outgoingRoads];
        connectedRoads.forEach(rid => {
          if (this.onRoadRemoved) this.onRoadRemoved(rid);
        });
        this.graph.removeNode(clickedNode.id);
        this.notifyGraphChanged();
        this.deselect();
      } else if (clickedRoad) {
        if (this.onRoadRemoved) this.onRoadRemoved(clickedRoad.id);
        this.graph.removeRoad(clickedRoad.id);
        this.deselect();
      }
    } else {
      if (clickedNode) {
        this.selectElement('node', clickedNode);
      } else if (clickedRoad) {
        this.selectElement('road', clickedRoad);
      } else {
        this.deselect();
      }
    }
  }

  notifyGraphChanged() {
    if (this.onGraphChanged) {
      this.onGraphChanged();
    } else {
      this.engine.initializeTrafficLights();
    }
  }
}
