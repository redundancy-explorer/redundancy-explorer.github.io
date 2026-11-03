// Render3D - 3D rendering with Three.js

export const Render3DMixin = {
    init3D() {
        const container = this.canvas.parentElement;

        // Hide 2D canvas
        this.canvas.style.display = 'none';

        // Create Three.js renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        const bgColor = this.themeHex('canvas-bg', this.lightMode ? 0xffffff : 0x1a1a1a);
        this.renderer.setClearColor(bgColor, 1);
        this.renderer.domElement.style.position = 'absolute';
        this.renderer.domElement.style.top = '0';
        this.renderer.domElement.style.left = '0';
        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.zIndex = '1';
        this.renderer.domElement.id = 'webgl-renderer';
        container.appendChild(this.renderer.domElement);

        // Create CSS2D renderer for labels
        this.labelRenderer = new THREE.CSS2DRenderer();
        this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.left = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        this.labelRenderer.domElement.style.zIndex = '2';
        container.appendChild(this.labelRenderer.domElement);

        // Create scene
        this.scene = new THREE.Scene();

        // Create camera
        this.camera = new THREE.PerspectiveCamera(
            60,
            container.clientWidth / container.clientHeight,
            0.1,
            1000
        );
        this.camera.position.set(8, 8, 8);
        this.camera.lookAt(0, 0, 0);

        // Orient the camera up-axis (z for beams) BEFORE creating OrbitControls:
        // r128 OrbitControls captures the up vector once at construction, so it
        // must already be correct or orbiting rotates about the wrong axis.
        this.applyUpAxis();
        this.createOrbitControls();

        // Add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 10);
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-10, -10, -10);
        this.scene.add(directionalLight2);

        // Initialize raycaster for node interaction
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Setup 3D event listeners
        this.setup3DEventListeners();

        // Build 3D scene
        this.build3DScene();

        // Frame the camera to the current geometry (up-axis + auto-fit zoom)
        this.frameCamera();

        // Start animation loop
        this.animate3D();
    },

    // Set the camera's up vector from config (engineering z-up for beams; else
    // default y-up) and record which axis the current OrbitControls was built
    // for. r128 OrbitControls captures the up vector at construction, so any
    // change of up-axis must be paired with createOrbitControls().
    applyUpAxis() {
        const upAxis = (this.config && this.config.up_axis) || 'y';
        if (upAxis === 'z') this.camera.up.set(0, 0, 1);
        else if (upAxis === 'x') this.camera.up.set(1, 0, 0);
        else this.camera.up.set(0, 1, 0);
        this.controlsUpAxis = upAxis;
    },

    createOrbitControls() {
        if (this.controls) this.controls.dispose();
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.screenSpacePanning = false;
        this.controls.minDistance = 2;
        this.controls.maxDistance = 50;
    },

    // Keep the up-axis/controls in sync with the geometry, and auto-fit the
    // camera ONLY for geometries that opt in via config.auto_fit (large ones
    // like BUGA). Other examples keep their original fixed camera.
    frameCamera() {
        if (!this.camera || !this.controls || !this.nodes || this.nodes.length === 0) return;

        // Rebuild controls if the up-axis changed (e.g. truss <-> beam switch).
        const upAxis = (this.config && this.config.up_axis) || 'y';
        if (upAxis !== this.controlsUpAxis) {
            this.applyUpAxis();
            this.createOrbitControls();
            // Reset to the default framing for the new orientation.
            this.camera.position.set(8, 8, 8);
            this.controls.target.set(0, 0, 0);
            this.camera.lookAt(0, 0, 0);
        }

        if (!(this.config && this.config.auto_fit)) {
            this.controls.update();
            return;
        }

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const n of this.nodes) {
            minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
            minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
            minZ = Math.min(minZ, n.z); maxZ = Math.max(maxZ, n.z);
        }
        const center = new THREE.Vector3(
            (minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2
        );
        const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
        const size = Math.max(dx, dy, dz, 1e-3);

        // Distance to fit the bounding sphere in the camera's vertical FOV
        // (20% margin).
        const radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
        const fov = (this.camera.fov * Math.PI) / 180;
        const distance = (radius / Math.sin(fov / 2)) * 1.2;

        // View from a diagonal that keeps the up-axis vertical on screen.
        const dir = (upAxis === 'z')
            ? new THREE.Vector3(1, 1, 0.6).normalize()
            : new THREE.Vector3(1, 0.6, 1).normalize();

        this.camera.position.copy(center).add(dir.multiplyScalar(distance));
        this.controls.target.copy(center);
        this.camera.lookAt(center);

        this.controls.minDistance = Math.max(0.5, size * 0.05);
        this.controls.maxDistance = distance * 4;
        this.controls.update();
    },

    destroy3D() {

        // Stop animation
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Remove colorbar canvas overlay
        if (this.colorbarCanvas) {
            const container = this.canvas.parentElement;
            if (this.colorbarCanvas.parentElement === container) {
                container.removeChild(this.colorbarCanvas);
            }
            this.colorbarCanvas = null;
        }

        // Remove label renderer
        if (this.labelRenderer) {
            const container = this.canvas.parentElement;
            if (this.labelRenderer.domElement.parentElement === container) {
                container.removeChild(this.labelRenderer.domElement);
            }
            this.labelRenderer = null;
        }

        // Remove renderer
        if (this.renderer) {
            const container = this.canvas.parentElement;
            container.removeChild(this.renderer.domElement);
            this.renderer.dispose();
            this.renderer = null;
        }

        // Clean up 3D objects
        this.scene = null;
        this.camera = null;
        this.controls = null;
        this.nodeMeshes = [];
        this.edgeMeshes = [];
        this.raycaster = null;
        this.mouse = null;

        // Show 2D canvas
        this.canvas.style.display = 'block';
    },

    build3DScene() {
        // Refresh the per-frame render caches (color scale, mean stiffness)
        this.refreshRenderCaches();

        // Clear existing meshes
        this.nodeMeshes = [];
        this.edgeMeshes = [];
        this.edgeLabels = [];

        // Remove all children from scene
        while (this.scene.children.length > 0) {
            const child = this.scene.children[0];
            if (child.geometry) child.geometry.dispose();
            if (child.material) child.material.dispose();
            this.scene.remove(child);
        }

        // Re-add lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(10, 10, 10);
        this.scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        directionalLight2.position.set(-10, -10, -10);
        this.scene.add(directionalLight2);

        // Create edges (cylinders)
        for (let edge of this.edges) {
            const source = this.nodes[edge.source];
            const target = this.nodes[edge.target];

            const start = new THREE.Vector3(source.x, source.y, source.z);
            const end = new THREE.Vector3(target.x, target.y, target.z);
            const direction = new THREE.Vector3().subVectors(end, start);
            const length = direction.length();

            // Get color from redundancy
            const colorStr = this.getRedundancyColor(edge.redundancy);
            const color = new THREE.Color(colorStr);

            // Create cylinder with initial length of 1.0
            const geometry = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8);
            const material = new THREE.MeshPhongMaterial({ color: color });
            const cylinder = new THREE.Mesh(geometry, material);

            // Position and rotate cylinder
            const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
            cylinder.position.copy(midpoint);

            // Align cylinder with edge direction
            const axis = new THREE.Vector3(0, 1, 0);
            cylinder.quaternion.setFromUnitVectors(axis, direction.clone().normalize());

            // Scale to actual length; radius encodes stiffness when enabled
            cylinder.scale.y = length;
            const thickness = this.getThicknessFactor(edge);
            cylinder.scale.x = thickness;
            cylinder.scale.z = thickness;

            cylinder.userData = { edge: edge };
            this.edgeMeshes.push(cylinder);
            this.scene.add(cylinder);

            // Create label for this edge
            const labelDiv = document.createElement('div');
            labelDiv.className = 'edge-label-3d';
            labelDiv.textContent = edge.redundancy.toFixed(3);
            labelDiv.style.color = this.themeColor('label-text', '#ffffff');
            labelDiv.style.fontSize = '12px';
            labelDiv.style.fontFamily = 'monospace';
            labelDiv.style.fontWeight = 'bold';
            labelDiv.style.backgroundColor = this.themeColor('label-bg', 'rgba(42, 42, 42, 0.95)');
            labelDiv.style.padding = '4px 8px';
            labelDiv.style.borderRadius = '4px';
            labelDiv.style.border = `2px solid ${colorStr}`;
            labelDiv.style.pointerEvents = 'none';
            labelDiv.style.userSelect = 'none';

            const label = new THREE.CSS2DObject(labelDiv);
            label.position.copy(midpoint);
            label.visible = this.showRedundancyLabels;
            labelDiv.style.display = this.showRedundancyLabels ? 'block' : 'none';
            this.edgeLabels.push(label);
            this.scene.add(label);
        }

        // Create nodes (spheres)
        this.fixedNodeRings = [];
        for (let node of this.nodes) {
            const radius = node.radius || 0.15;
            const geometry = new THREE.SphereGeometry(radius, 32, 32);

            const dirichletBC = node.dirichlet_bc || [0, 0, 0];
            const hasXYConstraint = dirichletBC[0] === 1 || dirichletBC[1] === 1;
            const color = hasXYConstraint
                ? this.themeHex('node-fixed', 0x555555)
                : this.themeHex('node-free', 0xbbbbbb);
            const material = new THREE.MeshPhongMaterial({ color: color });

            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(node.x, node.y, node.z);

            sphere.userData = { node: node };
            this.nodeMeshes.push(sphere);
            this.scene.add(sphere);

            // Add ring indicator for fixed nodes
            if (node.fixed) {
                const ringGeometry = new THREE.TorusGeometry(radius * 1.5, 0.02, 8, 32);
                const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x888888 });
                const ring = new THREE.Mesh(ringGeometry, ringMaterial);
                ring.position.set(node.x, node.y, node.z);
                ring.userData = { nodeId: node.id };
                this.fixedNodeRings.push(ring);
                this.scene.add(ring);
            }
        }

        // Add grid helper. THREE.GridHelper lies in the xz-plane (y-up default).
        // For z-up geometries (beams) rotate it into the xy-plane so the ground
        // grid sits under the structure instead of standing up beside it.
        const upAxis = (this.config && this.config.up_axis) || 'y';
        const gridColor = this.themeHex('canvas-grid', this.lightMode ? 0xdddddd : 0x2a2a2a);
        const gridSize = this.gridSizeForBounds();
        const gridHelper = new THREE.GridHelper(gridSize, 20, gridColor, gridColor);
        if (upAxis === 'z') gridHelper.rotation.x = Math.PI / 2;
        this.scene.add(gridHelper);

        // Add axes helper (slightly raised off the grid to avoid z-fighting).
        const axesHelper = new THREE.AxesHelper(1);
        if (upAxis === 'z') axesHelper.position.z = 0.01;
        else axesHelper.position.y = 0.01;
        this.scene.add(axesHelper);
    },

    // Grid extent that comfortably contains the current node footprint (the two
    // horizontal axes relative to the up-axis), rounded up to a sensible size.
    gridSizeForBounds() {
        if (!this.nodes || this.nodes.length === 0) return 20;
        const upAxis = (this.config && this.config.up_axis) || 'y';
        let maxExtent = 0;
        for (const n of this.nodes) {
            const h = (upAxis === 'z') ? [n.x, n.y] : [n.x, n.z];
            maxExtent = Math.max(maxExtent, Math.abs(h[0]), Math.abs(h[1]));
        }
        return Math.max(20, Math.ceil((maxExtent * 2 * 1.2) / 5) * 5);
    },

    update3DScene() {
        // Refresh the per-frame render caches (color scale, mean stiffness)
        this.refreshRenderCaches();

        // Update node positions
        for (let i = 0; i < this.nodes.length; i++) {
            const node = this.nodes[i];
            const mesh = this.nodeMeshes[i];
            if (mesh) {
                mesh.position.set(node.x, node.y, node.z);
            }
        }

        // Update fixed node ring positions
        if (this.fixedNodeRings) {
            for (const ring of this.fixedNodeRings) {
                const node = this.nodes.find(n => n.id === ring.userData.nodeId);
                if (node) {
                    ring.position.set(node.x, node.y, node.z);
                }
            }
        }

        // Update edge positions and colors
        for (let i = 0; i < this.edges.length; i++) {
            const edge = this.edges[i];
            const mesh = this.edgeMeshes[i];
            if (mesh) {
                const source = this.nodes[edge.source];
                const target = this.nodes[edge.target];

                const start = new THREE.Vector3(source.x, source.y, source.z);
                const end = new THREE.Vector3(target.x, target.y, target.z);
                const direction = new THREE.Vector3().subVectors(end, start);
                const length = direction.length();

                // Update position
                const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                mesh.position.copy(midpoint);

                // Update rotation
                const axis = new THREE.Vector3(0, 1, 0);
                mesh.quaternion.setFromUnitVectors(axis, direction.clone().normalize());

                // Update scale (length) - cylinder base geometry has height 1.0;
                // radius encodes stiffness when thickness display is enabled
                mesh.scale.y = length;
                const thickness = this.getThicknessFactor(edge);
                mesh.scale.x = thickness;
                mesh.scale.z = thickness;

                // Update color
                const colorStr = this.getRedundancyColor(edge.redundancy);
                const color = new THREE.Color(colorStr);
                mesh.material.color = color;

                // Update label
                const label = this.edgeLabels[i];
                if (label) {
                    label.position.copy(midpoint);
                    label.element.textContent = edge.redundancy.toFixed(3);
                    label.element.style.borderColor = colorStr;
                    label.visible = this.showRedundancyLabels;
                    label.element.style.display = this.showRedundancyLabels ? 'block' : 'none';
                }
            }
        }
    },

    setup3DEventListeners() {
        const renderer = this.renderer.domElement;

        // Use pointerdown/pointermove/pointerup which work better with OrbitControls
        renderer.addEventListener('pointerdown', (e) => this.onMouse3DDown(e));
        renderer.addEventListener('pointermove', (e) => this.onMouse3DMove(e));
        renderer.addEventListener('pointerup', (e) => this.onMouse3DUp(e));
        renderer.addEventListener('pointerleave', (e) => this.onMouse3DUp(e));
    },

    onMouse3DDown(e) {
        // Calculate mouse position in normalized device coordinates
        const rect = this.renderer.domElement.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        this.mouse.x = (sx / rect.width) * 2 - 1;
        this.mouse.y = -(sy / rect.height) * 2 + 1;

        // Raycast to find intersected nodes
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.nodeMeshes);

        if (intersects.length > 0) {
            const mesh = intersects[0].object;
            const node = mesh.userData.node;

            if (this.editMode) {
                // Edit mode interactions
                if (e.shiftKey) {
                    // Shift+click node: delete node and connected edges
                    this.removeNode(node.id);
                    this.selectedNode = null;
                    this.hideNodeBCPopup();
                    return;
                }

                    this.hideEdgePopup();
                if (this.selectedNode === null) {
                    // First node click: select for edge creation and show BC editor
                    this.selectedNode = node;
                    this.showNodeBCPopup(node, sx, sy);
                } else if (this.selectedNode.id !== node.id) {
                    // Second node click: create edge
                    this.addEdge(this.selectedNode.id, node.id);
                    this.selectedNode = null;
                    this.hideNodeBCPopup();
                } else {
                    // Clicked same node: deselect
                    this.selectedNode = null;
                    this.hideNodeBCPopup();
                }
                return;
            }

            // Normal mode: drag nodes (only if not fixed)
            if (!node.fixed) {
                this.draggedNode = node;
                this.isDragging = true;
                this.controls.enabled = false; // Disable orbit controls while dragging
            }
        } else if (this.editMode) {
            // Check for edge intersection
            const edgeIntersects = this.raycaster.intersectObjects(this.edgeMeshes);
            if (edgeIntersects.length > 0) {
                const edge = edgeIntersects[0].object.userData.edge;
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

            // Click on empty space in edit mode - hide popups and deselect
            // Note: Adding nodes in 3D requires switching to 2D view
            this.selectedNode = null;
            this.hideNodeBCPopup();
            this.hideEdgePopup();
        }
    },

    onMouse3DMove(e) {
        if (!this.isDragging || !this.draggedNode) return;

        // Calculate mouse position
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        // Create plane perpendicular to camera at node position
        const nodePos = new THREE.Vector3(this.draggedNode.x, this.draggedNode.y, this.draggedNode.z);
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);

        const plane = new THREE.Plane();
        plane.setFromNormalAndCoplanarPoint(cameraDirection, nodePos);

        // Raycast to plane
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersection = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(plane, intersection);

        if (intersection) {
            // Update node position
            this.draggedNode.x = intersection.x;
            this.draggedNode.y = intersection.y;
            this.draggedNode.z = intersection.z;

            // Update redundancy
            this.updateRedundancyValues();

            // Update 3D scene
            this.update3DScene();
        }
    },

    onMouse3DUp(e) {
        this.draggedNode = null;
        this.isDragging = false;
        this.controls.enabled = true; // Re-enable orbit controls
    },

    updateAngleViolations3D() {
        // Flashing wedges in the violated corners, as in the 2D view: fade in and out
        // over 500 ms after the last violation, pie slice spanning the two corner edges.
        if (!this.scene) return;
        const elapsed = Date.now() - this.angleFlashTime;
        const active = this.violatedAngles && this.violatedAngles.length > 0 && elapsed <= 500;
        if (!active) {
            if (this.angleWedgeMesh) this.angleWedgeMesh.visible = false;
            return;
        }
        if (!this.angleWedgeMesh || this.angleWedgeMesh.parent !== this.scene) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xff6b6b, transparent: true, opacity: 0.0,
                side: THREE.DoubleSide, depthWrite: false
            });
            this.angleWedgeMesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
            this.angleWedgeMesh.renderOrder = 10;
            this.scene.add(this.angleWedgeMesh);
        }
        const t = elapsed / 500.0;
        this.angleWedgeMesh.material.opacity = Math.max(0, Math.min(0.7, t < 0.5 ? t * 2 : (1 - t) * 2));

        const WEDGE = 0.35;      // fraction of the two corner edges
        const SEGMENTS = 8;      // arc resolution
        const positions = [];
        for (const v of this.violatedAngles) {
            const k = new THREE.Vector3(v.x, v.y, v.z || 0);
            const dI = new THREE.Vector3(v.edgeI.x, v.edgeI.y, v.edgeI.z || 0).sub(k);
            const dJ = new THREE.Vector3(v.edgeJ.x, v.edgeJ.y, v.edgeJ.z || 0).sub(k);
            const radius = WEDGE * Math.min(dI.length(), dJ.length());
            if (radius < 1e-6) continue;
            const uI = dI.normalize(), uJ = dJ.normalize();
            const angle = uI.angleTo(uJ);
            if (angle < 1e-6) continue;
            const axis = new THREE.Vector3().crossVectors(uI, uJ).normalize();
            let prev = k.clone().addScaledVector(uI, radius);
            for (let s = 1; s <= SEGMENTS; s++) {
                const dir = uI.clone().applyAxisAngle(axis, angle * s / SEGMENTS);
                const next = k.clone().addScaledVector(dir, radius);
                positions.push(k.x, k.y, k.z, prev.x, prev.y, prev.z, next.x, next.y, next.z);
                prev = next;
            }
        }
        const geometry = this.angleWedgeMesh.geometry;
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();
        this.angleWedgeMesh.visible = positions.length > 0;
    },

    animate3D() {
        this.animationFrameId = requestAnimationFrame(() => this.animate3D());

        // Update controls
        if (this.controls) {
            this.controls.update();
        }

        this.updateAngleViolations3D();

        // Render scene
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }

        // Render labels
        if (this.labelRenderer && this.scene && this.camera) {
            this.labelRenderer.render(this.scene, this.camera);
        }

        // Draw colorbar overlay on top of 3D view
        this.draw3DColorbar();
    },

    draw3DColorbar() {
        if (!this.renderer) return;

        const container = this.renderer.domElement.parentElement;

        // Create an overlay canvas that matches the full container size
        if (!this.colorbarCanvas) {
            this.colorbarCanvas = document.createElement('canvas');
            this.colorbarCanvas.id = 'colorbar-overlay';
            this.colorbarCanvas.style.position = 'absolute';
            this.colorbarCanvas.style.top = '0';
            this.colorbarCanvas.style.left = '0';
            this.colorbarCanvas.style.width = '100%';
            this.colorbarCanvas.style.height = '100%';
            this.colorbarCanvas.style.pointerEvents = 'none';
            this.colorbarCanvas.style.zIndex = '100';
            this.colorbarCanvas.style.backgroundColor = 'transparent';
            this.colorbarCanvas.style.userSelect = 'none';
            container.appendChild(this.colorbarCanvas);
        }

        // Set canvas resolution to match container (same as 2D canvas)
        this.colorbarCanvas.width = container.clientWidth;
        this.colorbarCanvas.height = container.clientHeight;

        // Get context and ensure it's cleared properly
        const overlayCtx = this.colorbarCanvas.getContext('2d', { alpha: true });
        overlayCtx.clearRect(0, 0, this.colorbarCanvas.width, this.colorbarCanvas.height);

        // Use the same drawing function as 2D view
        this.drawColorbarToContext(overlayCtx, this.colorbarCanvas.width, this.colorbarCanvas.height);
    }
};
