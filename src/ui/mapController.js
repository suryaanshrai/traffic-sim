import L from 'leaflet';

export class MapController {
  constructor(containerId, graph, engine, onSelectionChange) {
    this.containerId = containerId;
    this.graph = graph;
    this.engine = engine;
    this.onSelectionChange = onSelectionChange; // Callback when bbox is ready
    
    this.map = null;
    this.bboxRectangle = null;
    this.isDrawingBox = false;
    
    // Draw box coordinates
    this.startLatLng = null;
    this.endLatLng = null;
    this.bbox = null; // { south, west, north, east }
    
    // Preset coordinates
    this.presets = {
      'Arc de Triomphe': { lat: 48.8738, lng: 2.2950, zoom: 16 },
      'Times Square': { lat: 40.7580, lng: -73.9855, zoom: 16 },
      'Shibuya Crossing': { lat: 35.6595, lng: 139.7005, zoom: 16 }
    };

    // Bind touch event handlers for mobile box drawing
    this.onTouchStartBound = this.onTouchStart.bind(this);
    this.onTouchMoveBound = this.onTouchMove.bind(this);
    this.onTouchEndBound = this.onTouchEnd.bind(this);

    this.initMap();
  }

  initMap() {
    // Initialize leaflet map at Shibuya Crossing
    this.map = L.map(this.containerId, {
      zoomControl: true,
      attributionControl: true
    }).setView([35.6595, 139.7005], 16);

    // CartoDB Dark Matter tiles - Sleek cyberpunk look
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(this.map);

    // Sync canvas when map pans or zooms
    this.map.on('move', () => this.syncCanvasCoordinates());
    this.map.on('zoom', () => this.syncCanvasCoordinates());
    this.map.on('viewreset', () => this.syncCanvasCoordinates());

    // Hook map click to forward projected container coordinates to builder
    this.map.on('click', (e) => {
      if (this.isDrawingBox) return;
      const pt = this.map.latLngToContainerPoint(e.latlng);
      if (this.builder) {
        this.builder.handleManualClick(pt.x, pt.y);
      }
    });
  }

  show() {
    document.getElementById(this.containerId).style.opacity = '1';
    document.getElementById(this.containerId).style.pointerEvents = 'auto';
    this.map.invalidateSize();
    this.syncCanvasCoordinates();
  }

  hide() {
    document.getElementById(this.containerId).style.opacity = '0';
    document.getElementById(this.containerId).style.pointerEvents = 'none';
  }

  gotoPreset(presetName) {
    const coords = this.presets[presetName];
    if (coords) {
      this.map.setView([coords.lat, coords.lng], coords.zoom);
      
      // Auto create a bounding box around the preset area to make it easy for user
      const center = L.latLng(coords.lat, coords.lng);
      // Create a bounds around center (~300m radius)
      const bounds = center.toBounds(600); // 600 meters wide box
      
      if (this.bboxRectangle) {
        this.map.removeLayer(this.bboxRectangle);
      }
      
      this.bboxRectangle = L.rectangle(bounds, {
        color: '#ff007f', // Neon pink
        weight: 2,
        fillColor: '#ff007f',
        fillOpacity: 0.08,
        dashArray: '5, 5'
      }).addTo(this.map);

      this.bbox = {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast()
      };

      if (this.onSelectionChange) {
        this.onSelectionChange(this.bbox);
      }
    }
  }

  enableBoxDrawing() {
    this.isDrawingBox = true;
    this.map.dragging.disable();
    this.map.scrollWheelZoom.disable();
    this.map.doubleClickZoom.disable();
    this.map.boxZoom.disable();
    
    // Change cursor
    this.map.getContainer().style.cursor = 'crosshair';

    // Hook events
    this.map.on('mousedown', this.onMouseDown, this);
    
    // Touch support for mobile box drawing
    this.map.getContainer().addEventListener('touchstart', this.onTouchStartBound, { passive: false });
  }

  disableBoxDrawing() {
    this.isDrawingBox = false;
    this.map.dragging.enable();
    this.map.scrollWheelZoom.enable();
    this.map.doubleClickZoom.enable();
    this.map.boxZoom.enable();
    this.map.getContainer().style.cursor = '';
    
    this.map.off('mousedown', this.onMouseDown, this);
    this.map.off('mousemove', this.onMouseMove, this);
    this.map.off('mouseup', this.onMouseUp, this);
    
    // Clean up touch support
    const container = this.map.getContainer();
    container.removeEventListener('touchstart', this.onTouchStartBound);
    container.removeEventListener('touchmove', this.onTouchMoveBound);
    container.removeEventListener('touchend', this.onTouchEndBound);
  }

