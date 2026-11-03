// Core - Main RedundancyExplorer class and initialization

import { EventsMixin } from './events.js';
import { EditorMixin } from './editor.js';
import { Render2DMixin } from './render2d.js';
import { Render3DMixin } from './render3d.js';
import { RedundancyMixin } from './redundancy.js';
import { BehaviorsMixin } from './behaviors.js';
import { OptimizerMixin } from './optimizer.js';
import { PolicyMixin } from './policy.js';

// Redundancy Explorer - Interactive Web Interface
class RedundancyExplorer {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.data = null;
        this.nodes = [];
        this.edges = [];
        this.agents = [];
        this.config = null;
        this.currentGeometry = 'geo/simple_truss.json';
        this.availableGeometries = [];

        // View parameters
        this.scale = 80; // pixels per unit
        this.offsetX = 0;
        this.offsetY = 0;
        this.centerX = 0;
        this.centerY = 0;

        // Interaction state
        this.draggedNode = null;
        this.hoveredNode = null;
        this.isDragging = false;
        this.mousePos = { x: 0, y: 0 };

        // Edit mode state
        this.editMode = false;
        this.selectedNode = null;  // For edge creation
        this.selectedEdge = null;  // For edge property editing
        this.hoveredEdge = null;   // For edge highlighting
        this.topologyModified = false;  // Track if topology has been edited

        // Simulation state
        this.step = 0;
        this.autoStepping = false;
        this.autoStepInterval = null;
        this.stepSpeed = 10;

        // Gradient descent parameters
        this.learningRate = 0.01;
        this.gradientEpsilon = 0.0001;  // 1e-4, matching Python reference

        // Multi-objective weights
        this.redundancyWeight = 1.0;  // Weight for redundancy homogenization
        this.segmentLengthWeight = 0.0;  // Weight for segment length constraint
        this.targetSegmentLength = 1.0;  // Target length for all segments
        this.minMaxSegmentLengthWeight = 0.0;  // Weight for min/max length constraint
        this.minSegmentLength = 0.5;  // Minimum allowed segment length
        this.maxSegmentLength = 2.0;  // Maximum allowed segment length
        this.angleWeight = 0.0;  // Weight for angle constraint
        this.minAngle = 20;  // Minimum allowed angle in degrees
        this.maxAngle = 160;  // Maximum allowed angle in degrees
        this.crossSectionWeight = 0.0;  // Weight for cross-section adaptation
        this.crossSectionGamma = 0.1;   // gamma in EA <- (1 + gamma*r_e) EA

        // Redundancy calculator
        this.redundancyCalculator = null;

        // Display options
        this.showRedundancyLabels = false;
        this.view3D = false;
        this.lightMode = false;
        this.showGrid = true;
        this.colorScaleAuto = false;   // colorbar: fixed [0, scaleMax] vs current [min, max]
        this.showThickness = false;    // element thickness encodes EA / mean(EA)
        this.debugLogging = false;     // gate verbose per-step console output

        // Per-render caches (color scale, mean stiffness) - see refreshRenderCaches()
        this._renderCache = null;

        // r_range history for the sparkline (reset on geometry load)
        this.rangeHistory = [];

        // Editor undo/redo
        this._undoStack = [];
        this._redoStack = [];

        // Bumped on every topology/property edit; invalidates derived caches
        // (triangular faces, GNN graph cache)
        this._topologyVersion = 0;

        // Angle violation tracking
        this.violatedAngles = [];
        this.angleFlashTime = 0;

        // Learned policy integration
        this.policy = null;
        this.usePolicyMode = false;
        this.policyLoaded = false;
        this.policyStepSize = 0.05;

        // GNN policy path (topology-agnostic, works on any geometry)
        this.gnnPolicyPath = 'policy_learning/models/gnn_multi_bc_actor.onnx';

        // Per-geometry GNN overrides: specialized policies preferred over
        // the shared multi-geometry model. loadPolicy falls back to
        // gnnPolicyPath when an override fails to load (e.g. not trained
        // or not deployed yet), so listing a future model here is safe.
        this.gnnPolicyOverrides = {
            // Large-frame crossover demo
            'geo/frame_12b_9s.json': 'policy_learning/models/gnn_frame12b9s_actor.onnx',
        };
        this.currentPolicyPath = null;

        // 3D rendering objects
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.labelRenderer = null;
        this.controls = null;
        this.nodeMeshes = [];
        this.edgeMeshes = [];
        this.edgeLabels = [];
        this.raycaster = null;
        this.mouse = null;
        this.animationFrameId = null;
        this.colorbarCanvas = null;

