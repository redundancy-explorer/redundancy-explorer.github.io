// Policy - Learned policy loading and inference
// Topology-agnostic GNN policy (ONNX), shared across geometries

export const PolicyMixin = {
    async loadPolicy() {
        const statusEl = document.getElementById('policy-status');
        const toggleBtn = document.getElementById('policy-toggle-btn');

        // Check if the GNN inference script is available
        if (typeof TrussPolicyGNN === 'undefined') {
            console.warn('TrussPolicyGNN class not available - gnn_policy_inference.js may not be loaded');
            statusEl.className = 'policy-status unavailable';
            statusEl.textContent = 'Learned Policy: Script not loaded';
            toggleBtn.disabled = true;
            return;
        }

        // Per-geometry GNN override, else the shared multi-geometry GNN
        const gnnOverride = this.gnnPolicyOverrides
            && this.gnnPolicyOverrides[this.currentGeometry];
        const gnnPath = gnnOverride || this.gnnPolicyPath;

        // If the same model is already loaded, only re-init the graph cache
        // (the graph structure changes with the geometry)
        if (this.policyLoaded && this.currentPolicyPath === gnnPath) {
            if (this.debugLogging) console.log(`GNN policy already loaded, re-initializing graph cache for ${this.currentGeometry}`);
            this._initGNNGraphCache();
            return;
        }

        statusEl.className = 'policy-status loading';
        statusEl.textContent = 'Learned Policy: Loading...';

        let loadedGnnPath = gnnPath;
        try {
            // A missing per-geometry override falls back to the shared model
            if (this.debugLogging) console.log(`Loading GNN policy from ${gnnPath}`);
            try {
                this.policy = await TrussPolicyGNN.load(gnnPath);
            } catch (err) {
                if (gnnOverride && gnnPath !== this.gnnPolicyPath) {
                    console.warn(
                        `Override policy unavailable (${err.message}); ` +
                        `falling back to shared GNN ${this.gnnPolicyPath}`
                    );
                    loadedGnnPath = this.gnnPolicyPath;
                    this.policy = await TrussPolicyGNN.load(loadedGnnPath);
                } else {
                    throw err;
                }
            }

            this.policyLoaded = true;
            this.currentPolicyPath = loadedGnnPath;
            if (this.debugLogging) console.log('Loaded policy:', this.policy.getInfo());

            toggleBtn.disabled = false;
            this._initGNNGraphCache();

            // Auto-enable policy mode for multi-story frame
            if (this.currentGeometry === 'geo/multi_story_frame.json' && !this.usePolicyMode) {
                this.usePolicyMode = true;
                toggleBtn.textContent = 'Policy';
                toggleBtn.classList.add('policy-mode');
            }

        } catch (error) {
            console.error('Failed to load policy:', error);
            this.policyLoaded = false;
            this.policy = null;
            this.currentPolicyPath = null;
            statusEl.className = 'policy-status error';
            statusEl.textContent = 'Learned Policy: Load failed';
            toggleBtn.disabled = true;

            if (this.usePolicyMode) {
                this.usePolicyMode = false;
                toggleBtn.textContent = 'Gradient';
                toggleBtn.classList.remove('policy-mode');
            }
        }
    },

    // =========================================================================
    // GNN Graph Cache - Pre-compute static graph structure
    // =========================================================================

    refreshPolicyAfterTopologyEdit() {
        // The GNN policy is topology-agnostic (shared parameters across
        // arbitrary graphs): rebuild the graph cache so inference sees the
        // edited topology / boundary conditions / stiffnesses. Must run AFTER
        // updateRedundancyValues(), because the cache's target redundancy is
        // the mean of the current per-element values.
        if (this.policyLoaded && this.policy) {
            this._initGNNGraphCache();
        }
    },

    _initGNNGraphCache() {
        // Pre-compute static graph structure for GNN inference.
        // Called on geometry change and after every topology/property edit.

        const numNodes = this.nodes.length;
        const numEdges = this.edges.length;

        // Build bidirectional edges: each undirected edge -> 2 directed edges
        const senders = [];
        const receivers = [];
        const edgeElementIdx = [];  // maps directed edge -> element index

        for (let elemIdx = 0; elemIdx < numEdges; elemIdx++) {
            const e = this.edges[elemIdx];
            // Forward: source -> target
            senders.push(e.source);
            receivers.push(e.target);
            edgeElementIdx.push(elemIdx);
            // Reverse: target -> source
            senders.push(e.target);
            receivers.push(e.source);
            edgeElementIdx.push(elemIdx);
        }

        const numDirectedEdges = senders.length;

        // Moveable indices: nodes where fixed === false
        const moveableIndices = [];
        for (let i = 0; i < numNodes; i++) {
            if (!this.nodes[i].fixed) {
                moveableIndices.push(i);
            }
        }

        // Static node features: [bc_x, bc_y, is_fixed]
        // bc_x, bc_y: 1 if DOF is constrained, 0 if free (from dirichlet_bc)
        // is_fixed: 1 if node.fixed, 0 otherwise
        // Note: in training, is_fixed was always 0 because the simple_truss
        // and three_bay_frame_all_moveable have no fixed nodes. But bc_x/bc_y
        // still distinguish between support nodes and free nodes.
        const staticNodeFeatures = new Float32Array(numNodes * 3);
        for (let i = 0; i < numNodes; i++) {
            const node = this.nodes[i];
            const bc = node.dirichlet_bc || (node.fixed ? [1, 1, 1] : [0, 0, 1]);
            staticNodeFeatures[i * 3 + 0] = bc[0];  // bc_x
            staticNodeFeatures[i * 3 + 1] = bc[1];  // bc_y
            staticNodeFeatures[i * 3 + 2] = node.fixed ? 1.0 : 0.0;  // is_fixed
        }

        // Stiffness ratio per element (static, computed once)
        const stiffnesses = this.edges.map(e => e.stiffness || 1.0);
        const meanStiffness = stiffnesses.reduce((a, b) => a + b, 0) / stiffnesses.length;
        const stiffnessRatio = stiffnesses.map(s => s / meanStiffness);

        // Target redundancy = mean of initial redundancies
        const initialRedundancies = this.edges.map(e => e.redundancy);
        const targetRedundancy = initialRedundancies.reduce((a, b) => a + b, 0) / initialRedundancies.length;

        // Store cache
        this._gnnCache = {
            numNodes,
            numDirectedEdges,
            numMoveable: moveableIndices.length,
            senders,
            receivers,
            edgeElementIdx,
            moveableIndices,
            staticNodeFeatures,
            stiffnessRatio,
            targetRedundancy,
        };

        const statusEl = document.getElementById('policy-status');
        const info = this.policy.getInfo();
        statusEl.className = 'policy-status ready';
        statusEl.textContent = `GNN Ready (${numNodes}n, ${numEdges}e)`;

        const toggleBtn = document.getElementById('policy-toggle-btn');
        toggleBtn.disabled = false;

        if (this.debugLogging) console.log(`[GNN] Graph cache initialized: ${numNodes} nodes, ${numEdges} elements, ` +
            `${numDirectedEdges} directed edges, ${moveableIndices.length} moveable, ` +
            `target_r=${targetRedundancy.toFixed(4)}`);
    },

    // =========================================================================
    // GNN Observation Builder - Build graph features each step
    // =========================================================================

    _buildGNNObservation() {
        // Build the graph observation for GNN inference.
        // Node features are static (from cache).
        // Edge features are dynamic (depend on current positions + redundancies).

        const cache = this._gnnCache;
        const numDE = cache.numDirectedEdges;

        // Edge features: [redundancy_deviation, stiffness_ratio, rel_dx, rel_dy, length]
        const edgeFeatures = new Float32Array(numDE * 5);

        // Current redundancy values per element
        const redundancies = this.edges.map(e => e.redundancy);

        for (let de = 0; de < numDE; de++) {
            const elemIdx = cache.edgeElementIdx[de];
            const src = cache.senders[de];
            const dst = cache.receivers[de];

            const srcNode = this.nodes[src];
            const dstNode = this.nodes[dst];

            // Relative position: receiver - sender (matching training)
            const relDx = dstNode.x - srcNode.x;
            const relDy = dstNode.y - srcNode.y;
            const length = Math.sqrt(relDx * relDx + relDy * relDy + 1e-12);

            // Redundancy deviation from target
            const rDev = redundancies[elemIdx] - cache.targetRedundancy;

            const offset = de * 5;
            edgeFeatures[offset + 0] = rDev;
            edgeFeatures[offset + 1] = cache.stiffnessRatio[elemIdx];
            edgeFeatures[offset + 2] = relDx;
            edgeFeatures[offset + 3] = relDy;
            edgeFeatures[offset + 4] = length;
        }

        return {
            nodeFeatures: cache.staticNodeFeatures,
            edgeFeatures,
            senders: cache.senders,
            receivers: cache.receivers,
            moveableIndices: cache.moveableIndices,
            numNodes: cache.numNodes,
            numDirectedEdges: numDE,
            numMoveable: cache.numMoveable,
        };
    },

    // =========================================================================
    // Toggle & Step
    // =========================================================================

    togglePolicyMode() {
        if (!this.policyLoaded) {
            console.warn('Policy not loaded, cannot toggle');
            return;
        }

        this.usePolicyMode = !this.usePolicyMode;

        const toggleBtn = document.getElementById('policy-toggle-btn');
        if (this.usePolicyMode) {
            toggleBtn.textContent = 'Policy';
            toggleBtn.classList.add('policy-mode');
        } else {
            toggleBtn.textContent = 'Gradient';
            toggleBtn.classList.remove('policy-mode');
        }

        if (this.debugLogging) console.log(`Optimization mode: ${this.usePolicyMode ? 'Learned Policy' : 'Gradient Heuristic'}`);
    },

    async policyStep() {
        if (!this.usePolicyMode) {
            console.warn('Policy mode not available, falling back to gradient');
            this.gradientDescentStep();
            return;
        }

        await this._gnnPolicyStep();
    },

    // =========================================================================
    // GNN Policy Step
    // =========================================================================

    async _gnnPolicyStep() {
        if (!this.policy || !this._gnnCache) {
            console.warn('GNN policy not ready, falling back to gradient');
            this.gradientDescentStep();
            return;
        }

        // Get current redundancy range
        const initialRange = this.calculateRedundancyRange();

        // Save positions for rollback
        const savedPositions = this.nodes.map(n => ({ x: n.x, y: n.y, z: n.z }));

        // Build graph observation
        const obs = this._buildGNNObservation();

        // Run GNN inference (async ONNX)
        const actions = await this.policy.predict(
            obs.nodeFeatures,
            obs.edgeFeatures,
            obs.senders,
            obs.receivers,
            obs.moveableIndices,
            obs.numNodes,
            obs.numDirectedEdges,
            obs.numMoveable,
        );

        // Apply actions to moveable nodes.
        // GNN output is (numMoveable, actionDim) flattened. The action
        // convention comes from the model's metadata sidecar:
        //   "unit_step"    - output is a unit direction field (normalization
        //                    baked into the ONNX graph); step length is
        //                    policyStepSize.
        //   "raw_gradient" - output is the raw (standardized) gradient with
        //                    magnitude signal; the env-convention displacement
        //                    is policyStepSize * action, so the step length
        //                    anneals with the predicted magnitude.
        // Both conventions therefore scale by policyStepSize; the branch
        // exists so the assumption is explicit and logged.
        const convention = (this.policy.getInfo
            && this.policy.getInfo().actionConvention) || 'unit_step';
        const actionDim = (this.policy.getInfo
            && this.policy.getInfo().actionDim) || 2;
        const moveableIndices = this._gnnCache.moveableIndices;
        for (let i = 0; i < moveableIndices.length; i++) {
            const nodeIdx = moveableIndices[i];
            this.nodes[nodeIdx].x += actions[i * actionDim + 0] * this.policyStepSize;
            this.nodes[nodeIdx].y += actions[i * actionDim + 1] * this.policyStepSize;
            if (actionDim >= 3) {
                this.nodes[nodeIdx].z += actions[i * actionDim + 2] * this.policyStepSize;
            }
        }
        if (this.debugLogging) {
            console.log(`[GNN] applied ${convention} actions (dim ${actionDim})`);
        }

        // Update redundancy values
        this.updateRedundancyValues();

        const policyRange = this.calculateRedundancyRange();

        // Check if policy improved
        if (policyRange < initialRange) {
            if (this.debugLogging) console.log(`[GNN] Step ${this.step + 1}: r_range ${initialRange.toFixed(6)} -> ${policyRange.toFixed(6)} (improved)`);
        } else {
            // Revert and fall back to gradient
            if (this.debugLogging) console.log(`[GNN] Step ${this.step + 1}: r_range ${initialRange.toFixed(6)} -> ${policyRange.toFixed(6)} (no improvement, reverting)`);

            for (let i = 0; i < this.nodes.length; i++) {
                this.nodes[i].x = savedPositions[i].x;
                this.nodes[i].y = savedPositions[i].y;
                this.nodes[i].z = savedPositions[i].z;
            }
            this.updateRedundancyValues();
            this.gradientDescentStep();
        }
    }
};