  onTouchStart(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = this.map.getContainer().getBoundingClientRect();
    const pt = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
    const latlng = this.map.containerPointToLatLng(pt);
    
    this.onMouseDown({ latlng });
    
    const container = this.map.getContainer();
    container.addEventListener('touchmove', this.onTouchMoveBound, { passive: false });
    container.addEventListener('touchend', this.onTouchEndBound);
    
    e.preventDefault();
  }

  onTouchMove(e) {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect = this.map.getContainer().getBoundingClientRect();
    const pt = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
    const latlng = this.map.containerPointToLatLng(pt);
    
    this.onMouseMove({ latlng });
    
    e.preventDefault();
  }

  onTouchEnd(e) {
    const latlng = this.endLatLng || this.startLatLng;
    this.onMouseUp({ latlng });
  }

  onMouseDown(e) {
    this.startLatLng = e.latlng;
    
    if (this.bboxRectangle) {
      this.map.removeLayer(this.bboxRectangle);
    }
    
    this.bboxRectangle = L.rectangle([this.startLatLng, this.startLatLng], {
      color: '#ff007f',
      weight: 2,
      fillColor: '#ff007f',
      fillOpacity: 0.08,
      dashArray: '5, 5'
    }).addTo(this.map);

    this.map.on('mousemove', this.onMouseMove, this);
    this.map.on('mouseup', this.onMouseUp, this);
  }

  onMouseMove(e) {
    if (!this.startLatLng) return;
    this.endLatLng = e.latlng;
    
    const bounds = L.latLngBounds(this.startLatLng, this.endLatLng);
    this.bboxRectangle.setBounds(bounds);
  }

  onMouseUp(e) {
    if (!this.startLatLng) return;
    this.endLatLng = e.latlng;
    
    const bounds = L.latLngBounds(this.startLatLng, this.endLatLng);
    
    this.bbox = {
      south: bounds.getSouth(),
      west: bounds.getWest(),
      north: bounds.getNorth(),
      east: bounds.getEast()
    };

    this.disableBoxDrawing();
    
    if (this.onSelectionChange) {
      this.onSelectionChange(this.bbox);
    }

    this.startLatLng = null;
  }

  async importOSMNetwork() {
    if (!this.bbox) return false;
    
    const { south, west, north, east } = this.bbox;
    
    // Overpass API Query
    // We fetch drivable highway ways and nodes within bounding box
    const query = `
      [out:json][timeout:25];
      (
        way["highway"~"motorway|trunk|primary|secondary|tertiary|residential"](${south},${west},${north},${east});
      );
      out body;
      >;
      out skel qt;
    `;

    try {
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query
      });

      if (!response.ok) {
        throw new Error(`Overpass API error: ${response.statusText}`);
      }

      const data = await response.json();
      this.parseOSMData(data);
      
      // Remove bbox drawing after success
      if (this.bboxRectangle) {
        this.map.removeLayer(this.bboxRectangle);
        this.bboxRectangle = null;
      }
      this.bbox = null;
      
