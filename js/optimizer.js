// Optimizer - Gradient computation and optimization stepping

export const OptimizerMixin = {
    // Redundancy-homogenization gradient of the mean-squared deviation from
    // the target redundancy -- the same objective the gradient expert in the
    // paper descends. Both calculators (truss and beam) provide the analytic
    // adjoint gradient (one factorization instead of one full solve per
    // finite-difference perturbation); the finite-difference path below is
    // kept only as a fallback for calculators without it.
    computeRedundancyGradient() {
        const analytic = this.redundancyCalculator
            && typeof this.redundancyCalculator.redundancyDeviationGradient === 'function';

        if (!analytic) return this.computeGradientNumerical();

        const nodePositions = this.nodes.map(n => [n.x, n.y, n.z]);
        const target = this.config.target_redundancy;  // undefined -> current mean
        const g = this.redundancyCalculator.redundancyDeviationGradient(nodePositions, target);
        return g.map(v => ({ x: v[0], y: v[1], z: v[2] }));
    },

    computeGradientNumerical() {
        // Finite-difference gradient of the deviation loss
        //   L = sum_e (r_e - target)^2
        // with respect to node positions. (Previously this differentiated
        // the range max_e r_e - min_e r_e; the deviation loss gives every
        // element a gradient contribution instead of only the two extremes,
        // matching the analytic beam path and the paper's expert.)
        // Note: Dirichlet BC affects the structural analysis, but ALL node
        // positions can be optimized regardless of their BC.
        // Resolve the target once from the unperturbed state so every
        // perturbed evaluation measures against the same reference.
        let target = this.config ? this.config.target_redundancy : undefined;
        if (target == null || isNaN(target)) {
            const r = this.edges.map(e => e.redundancy);
            target = r.reduce((acc, v) => acc + v, 0) / r.length;
        }
        const baseLoss = this.calculateRedundancyDeviation(target);
        const epsilon = this.gradientEpsilon;

        const gradient = [];

        // For each node - ALL nodes can be optimized
        for (let nodeIdx = 0; nodeIdx < this.nodes.length; nodeIdx++) {
            const node = this.nodes[nodeIdx];
            const nodeGrad = { x: 0, y: 0, z: 0 };

            // X direction
            const originalX = node.x;
            node.x = originalX + epsilon;
            this.updateRedundancyValues();
            const lossPosX = this.calculateRedundancyDeviation(target);
            node.x = originalX;
            this.updateRedundancyValues();
            nodeGrad.x = (lossPosX - baseLoss) / epsilon;

            // Y direction
            const originalY = node.y;
            node.y = originalY + epsilon;
            this.updateRedundancyValues();
            const lossPosY = this.calculateRedundancyDeviation(target);
            node.y = originalY;
            this.updateRedundancyValues();
            nodeGrad.y = (lossPosY - baseLoss) / epsilon;

            // Z direction
            const originalZ = node.z;
            node.z = originalZ + epsilon;
            this.updateRedundancyValues();
            const lossPosZ = this.calculateRedundancyDeviation(target);
            node.z = originalZ;
            this.updateRedundancyValues();
            nodeGrad.z = (lossPosZ - baseLoss) / epsilon;

            gradient.push(nodeGrad);
        }

        // Clip gradient norm to prevent exploding gradients
        // (happens when initial geometry is degenerate/collinear, causing
        // the redundancy fallback to return identity matrix with range=0,
        // while perturbed positions produce non-zero range -> huge gradient)
        const maxGradNorm = 10.0;
        let gradNorm = 0;
        for (const g of gradient) {
            gradNorm += g.x * g.x + g.y * g.y + g.z * g.z;
        }
        gradNorm = Math.sqrt(gradNorm);
        if (gradNorm > maxGradNorm) {
            const scale = maxGradNorm / gradNorm;
            for (const g of gradient) {
                g.x *= scale;
                g.y *= scale;
                g.z *= scale;
            }
            console.warn(`Gradient norm ${gradNorm.toFixed(2)} exceeded max ${maxGradNorm}, clipped by factor ${scale.toFixed(6)}`);
        }

        return gradient;
    },

    gradientDescentStep() {
        // Perform one multi-objective optimization step
        const initialRange = this.calculateRedundancyRange();
        const initialSegmentError = this.calculateSegmentLengthError();
        if (this.debugLogging) {
            const redundancies = this.edges.map(e => e.redundancy);
            console.log(`\n=== Multi-Objective Step ${this.step + 1} ===`);
            console.log(`Initial redundancy range: ${initialRange.toFixed(6)} (min=${Math.min(...redundancies).toFixed(6)}, max=${Math.max(...redundancies).toFixed(6)})`);
            console.log(`Initial segment length error: ${initialSegmentError.toFixed(6)}`);
            console.log(`Weights: redundancy=${this.redundancyWeight.toFixed(2)}, segment=${this.segmentLengthWeight.toFixed(2)}`);
        }

        // Initialize combined moves for each node
        const combinedMoves = this.nodes.map(() => ({
            move: { x: 0, y: 0, z: 0 },
            weight: 0
        }));

        // Objective 1: Redundancy homogenization (gradient-based)
        if (this.redundancyWeight > 0) {
            const gradient = this.computeRedundancyGradient();

            if (this.debugLogging) {
                let gradNorm = 0;
                for (let g of gradient) {
                    gradNorm += g.x * g.x + g.y * g.y + g.z * g.z;
                }
                gradNorm = Math.sqrt(gradNorm);
                console.log(`Redundancy gradient norm: ${gradNorm.toFixed(6)}`);
            }

            // Add weighted gradient moves (negative for gradient descent)
            for (let i = 0; i < this.nodes.length; i++) {
                const grad = gradient[i];
                combinedMoves[i].move.x -= this.redundancyWeight * this.learningRate * grad.x;
                combinedMoves[i].move.y -= this.redundancyWeight * this.learningRate * grad.y;
                combinedMoves[i].move.z -= this.redundancyWeight * this.learningRate * grad.z;
                combinedMoves[i].weight += this.redundancyWeight;
            }
        }

        // Objective 2: Segment length constraint (direct geometric)
        if (this.segmentLengthWeight > 0) {
            if (this.debugLogging) console.log('Computing segment length moves...');
            const segmentMoves = this.computeSegmentLengthMoves();

            // Add weighted segment length moves
            for (let i = 0; i < this.nodes.length; i++) {
                combinedMoves[i].move.x += this.segmentLengthWeight * segmentMoves[i].move.x;
                combinedMoves[i].move.y += this.segmentLengthWeight * segmentMoves[i].move.y;
                combinedMoves[i].move.z += this.segmentLengthWeight * segmentMoves[i].move.z;
                combinedMoves[i].weight += this.segmentLengthWeight * segmentMoves[i].weight;
            }
        }

        // Objective 3: Min/Max segment length constraint (direct geometric)
        if (this.minMaxSegmentLengthWeight > 0) {
            if (this.debugLogging) console.log('Computing min/max segment length moves...');
            const minMaxMoves = this.computeMinMaxSegmentLengthMoves();

            // Add weighted min/max segment length moves
            for (let i = 0; i < this.nodes.length; i++) {
                combinedMoves[i].move.x += this.minMaxSegmentLengthWeight * minMaxMoves[i].move.x;
                combinedMoves[i].move.y += this.minMaxSegmentLengthWeight * minMaxMoves[i].move.y;
                combinedMoves[i].move.z += this.minMaxSegmentLengthWeight * minMaxMoves[i].move.z;
                combinedMoves[i].weight += this.minMaxSegmentLengthWeight * minMaxMoves[i].weight;
            }
        }

        // Objective 4: Angle constraint (direct geometric)
        if (this.angleWeight > 0) {
            if (this.debugLogging) console.log('Computing angle constraint moves...');
            const angleResult = this.computeAngleMoves();
            const angleMoves = angleResult.moves;

            // Add weighted angle moves
            for (let i = 0; i < this.nodes.length; i++) {
                combinedMoves[i].move.x += this.angleWeight * angleMoves[i].move.x;
                combinedMoves[i].move.y += this.angleWeight * angleMoves[i].move.y;
                combinedMoves[i].move.z += this.angleWeight * angleMoves[i].move.z;
                combinedMoves[i].weight += this.angleWeight * angleMoves[i].weight;
            }

            // Store violations and trigger flash if any found
            if (angleResult.triggered) {
                this.violatedAngles = angleResult.violations;
                this.angleFlashTime = Date.now();
            }
        }

        // Apply combined moves to nodes
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const moveData = combinedMoves[i];

            // Skip fixed nodes
            if (node.fixed) continue;

            if (moveData.weight > 0) {
                // The moves are already weighted per behavior; the weight
                // accumulator only gates "did any behavior contribute".
                node.x += moveData.move.x;
                node.y += moveData.move.y;
                node.z += moveData.move.z;
            }
        }

        // Objective 5: Cross-section adaptation (property-based behavior)
        if (this.crossSectionWeight > 0) {
            this.applyCrossSectionAdaptation();
        }

        // Recalculate metrics with new positions
        this.updateRedundancyValues();

        // Cross-section changes feed the GNN edge features (stiffness ratio)
        if (this.crossSectionWeight > 0) {
            this.refreshPolicyAfterTopologyEdit();
        }

        if (this.debugLogging) {
            const finalRange = this.calculateRedundancyRange();
            const finalSegmentError = this.calculateSegmentLengthError();
            const finalRedundancies = this.edges.map(e => e.redundancy);
            console.log(`Final redundancy range: ${finalRange.toFixed(6)} (min=${Math.min(...finalRedundancies).toFixed(6)}, max=${Math.max(...finalRedundancies).toFixed(6)})`);
            console.log(`Final segment length error: ${finalSegmentError.toFixed(6)}`);
            console.log(`Redundancy change: ${(finalRange - initialRange).toFixed(6)} (${((finalRange - initialRange) / initialRange * 100).toFixed(2)}%)`);
            console.log(`Segment error change: ${(finalSegmentError - initialSegmentError).toFixed(6)}`);
        }
    },

    applyCrossSectionAdaptation() {
        // Property-based behavior (paper Eq. CrossSectionOpt):
        //   C_ee <- (1 + gamma * r_e) C_ee
        // implemented on the element stiffness EA (C_ee = EA / L). Redundant
        // elements (large r_e) are stiffened more aggressively than
        // determinate ones (r_e -> 0), driving the redundancy distribution
        // toward homogeneity. The mean stiffness is renormalized after the
        // update so the absolute scale stays fixed: redundancy depends only
        // on stiffness ratios, and unbounded growth would degrade the
        // conditioning of the stiffness matrix.
        const gamma = this.crossSectionWeight * this.crossSectionGamma;
        if (gamma <= 0 || this.edges.length === 0) return;

        const meanBefore = this.edges.reduce(
            (a, e) => a + (e.stiffness || 1.0), 0
        ) / this.edges.length;

        for (const edge of this.edges) {
            edge.stiffness = (edge.stiffness || 1.0) * (1 + gamma * edge.redundancy);
        }

        const meanAfter = this.edges.reduce(
            (a, e) => a + e.stiffness, 0
        ) / this.edges.length;
        const scale = meanBefore / meanAfter;
        for (const edge of this.edges) {
            edge.stiffness *= scale;
        }

        // Stiffness is baked into the calculator at construction time.
        this.initializeRedundancyCalculator();
    },

    async agentStep() {
        // Use policy or gradient descent based on mode
        if (this.usePolicyMode && this.policyLoaded) {
            await this.policyStep();
        } else {
            this.gradientDescentStep();
        }
        this.step++;
        document.getElementById('step-count').textContent = this.step;
        this.recordRangeHistory();

        // Update 3D scene if in 3D mode
        if (this.view3D && this.scene) {
            this.update3DScene();
        }

        this.render();
    },

    toggleAutoStep() {
        if (this.autoStepping) {
            this.stopAutoStep();
        } else {
            this.startAutoStep();
        }
    },

    startAutoStep() {
        this.autoStepping = true;
        this._autoStepRunning = false;
        document.getElementById('auto-btn').innerHTML = '<i class="fa-solid fa-pause"></i> Stop Auto';

        this.autoStepInterval = setInterval(async () => {
            // Prevent stacking up async calls if using ONNX
            if (this._autoStepRunning) return;
            this._autoStepRunning = true;
            try {
                await this.agentStep();
            } finally {
                this._autoStepRunning = false;
            }
        }, this.stepSpeed);
    },

    stopAutoStep() {
        this.autoStepping = false;
        document.getElementById('auto-btn').innerHTML = '<i class="fa-solid fa-play"></i> Run Auto Step';

        if (this.autoStepInterval) {
            clearInterval(this.autoStepInterval);
            this.autoStepInterval = null;
        }
    }
};
