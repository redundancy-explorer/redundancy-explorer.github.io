// Events - Event listener setup and mouse handlers

export const EventsMixin = {
    setupEventListeners() {
        // Mouse events for dragging
        this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        this.canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));

        // Button controls
        document.getElementById('reset-btn').addEventListener('click', () => this.reset());
        document.getElementById('step-btn').addEventListener('click', () => this.agentStep());
        document.getElementById('auto-btn').addEventListener('click', () => this.toggleAutoStep());

        // Speed slider
        const speedSlider = document.getElementById('speed-slider');
        speedSlider.addEventListener('input', (e) => {
            this.stepSpeed = parseInt(e.target.value);
            document.getElementById('speed-value').textContent = `${this.stepSpeed}ms`;
            if (this.autoStepping) {
                this.stopAutoStep();
                this.startAutoStep();
            }
        });

        // Learning rate slider
        const learningRateSlider = document.getElementById('learning-rate-slider');
        learningRateSlider.addEventListener('input', (e) => {
            this.learningRate = parseFloat(e.target.value);
            document.getElementById('learning-rate-value').textContent = this.learningRate.toFixed(3);
        });

        // Gradient epsilon slider
        const epsilonSlider = document.getElementById('epsilon-slider');
        epsilonSlider.addEventListener('input', (e) => {
            this.gradientEpsilon = parseFloat(e.target.value);
            document.getElementById('epsilon-value').textContent = this.gradientEpsilon.toFixed(5);
        });

        // Redundancy weight slider
        const redundancyWeightSlider = document.getElementById('redundancy-weight-slider');
        redundancyWeightSlider.addEventListener('input', (e) => {
            this.redundancyWeight = parseFloat(e.target.value);
            document.getElementById('redundancy-weight-value').textContent = this.redundancyWeight.toFixed(2);
        });

        // Segment length weight slider
        const segmentWeightSlider = document.getElementById('segment-weight-slider');
        segmentWeightSlider.addEventListener('input', (e) => {
            this.segmentLengthWeight = parseFloat(e.target.value);
            document.getElementById('segment-weight-value').textContent = this.segmentLengthWeight.toFixed(2);
        });

        // Target segment length slider
        const targetSegmentSlider = document.getElementById('target-segment-slider');
        targetSegmentSlider.addEventListener('input', (e) => {
            this.targetSegmentLength = parseFloat(e.target.value);
            document.getElementById('target-segment-value').textContent = this.targetSegmentLength.toFixed(2);
        });

        // Min/Max segment length weight slider
        const minMaxWeightSlider = document.getElementById('minmax-weight-slider');
        minMaxWeightSlider.addEventListener('input', (e) => {
            this.minMaxSegmentLengthWeight = parseFloat(e.target.value);
            document.getElementById('minmax-weight-value').textContent = this.minMaxSegmentLengthWeight.toFixed(2);
        });

        // Min segment length slider
        const minSegmentSlider = document.getElementById('min-segment-slider');
        minSegmentSlider.addEventListener('input', (e) => {
            this.minSegmentLength = parseFloat(e.target.value);
            document.getElementById('min-segment-value').textContent = this.minSegmentLength.toFixed(2);
        });

        // Max segment length slider
        const maxSegmentSlider = document.getElementById('max-segment-slider');
        maxSegmentSlider.addEventListener('input', (e) => {
            this.maxSegmentLength = parseFloat(e.target.value);
            document.getElementById('max-segment-value').textContent = this.maxSegmentLength.toFixed(2);
        });

        // Angle weight slider
        const angleWeightSlider = document.getElementById('angle-weight-slider');
        angleWeightSlider.addEventListener('input', (e) => {
            this.angleWeight = parseFloat(e.target.value);
            document.getElementById('angle-weight-value').textContent = this.angleWeight.toFixed(2);
        });

        // Min angle slider
        const minAngleSlider = document.getElementById('min-angle-slider');
        minAngleSlider.addEventListener('input', (e) => {
            this.minAngle = parseFloat(e.target.value);
            document.getElementById('min-angle-value').textContent = this.minAngle.toFixed(0) + '°';
        });

        // Max angle slider
        const maxAngleSlider = document.getElementById('max-angle-slider');
        maxAngleSlider.addEventListener('input', (e) => {
            this.maxAngle = parseFloat(e.target.value);
            document.getElementById('max-angle-value').textContent = this.maxAngle.toFixed(0) + '°';
        });

        // Cross-section adaptation weight slider
        const csWeightSlider = document.getElementById('cross-section-weight-slider');
        csWeightSlider.addEventListener('input', (e) => {
            this.crossSectionWeight = parseFloat(e.target.value);
            document.getElementById('cross-section-weight-value').textContent = this.crossSectionWeight.toFixed(2);
        });

        // Cross-section gamma slider
        const csGammaSlider = document.getElementById('cross-section-gamma-slider');
        csGammaSlider.addEventListener('input', (e) => {
            this.crossSectionGamma = parseFloat(e.target.value);
            document.getElementById('cross-section-gamma-value').textContent = this.crossSectionGamma.toFixed(2);
        });

        // Geometry export / import
        document.getElementById('export-geometry-btn').addEventListener('click', () => {
            this.exportGeometry();
        });
        const importInput = document.getElementById('import-geometry-input');
        document.getElementById('import-geometry-btn').addEventListener('click', () => {
            importInput.value = '';  // allow re-importing the same file
            importInput.click();
        });
        importInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) this.importGeometryFile(file);
        });

        // Keyboard shortcuts (undo/redo, delete, escape)
        window.addEventListener('keydown', (e) => this.onKeyDown(e));

        // 3D view toggle button
        const viewToggleBtn = document.getElementById('view-toggle-btn');
        viewToggleBtn.addEventListener('click', () => {
            this.view3D = !this.view3D;
            if (this.view3D) {
                viewToggleBtn.textContent = '3D';
                viewToggleBtn.classList.add('active');
                this.init3D();
            } else {
                viewToggleBtn.textContent = '2D';
                viewToggleBtn.classList.remove('active');
                this.destroy3D();
            }
            this.render();
        });

        // Values toggle button
        const valuesToggleBtn = document.getElementById('values-toggle-btn');
        valuesToggleBtn.addEventListener('click', () => {
            this.showRedundancyLabels = !this.showRedundancyLabels;
            if (this.showRedundancyLabels) {
                valuesToggleBtn.classList.add('active');
            } else {
                valuesToggleBtn.classList.remove('active');
            }
            // Update both 2D and 3D views
            this.render();
            if (this.renderer && this.scene) {
                this.update3DScene();
            }
        });

        // Grid toggle button
        const gridToggleBtn = document.getElementById('grid-toggle-btn');
        gridToggleBtn.addEventListener('click', () => {
            this.showGrid = !this.showGrid;
            if (this.showGrid) {
                gridToggleBtn.classList.add('active');
            } else {
                gridToggleBtn.classList.remove('active');
            }
            this.toggleGrid();
        });

        // Theme toggle button
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        themeToggleBtn.addEventListener('click', () => {
            this.lightMode = !this.lightMode;
            this.toggleTheme();
        });

        // Color scale toggle button (fixed vs auto-ranged colorbar);
        // constant label, the active state shows on/off (like Grid)
        const scaleToggleBtn = document.getElementById('scale-toggle-btn');
        scaleToggleBtn.addEventListener('click', () => {
            this.colorScaleAuto = !this.colorScaleAuto;
            scaleToggleBtn.classList.toggle('active', this.colorScaleAuto);
            this.render();
            if (this.view3D && this.renderer && this.scene) {
                this.update3DScene();
            }
        });

        // Thickness toggle button (element thickness encodes EA / mean EA)
        const thicknessToggleBtn = document.getElementById('thickness-toggle-btn');
        thicknessToggleBtn.addEventListener('click', () => {
            this.showThickness = !this.showThickness;
            thicknessToggleBtn.classList.toggle('active', this.showThickness);
            this.render();
            if (this.view3D && this.renderer && this.scene) {
                this.update3DScene();
            }
        });

        // Policy toggle button
        const policyToggleBtn = document.getElementById('policy-toggle-btn');
        policyToggleBtn.addEventListener('click', () => {
            this.togglePolicyMode();
        });

        // Edit mode toggle button
        const editToggleBtn = document.getElementById('edit-toggle-btn');
        editToggleBtn.addEventListener('click', () => {
            this.toggleEditMode();
        });

        // Geometry selector
        const geometrySelector = document.getElementById('geometry-selector');
        geometrySelector.addEventListener('change', (e) => {
            this.switchGeometry(e.target.value);
        });
    },

    onKeyDown(e) {
        // Don't intercept typing in form controls
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

        // Undo / redo
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.undo();
                return;
            }
            if (key === 'y' || (key === 'z' && e.shiftKey)) {
                e.preventDefault();
                this.redo();
                return;
            }
        }

        // Delete current selection (edit mode)
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.editMode) {
            if (this.selectedNode) {
                const id = this.selectedNode.id;
                this.selectedNode = null;
                this.hideNodeBCPopup();
                this.removeNode(id);
            } else if (this.selectedEdge) {
                const id = this.selectedEdge.id;
                this.hideEdgePopup();
                this.removeEdge(id);
            }
            e.preventDefault();
            return;
        }

        // Escape clears selection state and popups
        if (e.key === 'Escape') {
            this.selectedNode = null;
            this.hoveredEdge = null;
            this.hideNodeBCPopup();
            this.hideEdgePopup();
            this.render();
        }
    },

    worldToScreen(x, y, z) {
        // Use view plane from config (default to XZ if not specified)
        const viewPlane = this.config?.view_plane || 'XZ';
        const displayY = viewPlane === 'XZ' ? z : y;

        return {
            x: this.centerX + (x + this.offsetX) * this.scale,
            y: this.centerY - (displayY + this.offsetY) * this.scale // Flip Y for screen coords
        };
    },

    screenToWorld(sx, sy) {
        const viewPlane = this.config?.view_plane || 'XZ';
        const worldX = (sx - this.centerX) / this.scale - this.offsetX;
        const worldY = -(sy - this.centerY) / this.scale - this.offsetY;

        if (viewPlane === 'XZ') {
            return {
                x: worldX,
                y: 0,
                z: worldY
            };
        } else { // XY
            return {
                x: worldX,
                y: worldY,
                z: 0
            };
        }
    },

    findNodeAtPosition(sx, sy) {
        for (let node of this.nodes) {
            const screenPos = this.worldToScreen(node.x, node.y, node.z);
            const dx = sx - screenPos.x;
            const dy = sy - screenPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < node.radius * this.scale * 3) { // Larger hit area
                return node;
            }
        }
        return null;
    },

    findEdgeAtPosition(sx, sy) {
        const threshold = 10; // pixels
        for (let edge of this.edges) {
            const source = this.nodes[edge.source];
            const target = this.nodes[edge.target];
            const p1 = this.worldToScreen(source.x, source.y, source.z);
            const p2 = this.worldToScreen(target.x, target.y, target.z);

            // Calculate distance from point to line segment
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const lengthSq = dx * dx + dy * dy;

            if (lengthSq === 0) continue;

            // Project point onto line
            const t = Math.max(0, Math.min(1, ((sx - p1.x) * dx + (sy - p1.y) * dy) / lengthSq));
            const projX = p1.x + t * dx;
            const projY = p1.y + t * dy;

            const distance = Math.sqrt((sx - projX) * (sx - projX) + (sy - projY) * (sy - projY));
            if (distance < threshold) {
                return edge;
            }
        }
        return null;
    },

    onMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        const node = this.findNodeAtPosition(sx, sy);
        const edge = this.findEdgeAtPosition(sx, sy);

        if (this.editMode) {
            // Edit mode interactions
            if (e.shiftKey && node) {
                // Shift+click node: delete node and connected edges
                this.removeNode(node.id);
                this.selectedNode = null;
                this.hideNodeBCPopup();
                return;
            }

            if (node) {
                this.hideEdgePopup();
                if (this.selectedNode === null) {
                    // First node click: select for edge creation and show BC editor
                    this.selectedNode = node;
                    this.showNodeBCPopup(node, sx, sy);
                    this.render();
                } else if (this.selectedNode.id !== node.id) {
                    // Second node click: create edge
                    this.addEdge(this.selectedNode.id, node.id);
                    this.selectedNode = null;
                    this.hideNodeBCPopup();
                } else {
                    // Clicked same node: deselect
                    this.selectedNode = null;
                    this.hideNodeBCPopup();
                    this.render();
                }
                return;
            }

            if (edge) {
                if (e.shiftKey) {
                    // Shift+click on edge: delete it
                    this.removeEdge(edge.id);
                } else {
                    // Click on edge: toggle properties popup
                    if (this.selectedEdge && this.selectedEdge.id === edge.id) {
                        this.hideEdgePopup();
                    } else {
                        this.showEdgePopup(edge, sx, sy);
                    }
                }
                this.selectedNode = null;
                this.hideNodeBCPopup();
                return;
            }

            // Click on empty space: create new node
            const worldPos = this.screenToWorld(sx, sy);
            this.addNode(worldPos.x, worldPos.y, worldPos.z);
            this.selectedNode = null;
            this.hideNodeBCPopup();
            this.hideEdgePopup();
            return;
        }

        // Normal mode: drag nodes (only if not fixed)
        if (node && !node.fixed) {
            this.pushUndoState();  // one undo entry per drag
            this.draggedNode = node;
            this.isDragging = true;
            this.canvas.style.cursor = 'grabbing';
        }
    },

    onMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;

        this.mousePos = { x: sx, y: sy };

        if (this.isDragging && this.draggedNode) {
            const worldPos = this.screenToWorld(sx, sy);
            this.draggedNode.x = worldPos.x;
            this.draggedNode.y = worldPos.y;
            this.draggedNode.z = worldPos.z;

            // Recalculate redundancy in real-time
            this.updateRedundancyValues();

            this.render();
        } else {
            // Check for hover
            const node = this.findNodeAtPosition(sx, sy);
            this.hoveredNode = node;

            // Check for edge hover in edit mode
            if (this.editMode && !node) {
                this.hoveredEdge = this.findEdgeAtPosition(sx, sy);
            } else {
                this.hoveredEdge = null;
            }

            if (this.editMode) {
                if (node) {
                    this.canvas.style.cursor = 'pointer';
                } else if (this.hoveredEdge) {
                    this.canvas.style.cursor = 'pointer';
                } else {
                    this.canvas.style.cursor = 'crosshair';
                }
            } else {
                if (node) {
                    this.canvas.style.cursor = !node.fixed ? 'grab' : 'not-allowed';
                } else {
                    this.canvas.style.cursor = 'default';
                }
            }

            this.render();
        }
    },

    onMouseUp(e) {
        if (this.isDragging) {
            this.isDragging = false;
            this.draggedNode = null;
            this.canvas.style.cursor = this.editMode ? 'crosshair' : 'default';
            this.render();
        }
    }
};
