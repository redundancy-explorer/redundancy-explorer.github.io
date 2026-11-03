// Redundancy - Redundancy calculation and metrics

export const RedundancyMixin = {
    initializeRedundancyCalculator() {
        // Prepare node positions as array
        const nodePositions = this.nodes.map(n => [n.x, n.y, n.z]);

        // Prepare topology from edges (array of [source, target] pairs)
        const topology = this.edges.map(e => [e.source, e.target]);

        const isBeam = this.config && this.config.type === 'beam';

        // Hot path: the cross-section behavior re-initializes the calculator
        // every optimization step, so keep this quiet unless debugging.
        if (this.debugLogging) {
            console.log('Initializing redundancy calculator...');
            console.log('Structure type:', isBeam ? 'beam (6 DOF/node)' : 'truss (3 DOF/node)');
            console.log('Nodes:', nodePositions.length);
            console.log('Topology:', topology.length);
        }

        if (isBeam) {
            // Beam: 6-component Dirichlet BC and four per-element stiffnesses.
            const dirichletBC = this.nodes.map(n =>
                (n.dirichlet_bc && n.dirichlet_bc.length === 6)
                    ? n.dirichlet_bc
                    : (n.fixed ? [1, 1, 1, 1, 1, 1] : [0, 0, 0, 0, 0, 0])
            );
            const EA = this.edges.map(e => e.EA != null ? e.EA : e.stiffness);
            const EIy = this.edges.map(e => e.EIy);
            const EIz = this.edges.map(e => e.EIz);
            const GJ = this.edges.map(e => e.GJ);

            this.redundancyCalculator = new RedundancyMatrixBeam(
                nodePositions, topology, dirichletBC, EA, EIy, EIz, GJ
            );
            if (this.debugLogging) console.log('Using beam redundancy calculation (JavaScript)');
            return;
        }

        // Truss: 3-component Dirichlet BC and axial stiffness only.
        const dirichletBC = this.nodes.map(n =>
            n.dirichlet_bc ? n.dirichlet_bc : (n.fixed ? [1, 1, 1] : [0, 0, 0])
        );
        const stiffness = this.edges.map(e => e.stiffness);

        this.redundancyCalculator = new RedundancyMatrixTruss(
            nodePositions,
            topology,
            dirichletBC,
            stiffness
        );

        if (this.debugLogging) console.log('Using full structural redundancy calculation (JavaScript)');
    },

    updateRedundancyValues(calculateTarget = false) {
        try {
            // Use full redundancy matrix calculation
            const nodePositions = this.nodes.map(n => [n.x, n.y, n.z]);

            // Update redundancy calculator with new positions. Only the
            // per-element redundancy (diagonal of R) is used downstream, so we
            // compute the diagonal directly instead of the full m x m matrix.
            const redundancyValues = this.redundancyCalculator.updateDiagonal(nodePositions);

            if (this.debugLogging) {
                console.log('Redundancy values:', redundancyValues);
                console.log('Number of edges:', this.edges.length);
                console.log('Number of redundancy values:', redundancyValues.length);
            }

            // Update edges
            for (let i = 0; i < this.edges.length; i++) {
                this.edges[i].redundancy = redundancyValues[i] || 0;
            }

            // Calculate target redundancy only when explicitly requested (on initial load)
            if (calculateTarget) {
                const validRedundancies = redundancyValues.filter(r => r !== undefined && !isNaN(r));
                if (validRedundancies.length > 0) {
                    const sum = validRedundancies.reduce((acc, val) => acc + val, 0);
                    this.config.target_redundancy = sum / validRedundancies.length;
                    if (this.debugLogging) console.log('Target redundancy calculated:', this.config.target_redundancy);
                }
            }
        } catch (error) {
            console.error('Failed to update redundancy:', error);
            console.error('Error stack:', error.stack);
        }
    },

    updateRedundancyStats() {
        if (this.edges.length === 0) return;

        const redundancies = this.edges.map(e => e.redundancy);
        const min = Math.min(...redundancies);
        const max = Math.max(...redundancies);
        const range = max - min;

        document.getElementById('min-redundancy').textContent = min.toFixed(4);
        document.getElementById('max-redundancy').textContent = max.toFixed(4);
        document.getElementById('range-redundancy').textContent = range.toFixed(4);
    },

    calculateRedundancyError() {
        // Calculate sum of absolute errors from target redundancy
        let error = 0;
        for (let edge of this.edges) {
            error += Math.abs(edge.redundancy - this.config.target_redundancy);
        }
        return error;
    },

    calculateRedundancyRange() {
        // Calculate range of redundancy values (max - min)
        const redundancies = this.edges.map(e => e.redundancy);
        const min = Math.min(...redundancies);
        const max = Math.max(...redundancies);
        return max - min;
    },

    calculateRedundancyDeviation(target) {
        // Sum of squared deviations from the target redundancy,
        //   L = sum_e (r_e - target)^2  --
        // the loss the gradient expert descends (matches
        // RedundancyMatrixBeam.redundancyDeviationGradient). Falls back to
        // the configured target, then to the current mean (which is
        // invariant under node moves, since the total redundancy is fixed
        // by topology and boundary conditions).
        let t = target;
        if (t == null || isNaN(t)) t = this.config.target_redundancy;
        if (t == null || isNaN(t)) {
            const r = this.edges.map(e => e.redundancy);
            t = r.reduce((acc, v) => acc + v, 0) / r.length;
        }
        let loss = 0;
        for (const edge of this.edges) {
            const d = edge.redundancy - t;
            loss += d * d;
        }
        return loss;
    },

    calculateSegmentLength(edge) {
        // Calculate current length of a segment (edge)
        const source = this.nodes[edge.source];
        const target = this.nodes[edge.target];
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const dz = target.z - source.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },

    calculateSegmentLengthError() {
        // Calculate sum of squared errors from target segment length
        // This objective tries to make all segments equal to targetSegmentLength
        let error = 0;
        for (let edge of this.edges) {
            const currentLength = this.calculateSegmentLength(edge);
            const diff = currentLength - this.targetSegmentLength;
            error += diff * diff;  // Squared error
        }
        return error;
    },

    getRedundancyScaleMax() {
        // Per-element redundancy range depends on the structure type:
        //   truss -> [0, 1] (single axial mode per element)
        //   beam  -> [0, 6] (sum of the 6 diagonal entries per element)
        return (this.config && this.config.type === 'beam') ? 6 : 1;
    },

    refreshRenderCaches() {
        // Compute the color-mapping domain and the mean stiffness once per
        // render pass. getRedundancyColor previously recomputed the full
        // redundancy array for every edge drawn (O(E^2) per frame).
        let min = 0;
        let max = this.getRedundancyScaleMax();
        if (this.colorScaleAuto) {
            const rs = this.edges
                .map(e => e.redundancy)
                .filter(r => r !== undefined && !isNaN(r));
            if (rs.length > 0) {
                min = Math.min(...rs);
                max = Math.max(...rs);
                if (max - min < 1e-9) {
                    // Degenerate (fully homogenized) distribution: pad so the
                    // mapping stays well-defined.
                    const pad = Math.max(1e-9, 0.05 * Math.abs(max));
                    min -= pad;
                    max += pad;
                }
            }
        }

        let meanStiffness = 1.0;
        if (this.edges.length > 0) {
            meanStiffness = this.edges.reduce(
                (a, e) => a + (e.stiffness || 1.0), 0
            ) / this.edges.length;
        }

        this._renderCache = { min, max, meanStiffness };
        return this._renderCache;
    },

    getThicknessFactor(edge) {
        // Element thickness encodes the stiffness ratio EA / mean(EA)
        // (matches the paper's cross-section figure convention). The ratio is
        // squared to exaggerate differences - mid-optimization stiffness
        // spreads are often only tens of percent, which is invisible at
        // linear scaling. Clamped so extreme ratios stay drawable.
        if (!this.showThickness) return 1.0;
        const cache = this._renderCache || this.refreshRenderCaches();
        const ratio = (edge.stiffness || 1.0) / cache.meanStiffness;
        return Math.max(0.2, Math.min(5.0, ratio * ratio));
    },

    getRedundancyColor(redundancy) {
        if (redundancy === undefined || isNaN(redundancy)) {
            return 'rgb(100, 100, 100)';  // Gray fallback
        }
        const cache = this._renderCache || this.refreshRenderCaches();
        const t = Math.max(0, Math.min(1,
            (redundancy - cache.min) / (cache.max - cache.min)
        ));

        // Viridis color interpolation
        const colors = [
            [68, 1, 84],    // Dark purple
            [59, 82, 139],  // Blue
            [33, 145, 140], // Teal
            [94, 201, 98],  // Green
            [253, 231, 37]  // Yellow
        ];

        const idx = t * (colors.length - 1);
        const i0 = Math.floor(idx);
        const i1 = Math.min(i0 + 1, colors.length - 1);
        const f = idx - i0;

        const c0 = colors[i0];
        const c1 = colors[i1];

        const r = Math.round(c0[0] + (c1[0] - c0[0]) * f);
        const g = Math.round(c0[1] + (c1[1] - c0[1]) * f);
        const b = Math.round(c0[2] + (c1[2] - c0[2]) * f);

        return `rgb(${r}, ${g}, ${b})`;
    },

    recordRangeHistory() {
        this.rangeHistory.push(this.calculateRedundancyRange());
        // Cap memory: keep every 2nd sample once the buffer is large. The
        // sparkline is qualitative, so thinning is invisible.
        if (this.rangeHistory.length > 2000) {
            this.rangeHistory = this.rangeHistory.filter((_, i) => i % 2 === 0);
        }
        this.updateRangeHistoryPlot();
    },

    updateRangeHistoryPlot() {
        const canvas = document.getElementById('range-history-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);
        const hist = this.rangeHistory;
        if (hist.length < 2) return;

        let min = Math.min(...hist);
        let max = Math.max(...hist);
        if (max - min < 1e-12) { max = min + 1e-12; }

        ctx.strokeStyle = '#4fa3d1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < hist.length; i++) {
            const x = (i / (hist.length - 1)) * (w - 2) + 1;
            const y = h - 2 - ((hist[i] - min) / (max - min)) * (h - 4);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
};
