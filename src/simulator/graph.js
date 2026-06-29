export class Node {
  constructor(id, x, y, lat = null, lng = null) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.lat = lat; // Map coordinate
    this.lng = lng; // Map coordinate
    this.incomingRoads = [];
    this.outgoingRoads = [];
    this.trafficLight = null; // Instantiated if it becomes a junction
    this.role = 'junction'; // 'junction', 'source', 'sink'
  }
}

export class Road {
  constructor(id, fromNode, toNode, lanes = 2, speedLimit = 80) {
    this.id = id;
    this.fromNode = fromNode;
    this.toNode = toNode;
    this.lanes = lanes;
    this.speedLimit = speedLimit; // Base speed limit (px/s or scale)
    this.capacity = lanes * 25; // Approx capacity based on length and lanes
    this.isBlocked = false;
    this.speedFactor = 1.0; // 0.0 = full block, 0.2 = repair, 1.0 = normal
    this.vehicles = [];
    this.length = this.calculateLength();
  }

  calculateLength() {
    const dx = this.toNode.x - this.fromNode.x;
    const dy = this.toNode.y - this.fromNode.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getEffectiveSpeedLimit() {
    if (this.isBlocked) return 0;
    return this.speedLimit * this.speedFactor;
  }

  getWeight(engine = null) {
    // Dijkstra weight (travel time in seconds, or penalize high congestion / roadblocks)
    const speed = this.getEffectiveSpeedLimit();
    if (speed <= 0) return Infinity; // Blocked road

    const baseTime = this.length / speed;
    
    // Penalize congestion using engine private state if provided
    const vehicleCount = engine ? engine.getRoadVehicles(this.id).length : this.vehicles.length;
    const density = vehicleCount / (this.capacity || 1);
    const congestionPenalty = 1 + density * 5; // Up to 6x time if packed

    return baseTime * congestionPenalty;
  }
}

export class Graph {
  constructor() {
    this.nodes = new Map();
    this.roads = new Map();
  }

  addNode(id, x, y, lat = null, lng = null) {
    if (this.nodes.has(id)) return this.nodes.get(id);
    const node = new Node(id, x, y, lat, lng);
    this.nodes.set(id, node);
    return node;
  }

  addRoad(id, fromId, toId, lanes = 2, speedLimit = 80) {
    if (this.roads.has(id)) return this.roads.get(id);

    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);

    if (!fromNode || !toNode) {
      console.warn(`Nodes not found for road ${id}: ${fromId} -> ${toId}`);
      return null;
    }

    const road = new Road(id, fromNode, toNode, lanes, speedLimit);
    this.roads.set(id, road);
    
    fromNode.outgoingRoads.push(id);
    toNode.incomingRoads.push(id);

    return road;
  }

  removeRoad(id) {
    const road = this.roads.get(id);
    if (!road) return;

    // Remove references
    const fromNode = road.fromNode;
    const toNode = road.toNode;

    fromNode.outgoingRoads = fromNode.outgoingRoads.filter(rid => rid !== id);
    toNode.incomingRoads = toNode.incomingRoads.filter(rid => rid !== id);

    this.roads.delete(id);
  }

  removeNode(id) {
    const node = this.nodes.get(id);
    if (!node) return;

    // Remove all associated roads
    const roadsToRemove = [...node.incomingRoads, ...node.outgoingRoads];
    roadsToRemove.forEach(rid => this.removeRoad(rid));

    this.nodes.delete(id);
  }

  clear() {
    this.nodes.clear();
    this.roads.clear();
  }

  getShortestPath(startId, endId, engine = null) {
    if (!this.nodes.has(startId) || !this.nodes.has(endId)) return null;

    const distances = new Map();
    const previous = new Map();
    const queue = new Set();

    for (const [nodeId] of this.nodes) {
      distances.set(nodeId, Infinity);
      queue.add(nodeId);
    }
    distances.set(startId, 0);

    while (queue.size > 0) {
      // Find min distance node in queue
      let minNodeId = null;
      let minDist = Infinity;

      for (const nodeId of queue) {
        const dist = distances.get(nodeId);
        if (dist < minDist) {
          minDist = dist;
          minNodeId = nodeId;
        }
      }

      if (minNodeId === null || minDist === Infinity) break;
      if (minNodeId === endId) break;

      queue.delete(minNodeId);

      const node = this.nodes.get(minNodeId);
      for (const roadId of node.outgoingRoads) {
        const road = this.roads.get(roadId);
        if (!road) continue;

        const neighborId = road.toNode.id;
        if (!queue.has(neighborId)) continue;

        const weight = road.getWeight(engine);
        if (weight === Infinity) continue; // Blocked road

        const newDist = minDist + weight;
        if (newDist < distances.get(neighborId)) {
          distances.set(neighborId, newDist);
          previous.set(neighborId, roadId); // Store road taken to reach
        }
      }
    }

    if (distances.get(endId) === Infinity) return null; // Unreachable

    // Reconstruct path of roads
    const path = [];
    let currentId = endId;
    while (previous.has(currentId)) {
      const roadId = previous.get(currentId);
      path.unshift(roadId);
      const road = this.roads.get(roadId);
      currentId = road.fromNode.id;
    }

    return path;
  }

  // Find the Largest Strongly Connected Component using Tarjan's or Kosaraju's algorithm
  // This cleans up isolated islands from OSM data so vehicles don't get stuck!
  keepOnlyLargestConnectedComponent() {
    if (this.nodes.size === 0) return;

    let index = 0;
    const stack = [];
    const nodeInfo = new Map(); // id -> {index, lowlink, onStack}
    const components = [];

    const strongConnect = (nodeId) => {
      nodeInfo.set(nodeId, { index, lowlink: index, onStack: true });
      index++;
      stack.push(nodeId);

      const node = this.nodes.get(nodeId);
      for (const roadId of node.outgoingRoads) {
        const road = this.roads.get(roadId);
        if (!road) continue;
        const nextId = road.toNode.id;

        if (!nodeInfo.has(nextId)) {
          strongConnect(nextId);
          nodeInfo.get(nodeId).lowlink = Math.min(
            nodeInfo.get(nodeId).lowlink,
            nodeInfo.get(nextId).lowlink
          );
        } else if (nodeInfo.get(nextId).onStack) {
          nodeInfo.get(nodeId).lowlink = Math.min(
            nodeInfo.get(nodeId).lowlink,
            nodeInfo.get(nextId).index
          );
        }
      }

      if (nodeInfo.get(nodeId).lowlink === nodeInfo.get(nodeId).index) {
        const component = [];
        let w;
        do {
          w = stack.pop();
          nodeInfo.get(w).onStack = false;
          component.push(w);
        } while (w !== nodeId);
        components.push(component);
      }
    };

    for (const [nodeId] of this.nodes) {
      if (!nodeInfo.has(nodeId)) {
        strongConnect(nodeId);
      }
    }

    // Find largest component
    if (components.length === 0) return;
    components.sort((a, b) => b.length - a.length);
    const largestComponentSet = new Set(components[0]);

    // Delete nodes not in the largest SCC
    const nodesToDelete = [];
    for (const [nodeId] of this.nodes) {
      if (!largestComponentSet.has(nodeId)) {
        nodesToDelete.push(nodeId);
      }
    }

    nodesToDelete.forEach(nid => this.removeNode(nid));
    console.log(`SCC Cleaned: kept ${this.nodes.size} nodes out of ${this.nodes.size + nodesToDelete.length}`);
  }
}