        this.init();
    }

    async init() {
        await this.loadAvailableGeometries();
        await this.loadData();
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();  // Calculate initial redundancy values
        this.setupCanvas();
        this.setupEventListeners();
        this.populateGeometrySelector();
        this.updateUI();
        this.render();

        // Try to load the learned policy
        this.loadPolicy();
    }

    async loadAvailableGeometries() {
        try {
            // Fetch the list of JSON files in the geometries folder
            const response = await fetch('geo/');
            const text = await response.text();

            // Parse directory listing to find JSON files
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const links = doc.querySelectorAll('a');

            this.availableGeometries = [];
            links.forEach(link => {
                const href = link.getAttribute('href');
                if (href && href.endsWith('.json')) {
                    this.availableGeometries.push(href);
                }
            });

            // Fallback if directory listing doesn't work
            if (this.availableGeometries.length === 0) {
                this.availableGeometries = [
                    'simple_truss.json',
                    'three_bay_frame.json',
                    'three_bay_frame_all_moveable.json',
                    'multi_story_frame.json',
                    'fan_truss_asym.json',
                    'xtruss_asym_wedge.json',
                    'ktruss.json',
                    'baltimore_truss.json',
                    'buga_beam.json',
                    'frame_12b_9s.json'
                ];
            }

            if (this.debugLogging) console.log('Available geometries:', this.availableGeometries);
        } catch (error) {
            console.error('Failed to load available geometries:', error);
            this.availableGeometries = [
                'simple_truss.json',
                'three_bay_frame.json',
                'three_bay_frame_all_moveable.json',
                'multi_story_frame.json',
                'fan_truss_asym.json',
                'xtruss_asym_wedge.json',
                'ktruss.json',
                'baltimore_truss.json',
                'buga_beam.json',
                'frame_12b_9s.json'
            ];
        }
    }

    formatGeometryName(filename) {
        // Remove .json extension
        let name = filename.replace('.json', '');

        // Replace underscores with spaces
        name = name.replace(/_/g, ' ');

        // Capitalize first letter of each word
        name = name.split(' ').map(word =>
            word.charAt(0).toUpperCase() + word.slice(1)
        ).join(' ');

        return name;
    }

    populateGeometrySelector() {
        const selector = document.getElementById('geometry-selector');
        selector.innerHTML = '';

        this.availableGeometries.forEach(filename => {
            const option = document.createElement('option');
            option.value = `geo/${filename}`;

            // Format the name
            let displayName = this.formatGeometryName(filename);

            // Add "(Default)" suffix to simple_truss.json
            if (filename === 'simple_truss.json') {
                displayName += ' (Default)';
            }

            option.textContent = displayName;

            // Select the current geometry
            if (option.value === this.currentGeometry) {
                option.selected = true;
            }

            selector.appendChild(option);
        });
    }

    async loadData(filename = null) {
        try {
            const file = filename || this.currentGeometry;
            const response = await fetch(file);
            this.data = await response.json();

            // Deep copy nodes for manipulation
            this.nodes = this.data.nodes.map(n => ({...n}));
            this.edges = this.data.edges.map(e => ({...e}));
            this.agents = this.data.agents ? this.data.agents.map(a => ({...a})) : [];
            this.config = this.data.config || {};

            if (this.debugLogging) console.log('Loaded truss data:', this.data);
        } catch (error) {
            console.error('Failed to load truss data:', error);
        }
    }

    setupCanvas() {
        const resize = () => {
            const container = this.canvas.parentElement;
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;

            // Center the view
            this.centerX = this.canvas.width / 2;
            this.centerY = this.canvas.height / 2;

            // Center the structure. Large opt-in geometries (config.auto_fit,
            // e.g. BUGA) also auto-scale to fit; others keep their fixed zoom.
            if (this.nodes.length > 0) {
                if (this.config && this.config.auto_fit) {
                    this.fitView2D();
                } else {
                    const avgX = this.nodes.reduce((sum, n) => sum + n.x, 0) / this.nodes.length;
                    const avgY = this.nodes.reduce((sum, n) => sum + n.y, 0) / this.nodes.length;
                    this.offsetX = -avgX;
                    this.offsetY = -avgY;
                }
            }

            // Update 3D renderer size if active
            if (this.view3D && this.renderer && this.camera) {
                this.renderer.setSize(container.clientWidth, container.clientHeight);
                this.camera.aspect = container.clientWidth / container.clientHeight;
                this.camera.updateProjectionMatrix();

                if (this.labelRenderer) {
                    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
                }
            }

            this.render();
        };

        resize();
        window.addEventListener('resize', resize);
    }

    updateUI() {
        document.getElementById('node-count').textContent = this.nodes.length;
        document.getElementById('edge-count').textContent = this.edges.length;
    }

    async switchGeometry(filename) {
        // Load new geometry
        this.currentGeometry = filename;
        await this.loadData(filename);
        await this.finishGeometryLoad();
    }

    // Shared post-load path for the geometry picker and JSON import.
    async finishGeometryLoad() {
        // Stop auto-stepping if active
        if (this.autoStepping) {
            this.stopAutoStep();
        }

        // Clear edit mode state
        this.selectedNode = null;
        this.hoveredEdge = null;
        this.topologyModified = false;
        this.hideNodeBCPopup();
        this.hideEdgePopup();

        // Fresh structure: clear histories and caches
        this.rangeHistory = [];
        this._undoStack = [];
        this._redoStack = [];
        this._topologyVersion++;

        // Re-enable policy button (loadPolicy will set availability)
        const policyBtn = document.getElementById('policy-toggle-btn');
        policyBtn.disabled = false;
        policyBtn.title = 'Toggle between gradient heuristic and learned policy';

        // Reinitialize redundancy calculator
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues(true);  // Calculate target on initial load

        // Load the appropriate policy for this geometry (or show unavailable)
        await this.loadPolicy();

        // Reset view
        this.setupCanvas();

        // Reset simulation state
        this.step = 0;
        document.getElementById('step-count').textContent = this.step;

        // Rebuild 3D scene if in 3D mode
        if (this.view3D && this.scene) {
            this.build3DScene();
            this.frameCamera();
        }

        // Update UI
        this.updateUI();
        this.updateRangeHistoryPlot();
        this.render();
    }

    exportGeometry() {
        // Serialize the current structure in the geo/*.json schema so the
        // exported file can be re-imported (or committed to geo/).
        const nodes = this.nodes.map(n => {
            const { ...out } = n;
            return out;
        });
        const edges = this.edges.map(e => {
            const { redundancy, ...out } = e;  // redundancy is derived state
            return out;
        });
        const data = { nodes, edges, config: this.config || {} };
        if (this.data && this.data.agents) data.agents = this.data.agents;

        const base = this.currentGeometry
            .split('/').pop().replace('.json', '') || 'structure';
        const blob = new Blob(
            [JSON.stringify(data, null, 2)], { type: 'application/json' }
        );
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${base}_edited.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        if (this.debugLogging) console.log(`Exported geometry (${nodes.length} nodes, ${edges.length} edges)`);
    }

    async importGeometryFile(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)
                || data.nodes.length < 2 || data.edges.length < 1) {
                throw new Error('JSON must contain nodes[] (>=2) and edges[] (>=1)');
            }

            this.data = data;
            this.nodes = data.nodes.map(n => ({ ...n }));
            this.edges = data.edges.map(e => ({ ...e }));
            this.agents = data.agents ? data.agents.map(a => ({ ...a })) : [];
            this.config = data.config || {};
            this.currentGeometry = `imported:${file.name}`;

            await this.finishGeometryLoad();
            if (this.debugLogging) console.log(`Imported geometry from ${file.name}`);
        } catch (err) {
            console.error('Geometry import failed:', err);
            alert(`Could not import geometry: ${err.message}`);
        }
    }

    reset() {
        // Reset to original positions and topology
        this.nodes = this.data.nodes.map(n => ({...n}));
        this.edges = this.data.edges.map(e => ({...e}));
        this.step = 0;
        document.getElementById('step-count').textContent = this.step;

        // Clear edit mode state and histories
        this.selectedNode = null;
        this.hoveredEdge = null;
        this.topologyModified = false;
        this.rangeHistory = [];
        this._undoStack = [];
        this._redoStack = [];
        this._topologyVersion++;
        this.updateRangeHistoryPlot();
        this.hideNodeBCPopup();
        this.hideEdgePopup();

        // Reinitialize calculator (topology may have changed)
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();

        // Restore sidebar policy status and re-init GNN cache
        const statusEl = document.getElementById('policy-status');
        if (this.policyLoaded && this.policy) {
            this._initGNNGraphCache();
        } else {
            statusEl.className = 'policy-status unavailable';
            statusEl.textContent = 'No policy for this geometry';
        }
        this.updateUI();

        // Rebuild 3D scene if in 3D mode
        if (this.view3D && this.scene) {
            this.build3DScene();
            this.frameCamera();
        }

        this.render();
    }
}

// Merge all mixins into the prototype
Object.assign(RedundancyExplorer.prototype,
    EventsMixin,
    EditorMixin,
    Render2DMixin,
    Render3DMixin,
    RedundancyMixin,
    BehaviorsMixin,
    OptimizerMixin,
    PolicyMixin
);

// Initialize visualizer when page loads
window.addEventListener('DOMContentLoaded', () => {
    new RedundancyExplorer();
});
