// Editor - Edit mode, node/edge CRUD, popups, topology modification, undo/redo

export const EditorMixin = {
    // ------------------------------------------------------------------
    // Undo / redo: snapshot stack of the full editable state
    // ------------------------------------------------------------------

    _snapshotState() {
        return {
            nodes: this.nodes.map(n => ({
                ...n,
                dirichlet_bc: n.dirichlet_bc ? [...n.dirichlet_bc] : n.dirichlet_bc,
            })),
            edges: this.edges.map(e => ({ ...e })),
        };
    },

    pushUndoState() {
        this._undoStack.push(this._snapshotState());
        if (this._undoStack.length > 50) this._undoStack.shift();
        this._redoStack.length = 0;
    },

    _restoreState(snapshot) {
        this.nodes = snapshot.nodes.map(n => ({
            ...n,
            dirichlet_bc: n.dirichlet_bc ? [...n.dirichlet_bc] : n.dirichlet_bc,
        }));
        this.edges = snapshot.edges.map(e => ({ ...e }));

        this.selectedNode = null;
        this.selectedEdge = null;
        this.hoveredEdge = null;
        this.hideNodeBCPopup();
        this.hideEdgePopup();

        this._topologyVersion++;
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();
        this.refreshPolicyAfterTopologyEdit();
        this.updateUI();
        if (this.view3D && this.scene) {
            this.build3DScene();
        }
        this.render();
    },

    undo() {
        if (this._undoStack.length === 0) return;
        this._redoStack.push(this._snapshotState());
        this._restoreState(this._undoStack.pop());
    },

    redo() {
        if (this._redoStack.length === 0) return;
        this._undoStack.push(this._snapshotState());
        this._restoreState(this._redoStack.pop());
    },

    toggleEditMode() {
        this.editMode = !this.editMode;
        this.selectedNode = null;
        this.hoveredEdge = null;
        this.hideNodeBCPopup();
        this.hideEdgePopup();

        const btn = document.getElementById('edit-toggle-btn');
        const help = document.getElementById('edit-help');
        if (this.editMode) {
            btn.textContent = 'Edit: ON';
            btn.classList.add('active');
            this.canvas.style.cursor = 'crosshair';
            help.style.display = 'block';
        } else {
            btn.textContent = 'Edit';
            btn.classList.remove('active');
            this.canvas.style.cursor = 'default';
            help.style.display = 'none';
        }
        this.render();
    },

    showNodeBCPopup(node, sx, sy) {
        const popup = document.getElementById('node-bc-popup');

        // Position popup near the node
        popup.style.left = (sx + 20) + 'px';
        popup.style.top = (sy - 20) + 'px';
        popup.style.display = 'block';

        // Update node ID display
        document.getElementById('bc-node-id').textContent = node.id;

        // Clone and replace checkboxes to remove old listeners
        const bcFixed = document.getElementById('bc-fixed');
        const bcX = document.getElementById('bc-x');
        const bcY = document.getElementById('bc-y');
        const bcZ = document.getElementById('bc-z');

        const newBcFixed = bcFixed.cloneNode(true);
        const newBcX = bcX.cloneNode(true);
        const newBcY = bcY.cloneNode(true);
        const newBcZ = bcZ.cloneNode(true);
        bcFixed.parentNode.replaceChild(newBcFixed, bcFixed);
        bcX.parentNode.replaceChild(newBcX, bcX);
        bcY.parentNode.replaceChild(newBcY, bcY);
        bcZ.parentNode.replaceChild(newBcZ, bcZ);

        // Set checkbox states from node data
        const bc = node.dirichlet_bc || [0, 0, 0];
        newBcFixed.checked = node.fixed === true;
        newBcX.checked = bc[0] === 1;
        newBcY.checked = bc[1] === 1;
        newBcZ.checked = bc[2] === 1;

        // Set up event listeners
        newBcFixed.addEventListener('change', () => {
            this.pushUndoState();
            node.fixed = newBcFixed.checked;
            // The moveable set feeds the GNN observation - refresh the cache.
            this.refreshPolicyAfterTopologyEdit();
            if (this.view3D && this.scene) {
                this.build3DScene();
            }
            this.render();
        });

        const updateBC = () => {
            this.pushUndoState();
            // The popup edits translations only; beams keep their rotation
            // entries (a 3-entry BC would make the beam solver fall back to
            // fully clamped / fully free).
            const isBeam = this.config && this.config.type === 'beam';
            const prevBC = node.dirichlet_bc || [];
            const rotBC = isBeam
                ? (prevBC.length === 6 ? prevBC.slice(3) : [0, 0, 0])
                : [];
            node.dirichlet_bc = [
                newBcX.checked ? 1 : 0,
                newBcY.checked ? 1 : 0,
                newBcZ.checked ? 1 : 0,
                ...rotBC
            ];
            // Reinitialize calculator and update
            this.initializeRedundancyCalculator();
            this.updateRedundancyValues();
            // BC flags feed the GNN node features - refresh the cache.
            this.refreshPolicyAfterTopologyEdit();
            this.render();
        };

        newBcX.addEventListener('change', updateBC);
        newBcY.addEventListener('change', updateBC);
        newBcZ.addEventListener('change', updateBC);
    },

    hideNodeBCPopup() {
        document.getElementById('node-bc-popup').style.display = 'none';
    },

    showEdgePopup(edge, sx, sy) {
        const popup = document.getElementById('edge-popup');

        // Position popup near the click
        popup.style.left = (sx + 20) + 'px';
        popup.style.top = (sy - 20) + 'px';
        popup.style.display = 'block';

        // Update edge info
        document.getElementById('edge-popup-id').textContent = edge.id;
        document.getElementById('edge-popup-nodes').textContent = `Node ${edge.source} → Node ${edge.target}`;

        // Clone and replace input to remove old listeners
        const stiffnessInput = document.getElementById('edge-stiffness');
        const newStiffnessInput = stiffnessInput.cloneNode(true);
        stiffnessInput.parentNode.replaceChild(newStiffnessInput, stiffnessInput);

        // Set current value
        newStiffnessInput.value = edge.stiffness;

        // Set up event listener
        newStiffnessInput.addEventListener('change', () => {
            const newValue = parseFloat(newStiffnessInput.value);
            if (!isNaN(newValue) && newValue > 0) {
                this.pushUndoState();
                edge.stiffness = newValue;
                // Reinitialize calculator and update
                this.initializeRedundancyCalculator();
                this.updateRedundancyValues();
                // Stiffness ratios feed the GNN edge features - refresh.
                this.refreshPolicyAfterTopologyEdit();
                if (this.view3D && this.scene) {
                    this.update3DScene();
                }
                this.render();
            }
        });

        this.selectedEdge = edge;
    },

    hideEdgePopup() {
        document.getElementById('edge-popup').style.display = 'none';
        this.selectedEdge = null;
    },

    markTopologyModified() {
        this.topologyModified = true;
        this._topologyVersion++;

        // The GNN policy is topology-agnostic (shared parameters across
        // arbitrary graphs): its graph cache is rebuilt in
        // refreshPolicyAfterTopologyEdit() once the new redundancy values are
        // available, and policy mode stays enabled.
    },

    addNode(x, y, z) {
        this.pushUndoState();
        const newId = this.nodes.length;
        const newNode = {
            id: newId,
            x: x,
            y: y,
            z: z,
            fixed: false,
            dirichlet_bc: [0, 0, 0],
            radius: 0.15
        };
        this.nodes.push(newNode);

        this.markTopologyModified();

        // Reinitialize calculator and update
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();
        this.refreshPolicyAfterTopologyEdit();
        this.updateUI();
        if (this.view3D && this.scene) {
            this.build3DScene();
        }
        this.render();
    },

    removeNode(nodeId) {
        if (this.nodes.length <= 2) {
            console.warn('Cannot remove node: minimum 2 nodes required');
            return;
        }

        this.pushUndoState();

        // Remove all edges connected to this node
        this.edges = this.edges.filter(e => e.source !== nodeId && e.target !== nodeId);

        // Remove the node
        this.nodes = this.nodes.filter(n => n.id !== nodeId);

        // Reindex nodes; edge endpoints above the removed index shift down
        this.nodes.forEach((n, i) => n.id = i);
        this.edges.forEach(e => {
            if (e.source > nodeId) e.source--;
            if (e.target > nodeId) e.target--;
        });

        // Reindex edge ids
        this.edges.forEach((e, i) => e.id = i);

        this.selectedNode = null;
        this.markTopologyModified();

        // Reinitialize calculator and update
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();
        this.refreshPolicyAfterTopologyEdit();
        this.updateUI();
        if (this.view3D && this.scene) {
            this.build3DScene();
        }
        this.render();
    },

    addEdge(sourceId, targetId) {
        // Check if edge already exists
        const exists = this.edges.some(e =>
            (e.source === sourceId && e.target === targetId) ||
            (e.source === targetId && e.target === sourceId)
        );
        if (exists) {
            console.warn('Edge already exists');
            return;
        }

        this.pushUndoState();

        // Use the same stiffness as existing edges (or default)
        const defaultStiffness = this.edges.length > 0 ? this.edges[0].stiffness : 1.0;

        const newId = this.edges.length;
        const newEdge = {
            id: newId,
            source: sourceId,
            target: targetId,
            stiffness: defaultStiffness,
            redundancy: 0
        };
        this.edges.push(newEdge);
        this.markTopologyModified();

        // Reinitialize calculator and update
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();
        this.refreshPolicyAfterTopologyEdit();
        this.updateUI();
        if (this.view3D && this.scene) {
            this.build3DScene();
        }
        this.render();
    },

    removeEdge(edgeId) {
        if (this.edges.length <= 1) {
            console.warn('Cannot remove edge: minimum 1 edge required');
            return;
        }

        this.pushUndoState();

        this.edges = this.edges.filter(e => e.id !== edgeId);

        // Reindex edge ids
        this.edges.forEach((e, i) => e.id = i);

        this.hoveredEdge = null;
        this.markTopologyModified();

        // Reinitialize calculator and update
        this.initializeRedundancyCalculator();
        this.updateRedundancyValues();
        this.refreshPolicyAfterTopologyEdit();
        this.updateUI();
        if (this.view3D && this.scene) {
            this.build3DScene();
        }
        this.render();
    }
};
