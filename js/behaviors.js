// Behaviors - Agent behavior constraints (angle, segment length)

export const BehaviorsMixin = {
    getCorners() {
        // Face corners [k, i, j]: the corner at node k between members k-i and k-j.
        // At every node the incident members are ordered by angle in the node's
        // local tangent plane (best-fit plane through the member directions), and
        // each pair of consecutive members forms a corner; gaps wider than 180 deg
        // are open boundary and skipped. This covers triangle meshes as well as
        // polygonal shells (same rule as the Grasshopper AngleBehavior). The result
        // only depends on connectivity, so it is cached until the topology version
        // changes (editor ops bump it).
        if (this._cornersCache && this._cornersCacheVersion === this._topologyVersion) {
            return this._cornersCache;
        }
        const n = this.nodes.length;
        const adj = Array.from({ length: n }, () => new Set());
        for (const edge of this.edges) {
            adj[edge.source].add(edge.target);
            adj[edge.target].add(edge.source);
        }
        const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
        const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
        const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
        const unit = (v) => { const l = Math.sqrt(dot(v, v)); return l > 1e-12 ? { x: v.x / l, y: v.y / l, z: v.z / l } : v; };

        // normal of the best-fit plane: smallest eigenvector of the scatter matrix of
        // the member directions (power iteration on tr(C) I - C)
        const localNormal = (dirs) => {
            if (dirs.length === 2) {
                const c = cross(dirs[0], dirs[1]);
                if (dot(c, c) > 1e-18) return unit(c);
            }
            const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
            for (const d of dirs) {
                const x = [d.x, d.y, d.z];
                for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[r][q] += x[r] * x[q];
            }
            const tr = C[0][0] + C[1][1] + C[2][2];
            let e = [0.31, 0.53, 0.79];
            for (let it = 0; it < 60; it++) {
                const y = [0, 0, 0];
                for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) y[r] += ((r === q ? tr : 0) - C[r][q]) * e[q];
                const l = Math.hypot(y[0], y[1], y[2]);
                if (l < 1e-12) break;
                e = [y[0] / l, y[1] / l, y[2] / l];
            }
            return { x: e[0], y: e[1], z: e[2] };
        };

        const corners = [];
        for (let k = 0; k < n; k++) {
            const nb = [...adj[k]];
            if (nb.length < 2) continue;
            const pk = this.nodes[k];
            const dirs = nb.map(j => unit(sub(this.nodes[j], pk)));
            const nrm = localNormal(dirs);
            let b1 = Math.abs(nrm.z) < 0.9 ? cross(nrm, { x: 0, y: 0, z: 1 }) : cross(nrm, { x: 1, y: 0, z: 0 });
            b1 = unit(b1);
            const b2 = cross(nrm, b1);
            const ordered = nb
                .map(j => { const v = sub(this.nodes[j], pk); return { phi: Math.atan2(dot(v, b2), dot(v, b1)), j }; })
                .sort((a, b) => a.phi - b.phi);
            if (ordered.length === 2) {                    // two members: a single corner
                corners.push([k, ordered[0].j, ordered[1].j]);
                continue;
            }
            for (let t = 0; t < ordered.length; t++) {
                const a = ordered[t], b = ordered[(t + 1) % ordered.length];
                let gap = b.phi - a.phi;
                if (gap < 0) gap += 2 * Math.PI;
                if (gap > Math.PI) continue;               // open side at a boundary node
                corners.push([k, a.j, b.j]);
            }
        }
        this._cornersCache = corners;
        this._cornersCacheVersion = this._topologyVersion;
        return corners;
    },

    computeAngleMoves() {
        // Compute moves for angle constraint
        // Works on face corners (see getCorners) to ensure min/max angles
        const nodeMoves = this.nodes.map(() => ({
            move: { x: 0, y: 0, z: 0 },
            weight: 0
        }));

        if (this.angleWeight === 0) {
            return { moves: nodeMoves, triggered: false, violations: [] };
        }

        const corners = this.getCorners();
        let triggered = false;
        const violations = []; // Track violated angle positions

        const minAngleRad = this.minAngle * Math.PI / 180.0;
        const maxAngleRad = this.maxAngle * Math.PI / 180.0;

        for (const corner of corners) {
            {
                // corner at node K between the members K-I and K-J
                const [nodeIdxK, nodeIdxI, nodeIdxJ] = corner;
                const vertexK = this.nodes[nodeIdxK];
                const vertexI = this.nodes[nodeIdxI];
                const vertexJ = this.nodes[nodeIdxJ];

                // Vectors from K to I and J
                const vI = {
                    x: vertexI.x - vertexK.x,
                    y: vertexI.y - vertexK.y,
                    z: vertexI.z - vertexK.z
                };
                const vJ = {
                    x: vertexJ.x - vertexK.x,
                    y: vertexJ.y - vertexK.y,
                    z: vertexJ.z - vertexK.z
                };

                // Calculate angle using dot product
                const dotProduct = vI.x * vJ.x + vI.y * vJ.y + vI.z * vJ.z;
                const magI = Math.sqrt(vI.x * vI.x + vI.y * vI.y + vI.z * vI.z);
                const magJ = Math.sqrt(vJ.x * vJ.x + vJ.y * vJ.y + vJ.z * vJ.z);

                if (magI < 0.001 || magJ < 0.001) continue;

                const cosAngle = Math.max(-1, Math.min(1, dotProduct / (magI * magJ)));
                const alpha = Math.acos(cosAngle);

                // Check if angle is outside allowed range
                const belowMin = alpha < minAngleRad;
                const aboveMax = alpha > maxAngleRad;

                if (!belowMin && !aboveMax) continue;

                triggered = true;

                // Record violation with all three vertices for visualization
                violations.push({
                    // Corner vertex (where angle is measured)
                    x: vertexK.x,
                    y: vertexK.y,
                    z: vertexK.z,
                    // Edge endpoint vertices
                    edgeI: { x: vertexI.x, y: vertexI.y, z: vertexI.z },
                    edgeJ: { x: vertexJ.x, y: vertexJ.y, z: vertexJ.z },
                    angle: alpha * 180.0 / Math.PI
                });

                // Correction angle (rotate each neighbor by half the difference)
                // For min angle: positive correction opens the angle
                // For max angle: negative correction closes the angle
                const correction = belowMin
                    ? (minAngleRad - alpha) / 2
                    : (maxAngleRad - alpha) / 2;

                // Normal to the plane (for 2D, we assume XZ plane, so normal is Y-axis)
                // For 3D, calculate cross product
                const normal = {
                    x: vI.y * vJ.z - vI.z * vJ.y,
                    y: vI.z * vJ.x - vI.x * vJ.z,
                    z: vI.x * vJ.y - vI.y * vJ.x
                };
                const normMag = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
                if (normMag < 0.001) continue;

                normal.x /= normMag;
                normal.y /= normMag;
                normal.z /= normMag;

                // Rotate vI by -correction and vJ by +correction
                // Using Rodrigues' rotation formula
                const rotateVector = (v, axis, angle) => {
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z;

                    return {
                        x: v.x * cos + (axis.y * v.z - axis.z * v.y) * sin + axis.x * dot * (1 - cos),
                        y: v.y * cos + (axis.z * v.x - axis.x * v.z) * sin + axis.y * dot * (1 - cos),
                        z: v.z * cos + (axis.x * v.y - axis.y * v.x) * sin + axis.z * dot * (1 - cos)
                    };
                };

                const vI_rotated = rotateVector(vI, normal, -correction);
                const vJ_rotated = rotateVector(vJ, normal, +correction);

                // New positions
                const pI_new = {
                    x: vertexK.x + vI_rotated.x,
                    y: vertexK.y + vI_rotated.y,
                    z: vertexK.z + vI_rotated.z
                };
                const pJ_new = {
                    x: vertexK.x + vJ_rotated.x,
                    y: vertexK.y + vJ_rotated.y,
                    z: vertexK.z + vJ_rotated.z
                };

                // Moves
                const moveI = {
                    x: pI_new.x - vertexI.x,
                    y: pI_new.y - vertexI.y,
                    z: pI_new.z - vertexI.z
                };
                const moveJ = {
                    x: pJ_new.x - vertexJ.x,
                    y: pJ_new.y - vertexJ.y,
                    z: pJ_new.z - vertexJ.z
                };

                // Add weighted moves
                nodeMoves[nodeIdxI].move.x += moveI.x;
                nodeMoves[nodeIdxI].move.y += moveI.y;
                nodeMoves[nodeIdxI].move.z += moveI.z;
                nodeMoves[nodeIdxI].weight += 1.0;

                nodeMoves[nodeIdxJ].move.x += moveJ.x;
                nodeMoves[nodeIdxJ].move.y += moveJ.y;
                nodeMoves[nodeIdxJ].move.z += moveJ.z;
                nodeMoves[nodeIdxJ].weight += 1.0;
            }
        }

        return { moves: nodeMoves, triggered, violations };
    },

    computeMinMaxSegmentLengthMoves() {
        // Compute moves for min/max segment length constraint
        // Only acts on segments outside the allowed range [min, max]
        // Returns array of {move: {x, y, z}, weight} for each node

        const nodeMoves = this.nodes.map(() => ({
            move: { x: 0, y: 0, z: 0 },
            weight: 0
        }));

        if (this.minMaxSegmentLengthWeight === 0) {
            return nodeMoves;
        }

        for (let edge of this.edges) {
            const source = this.nodes[edge.source];
            const target = this.nodes[edge.target];

            // Vector from source to target
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dz = target.z - source.z;
            const currentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (currentLength < 0.001) {
                continue; // Skip degenerate edges
            }

            let targetLength = null;

            // Check if segment is too short
            if (currentLength < this.minSegmentLength) {
                // Use 105% of min to push it well into the allowed range
                targetLength = this.minSegmentLength * 1.05;
            }
            // Check if segment is too long
            else if (currentLength > this.maxSegmentLength) {
                // Use 95% of max to pull it well into the allowed range
                targetLength = this.maxSegmentLength * 0.95;
            }

            // If segment is within bounds, do nothing
            if (targetLength === null) {
                continue;
            }

            // Normalized direction vector (from source to target)
            const nx = dx / currentLength;
            const ny = dy / currentLength;
            const nz = dz / currentLength;

            // How much to move (0.5 = half the correction per endpoint)
            const moveMagnitude = 0.5 * (targetLength - currentLength);

            const move = {
                x: moveMagnitude * nx,
                y: moveMagnitude * ny,
                z: moveMagnitude * nz
            };

            // Target node moves away from source (positive = grow, negative = shrink)
            nodeMoves[edge.target].move.x += move.x;
            nodeMoves[edge.target].move.y += move.y;
            nodeMoves[edge.target].move.z += move.z;
            nodeMoves[edge.target].weight += 1.0;

            // Source node moves in opposite direction
            nodeMoves[edge.source].move.x -= move.x;
            nodeMoves[edge.source].move.y -= move.y;
            nodeMoves[edge.source].move.z -= move.z;
            nodeMoves[edge.source].weight += 1.0;
        }

        return nodeMoves;
    },

    computeSegmentLengthMoves() {
        // Compute moves for segment length constraint using direct geometric method
        // Each edge pulls/pushes its endpoints to achieve target length
        // Returns array of {move: {x, y, z}, weight} for each node

        const nodeMoves = this.nodes.map(() => ({
            move: { x: 0, y: 0, z: 0 },
            weight: 0
        }));

        if (this.segmentLengthWeight === 0) {
            return nodeMoves;
        }

        for (let edge of this.edges) {
            const source = this.nodes[edge.source];
            const target = this.nodes[edge.target];

            // Vector from source to target
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const dz = target.z - source.z;
            const currentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (currentLength < 0.001) {
                // Edge is nearly collapsed, use arbitrary direction
                const move = {
                    x: 0.5 * 1.0,
                    y: 0,
                    z: 0
                };
                nodeMoves[edge.source].move.x += move.x;
                nodeMoves[edge.source].weight += 1.0;

                nodeMoves[edge.target].move.x -= move.x;
                nodeMoves[edge.target].weight += 1.0;
            } else {
                // Normalized direction vector (from source to target)
                const nx = dx / currentLength;
                const ny = dy / currentLength;
                const nz = dz / currentLength;

                // How much to move along this direction (0.5 = half the correction per endpoint)
                // If targetLength < currentLength (shrink), moveMagnitude is negative
                // If targetLength > currentLength (grow), moveMagnitude is positive
                const moveMagnitude = 0.5 * (this.targetSegmentLength - currentLength);

                const move = {
                    x: moveMagnitude * nx,
                    y: moveMagnitude * ny,
                    z: moveMagnitude * nz
                };

                // Target node moves in the direction away from source
                // (positive move = grow, negative move = shrink toward source)
                nodeMoves[edge.target].move.x += move.x;
                nodeMoves[edge.target].move.y += move.y;
                nodeMoves[edge.target].move.z += move.z;
                nodeMoves[edge.target].weight += 1.0;

                // Source node moves in opposite direction
                // (negative move = toward target when shrinking)
                nodeMoves[edge.source].move.x -= move.x;
                nodeMoves[edge.source].move.y -= move.y;
                nodeMoves[edge.source].move.z -= move.z;
                nodeMoves[edge.source].weight += 1.0;
            }
        }

        return nodeMoves;
    }
};
