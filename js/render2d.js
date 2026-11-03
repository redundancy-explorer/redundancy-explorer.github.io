// Render2D - 2D canvas rendering

export const Render2DMixin = {
    fitView2D() {
        // Center and scale the 2D view to the node bounding box in the active
        // view plane (XZ -> vertical is z, XY -> vertical is y).
        if (!this.nodes || this.nodes.length === 0) return;
        const viewPlane = this.config?.view_plane || 'XZ';
        const vertOf = (n) => (viewPlane === 'XZ' ? n.z : n.y);

        let minX = Infinity, maxX = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const n of this.nodes) {
            minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
            const v = vertOf(n);
            minV = Math.min(minV, v); maxV = Math.max(maxV, v);
        }

        this.offsetX = -(minX + maxX) / 2;
        this.offsetY = -(minV + maxV) / 2;

        const spanX = Math.max(maxX - minX, 1e-3);
        const spanV = Math.max(maxV - minV, 1e-3);
        const margin = 0.9;  // 10% padding around the structure
        const scaleX = (this.canvas.width * margin) / spanX;
        const scaleV = (this.canvas.height * margin) / spanV;
        this.scale = Math.max(1, Math.min(scaleX, scaleV));
    },

    render() {
        // Clear canvas with theme-appropriate color
        this.ctx.fillStyle = this.lightMode ? '#ffffff' : '#1a1a1a';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Refresh the per-frame render caches (color scale, mean stiffness)
        this.refreshRenderCaches();

        // Draw grid if enabled
        if (this.showGrid) {
            this.drawGrid();
        }

        // Draw edges
        for (let edge of this.edges) {
            const source = this.nodes[edge.source];
            const target = this.nodes[edge.target];

            const p1 = this.worldToScreen(source.x, source.y, source.z);
            const p2 = this.worldToScreen(target.x, target.y, target.z);

            // Highlight hovered edge in edit mode
            if (this.editMode && this.hoveredEdge === edge) {
                this.ctx.strokeStyle = '#ff4444';
                this.ctx.lineWidth = 6;
            } else {
                this.ctx.strokeStyle = this.getRedundancyColor(edge.redundancy);
                // 1px floor keeps low-stiffness elements visible
                this.ctx.lineWidth = Math.max(1, 3 * this.getThicknessFactor(edge));
            }
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
        }

        // Draw redundancy value labels on edges
        if (this.showRedundancyLabels) {
            for (let edge of this.edges) {
                const source = this.nodes[edge.source];
                const target = this.nodes[edge.target];

                const p1 = this.worldToScreen(source.x, source.y, source.z);
                const p2 = this.worldToScreen(target.x, target.y, target.z);

                // Calculate midpoint
                const midX = (p1.x + p2.x) / 2;
                const midY = (p1.y + p2.y) / 2;

                // Draw small circle background
                const circleRadius = 20;
                this.ctx.beginPath();
                this.ctx.arc(midX, midY, circleRadius, 0, Math.PI * 2);
                this.ctx.fillStyle = 'rgba(42, 42, 42, 0.95)';
                this.ctx.fill();
                this.ctx.strokeStyle = this.getRedundancyColor(edge.redundancy);
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                // Draw redundancy value text
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = 'bold 11px monospace';
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(edge.redundancy.toFixed(3), midX, midY);
            }
        }

        // Draw nodes
        for (let node of this.nodes) {
            const pos = this.worldToScreen(node.x, node.y, node.z);
            const radius = node.radius * this.scale * 2;

            // Node circle
            this.ctx.beginPath();
            this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);

            const dirichletBC = node.dirichlet_bc || [0, 0, 0];
            const hasXYConstraint = dirichletBC[0] === 1 || dirichletBC[1] === 1;
            if (hasXYConstraint) {
                this.ctx.fillStyle = '#555';
            } else {
                this.ctx.fillStyle = '#bbb';
            }

            this.ctx.fill();

            // Highlight if hovered or dragged
            if (this.hoveredNode === node || this.draggedNode === node) {
                this.ctx.strokeStyle = '#fff';
                this.ctx.lineWidth = 3;
                this.ctx.stroke();
            }

            // Highlight selected node in edit mode (for edge creation)
            if (this.editMode && this.selectedNode === node) {
                this.ctx.strokeStyle = '#aaa';
                this.ctx.lineWidth = 4;
                this.ctx.stroke();
            }

            // Draw lock indicator for fixed nodes
            if (node.fixed) {
                this.ctx.strokeStyle = '#888';
                this.ctx.lineWidth = 2;
                this.ctx.setLineDash([4, 4]);
                this.ctx.beginPath();
                this.ctx.arc(pos.x, pos.y, radius + 4, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
            }

            // Draw node ID
            this.ctx.fillStyle = '#ffffff';
            this.ctx.font = '12px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillText(node.id.toString(), pos.x, pos.y);
        }

        // Draw angle violation indicators
        this.drawAngleViolations();

        // Update redundancy stats
        this.updateRedundancyStats();

        // Draw colorbar
        this.drawColorbar();
    },

    drawAngleViolations() {
        // Check if we should still show the flash (within 500ms)
        const elapsed = Date.now() - this.angleFlashTime;
        if (elapsed > 500 || this.violatedAngles.length === 0) {
            return;
        }

        // Calculate opacity based on flash animation
        const t = elapsed / 500.0;
        let opacity;
        if (t < 0.5) {
            opacity = t * 2; // Fade in
        } else {
            opacity = (1 - t) * 2; // Fade out
        }
        opacity = Math.max(0, Math.min(0.7, opacity));

        // Draw wedge spanning the two edges that form the violated angle
        for (let violation of this.violatedAngles) {
            const posK = this.worldToScreen(violation.x, violation.y, violation.z);
            const posI = this.worldToScreen(violation.edgeI.x, violation.edgeI.y, violation.edgeI.z);
            const posJ = this.worldToScreen(violation.edgeJ.x, violation.edgeJ.y, violation.edgeJ.z);

            // Vectors from corner to edge endpoints (in screen space)
            const vI = { x: posI.x - posK.x, y: posI.y - posK.y };
            const vJ = { x: posJ.x - posK.x, y: posJ.y - posK.y };

            // Normalize and scale to a fixed length for the wedge
            const magI = Math.sqrt(vI.x * vI.x + vI.y * vI.y);
            const magJ = Math.sqrt(vJ.x * vJ.x + vJ.y * vJ.y);
            if (magI < 1 || magJ < 1) continue;

            const wedgeSize = Math.min(40, magI * 0.4, magJ * 0.4);
            const pI = { x: posK.x + (vI.x / magI) * wedgeSize, y: posK.y + (vI.y / magI) * wedgeSize };
            const pJ = { x: posK.x + (vJ.x / magJ) * wedgeSize, y: posK.y + (vJ.y / magJ) * wedgeSize };

            // Calculate angles for the arc
            const angleI = Math.atan2(vI.y, vI.x);
            const angleJ = Math.atan2(vJ.y, vJ.x);

            this.ctx.save();
            this.ctx.globalAlpha = opacity;
            this.ctx.fillStyle = '#ff6b6b';
            this.ctx.strokeStyle = '#ff0000';
            this.ctx.lineWidth = 2;

            // Draw filled wedge (pie slice)
            this.ctx.beginPath();
            this.ctx.moveTo(posK.x, posK.y);
            this.ctx.lineTo(pI.x, pI.y);
            // Draw arc - determine shortest path direction
            let deltaAngle = angleJ - angleI;
            if (deltaAngle > Math.PI) deltaAngle -= 2 * Math.PI;
            if (deltaAngle < -Math.PI) deltaAngle += 2 * Math.PI;
            const counterclockwise = deltaAngle < 0;
            this.ctx.arc(posK.x, posK.y, wedgeSize, angleI, angleJ, counterclockwise);
            this.ctx.lineTo(posK.x, posK.y);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            this.ctx.restore();
        }

        // Request another frame to continue animation
        if (elapsed < 500) {
            requestAnimationFrame(() => this.render());
        }
    },

    drawColorbar() {
        this.drawColorbarToContext(this.ctx, this.canvas.width, this.canvas.height);
    },

    drawColorbarToContext(ctx, canvasWidth, canvasHeight) {
        const allRedundancies = this.edges.map(e => e.redundancy).filter(r => r !== undefined && !isNaN(r));
        if (allRedundancies.length === 0) return;

        // Color-mapping domain: fixed [0, scaleMax] or the current [min, max]
        // (auto mode), matching what getRedundancyColor uses this frame.
        const scaleCache = this._renderCache || this.refreshRenderCaches();
        const scaleMin = scaleCache.min;
        const scaleMax = scaleCache.max;

        // Get actual current min/max
        const currentMin = Math.min(...allRedundancies);
        const currentMax = Math.max(...allRedundancies);

        // Colorbar dimensions
        const barWidth = 30;
        const barHeight = 200;
        const barX = canvasWidth - barWidth - 80;
        const barY = canvasHeight - barHeight - 40;

        // Draw colorbar gradient
        const numSegments = 50;
        const segmentHeight = barHeight / numSegments;

        for (let i = 0; i < numSegments; i++) {
            const t = i / (numSegments - 1);
            const color = this.getViridisColor(t);

            ctx.fillStyle = color;
            ctx.fillRect(barX, barY + barHeight - (i + 1) * segmentHeight, barWidth, segmentHeight);
        }

        // Draw border
        ctx.strokeStyle = this.lightMode ? '#666' : '#999';
        ctx.lineWidth = 1;
        ctx.strokeRect(barX, barY, barWidth, barHeight);

        // Draw labels - theme-appropriate colors
        const labelColor = this.lightMode ? '#222' : '#e0e0e0';
        const markerColor = this.lightMode ? '#000' : '#fff';

        ctx.fillStyle = labelColor;
        ctx.font = '12px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Scale max label
        ctx.fillText(scaleMax.toFixed(3), barX + barWidth + 5, barY);

        // Scale min label
        ctx.fillText(scaleMin.toFixed(3), barX + barWidth + 5, barY + barHeight);

        // Current max marker (always show)
        const currentMaxY = barY + barHeight * (1 - (currentMax - scaleMin) / (scaleMax - scaleMin));
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barX - 5, currentMaxY);
        ctx.lineTo(barX + barWidth + 5, currentMaxY);
        ctx.stroke();

        ctx.fillStyle = markerColor;
        ctx.fillText(`${currentMax.toFixed(3)} (max)`, barX + barWidth + 5, currentMaxY - 10);

        // Current min marker (always show)
        const currentMinY = barY + barHeight * (1 - (currentMin - scaleMin) / (scaleMax - scaleMin));
        ctx.strokeStyle = markerColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(barX - 5, currentMinY);
        ctx.lineTo(barX + barWidth + 5, currentMinY);
        ctx.stroke();

        ctx.fillStyle = markerColor;
        ctx.fillText(`${currentMin.toFixed(3)} (min)`, barX + barWidth + 5, currentMinY + 10);

        // Title and range sit high enough that the "(max)" marker label
        // (currentMaxY - 10, i.e. barY - 10 when auto-scale puts the max at
        // the top of the bar) cannot overlap them.
        ctx.fillStyle = labelColor;
        ctx.font = 'bold 13px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Redundancy', barX + barWidth / 2, barY - 45);

        // Range display
        const range = currentMax - currentMin;
        ctx.font = '12px monospace';
        ctx.fillText(`Range: ${range.toFixed(4)}`, barX + barWidth / 2, barY - 30);
    },

    getViridisColor(t) {
        // Viridis color interpolation (0 to 1)
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

    drawGrid() {
        this.ctx.strokeStyle = this.lightMode ? '#dddddd' : '#2a2a2a';
        this.ctx.lineWidth = 1;

        const gridSize = 1.0;
        const startX = Math.floor((0 - this.offsetX - this.centerX / this.scale) / gridSize) * gridSize;
        const endX = Math.ceil((this.canvas.width - this.centerX) / this.scale - this.offsetX / gridSize) * gridSize;
        const startY = Math.floor((-(this.canvas.height - this.centerY) / this.scale - this.offsetY) / gridSize) * gridSize;
        const endY = Math.ceil((this.centerY / this.scale - this.offsetY) / gridSize) * gridSize;

        const viewPlane = this.config?.view_plane || 'XZ';

        // Draw vertical lines (along X axis)
        for (let x = startX; x <= endX; x += gridSize) {
            let p1, p2;
            if (viewPlane === 'XZ') {
                p1 = this.worldToScreen(x, 0, startY);
                p2 = this.worldToScreen(x, 0, endY);
            } else { // XY
                p1 = this.worldToScreen(x, startY, 0);
                p2 = this.worldToScreen(x, endY, 0);
            }
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
        }

        // Draw horizontal lines (along Y or Z axis depending on view plane)
        for (let y = startY; y <= endY; y += gridSize) {
            let p1, p2;
            if (viewPlane === 'XZ') {
                p1 = this.worldToScreen(startX, 0, y);
                p2 = this.worldToScreen(endX, 0, y);
            } else { // XY
                p1 = this.worldToScreen(startX, y, 0);
                p2 = this.worldToScreen(endX, y, 0);
            }
            this.ctx.beginPath();
            this.ctx.moveTo(p1.x, p1.y);
            this.ctx.lineTo(p2.x, p2.y);
            this.ctx.stroke();
        }
    },

    // Read a CSS theme variable (e.g. --canvas-bg); if it is not defined,
    // the caller's light/dark fallback applies.
    themeColor(name, fallback) {
        if (!this._themePalette) this._themePalette = {};
        if (!(name in this._themePalette)) {
            this._themePalette[name] = getComputedStyle(document.body)
                .getPropertyValue('--' + name).trim();
        }
        return this._themePalette[name] || fallback;
    },

    themeHex(name, fallback) {
        // THREE.js wants 0xRRGGBB; only #rrggbb variables are converted
        const c = this.themeColor(name, '');
        return /^#[0-9a-f]{6}$/i.test(c) ? parseInt(c.slice(1), 16) : fallback;
    },

    toggleTheme() {
        const body = document.body;
        const themeBtn = document.getElementById('theme-toggle-btn');

        if (this.lightMode) {
            body.classList.add('light-mode');
            themeBtn.textContent = 'Light';
        } else {
            body.classList.remove('light-mode');
            themeBtn.textContent = 'Dark';
        }

        // Update 3D scene colors if in 3D mode
        if (this.view3D && this.renderer) {
            const bgColor = this.lightMode ? 0xffffff : 0x1a1a1a;
            this.renderer.setClearColor(bgColor);

            // Update grid color
            if (this.scene) {
                const gridColor = this.lightMode ? 0xdddddd : 0x2a2a2a;
                this.scene.children.forEach(child => {
                    if (child instanceof THREE.GridHelper) {
                        child.material.color.setHex(gridColor);
                    }
                });
            }
        }

        // Re-render 2D canvas
        if (!this.view3D) {
            this.render();
        }
    },

    toggleGrid() {
        // Update 3D scene grid visibility
        if (this.view3D && this.scene) {
            this.scene.children.forEach(child => {
                if (child instanceof THREE.GridHelper) {
                    child.visible = this.showGrid;
                }
            });
        }

        // Re-render 2D canvas
        if (!this.view3D) {
            this.render();
        }
    }
};