      return true;
    } catch (err) {
      console.error('Failed to fetch OSM network:', err);
      alert('Error fetching map data. The Overpass server might be busy or your selection area is too large. Try a smaller box or select a preset.');
      return false;
    }
  }

  parseOSMData(osmJson) {
    this.engine.pause();
    this.graph.clear();

    const nodesMap = new Map(); // id -> {lat, lon}
    const waysList = [];

    // Separate nodes and ways
    osmJson.elements.forEach(el => {
      if (el.type === 'node') {
        nodesMap.set(el.id, { lat: el.lat, lon: el.lon });
      } else if (el.type === 'way') {
        waysList.push(el);
      }
    });

    // Count how many times each node ID is referenced across all ways
    const nodeReferenceCounts = new Map();
    waysList.forEach(way => {
      way.nodes.forEach(nodeId => {
        nodeReferenceCounts.set(nodeId, (nodeReferenceCounts.get(nodeId) || 0) + 1);
      });
    });

    // A node is a "key node" (kept in graph) if it's the start, end, or shared by multiple ways
    const keyNodesSet = new Set();
    waysList.forEach(way => {
      way.nodes.forEach((nodeId, idx) => {
        const count = nodeReferenceCounts.get(nodeId) || 0;
        if (idx === 0 || idx === way.nodes.length - 1 || count > 1) {
          keyNodesSet.add(nodeId);
        }
      });
    });

    // Populate graph nodes (only key nodes!)
    for (const [id, coords] of nodesMap) {
      if (keyNodesSet.has(id)) {
        const pixelPt = this.map.latLngToContainerPoint([coords.lat, coords.lon]);
        this.graph.addNode(id.toString(), pixelPt.x, pixelPt.y, coords.lat, coords.lon);
      }
    }

    // Populate graph roads from ways by collapsing intermediate non-key nodes
    waysList.forEach((way, wayIdx) => {
      const wayNodes = way.nodes;
      const highwayType = way.tags.highway;
      
      // Determine lanes based on highway type and tags
      let lanes = 2;
      if (way.tags.lanes) {
        lanes = parseInt(way.tags.lanes) || 2;
      } else {
        if (highwayType === 'motorway' || highwayType === 'trunk') lanes = 3;
        else if (highwayType === 'primary') lanes = 2;
        else lanes = 1;
      }

      // Determine speed limit
      let speedLimit = 60;
      if (way.tags.maxspeed) {
        speedLimit = parseInt(way.tags.maxspeed) || 60;
      } else {
        if (highwayType === 'motorway' || highwayType === 'trunk') speedLimit = 100;
        else if (highwayType === 'primary') speedLimit = 70;
        else if (highwayType === 'secondary') speedLimit = 50;
        else speedLimit = 40;
      }

      const speedScale = speedLimit * 1.5;
      
      let lastKeyNodeIndex = 0;
      
      for (let i = 1; i < wayNodes.length; i++) {
        const nodeId = wayNodes[i];
        const isIntersection = (nodeReferenceCounts.get(nodeId) || 0) > 1;
        const isEnd = i === wayNodes.length - 1;

        if (isIntersection || isEnd) {
          const fromId = wayNodes[lastKeyNodeIndex].toString();
          const toId = nodeId.toString();
          
          // Verify both nodes exist in the graph (were added as key nodes)
          if (this.graph.nodes.has(fromId) && this.graph.nodes.has(toId)) {
            const roadId = `osm_road_${way.id}_${lastKeyNodeIndex}_${i}`;
            const isOneWay = way.tags.oneway === 'yes' || highwayType === 'motorway';
            
            this.graph.addRoad(roadId, fromId, toId, lanes, speedScale);
            
            if (!isOneWay) {
              const revRoadId = `${roadId}_rev`;
              this.graph.addRoad(revRoadId, toId, fromId, lanes, speedScale);
            }
          }
          lastKeyNodeIndex = i;
        }
      }
    });

    // Clean up graph to keep only the largest strongly connected component
    this.graph.keepOnlyLargestConnectedComponent();

    // Re-initialize traffic lights
    if (this.onNetworkLoaded) {
      this.onNetworkLoaded();
    } else {
      this.engine.reset();
      this.engine.start();
    }
  }

  // Adjust nodes' screen pixel coordinates when map pans/zooms
  syncCanvasCoordinates() {
    if (this.graph.nodes.size === 0) return;

    // Cache old road lengths to scale vehicle positions
    const oldLengths = new Map();
    for (const [id, road] of this.graph.roads) {
      oldLengths.set(id, road.length);
    }

    // Re-project every node
    for (const [id, node] of this.graph.nodes) {
      if (node.lat !== null && node.lng !== null) {
        const pixelPt = this.map.latLngToContainerPoint([node.lat, node.lng]);
        node.x = pixelPt.x;
        node.y = pixelPt.y;
      }
    }

    // Recalculate road lengths
    for (const [id, road] of this.graph.roads) {
      road.length = road.calculateLength();
    }

    // Scale vehicle positions to avoid warping/disappearing
    for (const [_, vehicle] of this.engine.vehicles) {
      const roadId = vehicle.currentRoad.id;
      const oldLen = oldLengths.get(roadId);
      const newLen = vehicle.currentRoad.length;
      if (oldLen && newLen) {
        vehicle.position *= (newLen / oldLen);
      }
    }
  }

  searchLocation(query) {
    if (!query) return;
    
    // Geocode via Nominatim OSM
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`)
      .then(res => res.json())
      .then(data => {
        if (data && data.length > 0) {
          const result = data[0];
          this.map.setView([parseFloat(result.lat), parseFloat(result.lon)], 16);
        } else {
          alert('Location not found. Try another search terms.');
        }
      })
      .catch(err => {
        console.error('Geocoding error:', err);
        alert('Search service unavailable. Try preset cities.');
      });
  }
}
