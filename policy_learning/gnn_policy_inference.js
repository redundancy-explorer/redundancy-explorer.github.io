/**
 * GNN Policy Inference for Truss Redundancy Homogenization
 *
 * Loads a GNN actor model exported to ONNX and runs inference in the browser
 * using ONNX Runtime Web. The GNN takes graph-structured input (node features,
 * edge features, senders, receivers, moveable indices) and outputs per-node
 * displacement actions.
 *
 * The GNN is topology-agnostic: the same model works on any truss geometry.
 * Normalization is baked into the ONNX model.
 *
 * Usage:
 *   const gnn = await TrussPolicyGNN.load('policy_learning/models/gnn_multi_bc_actor.onnx');
 *   const actions = await gnn.predict(nodeFeatures, edgeFeatures, senders, receivers, moveableIndices);
 *   // actions is Float32Array of shape (numMoveable * actionDim,)
 */

class TrussPolicyGNN {
    /**
     * Create a new TrussPolicyGNN instance.
     * @param {ort.InferenceSession} session - ONNX Runtime session
     * @param {Object} metadata - Model metadata from JSON sidecar
     */
    constructor(session, metadata = {}) {
        this.session = session;
        this.metadata = metadata;
        this.actionDim = metadata.action_dim || 2;
        this.nodeFeatDim = metadata.node_feat_dim || 3;
        this.edgeFeatDim = metadata.edge_feat_dim || 5;
        // "unit_step" (output is a unit direction; normalization baked into
        // the ONNX graph) or "raw_gradient" (output carries the magnitude /
        // annealing signal). Old sidecars predate the field and are unit_step.
        this.actionConvention = metadata.action_convention || 'unit_step';
    }

    /**
     * Load a GNN policy from an ONNX file.
     * @param {string} onnxPath - Path to the .onnx model file
     * @param {Object} options - ONNX Runtime session options
     * @returns {Promise<TrussPolicyGNN>}
     */
    static async load(onnxPath, options = {}) {
        if (typeof ort === 'undefined') {
            throw new Error(
                'ONNX Runtime Web not loaded. Add this to your HTML:\n' +
                '<script src="https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js"></script>'
            );
        }

        const sessionOptions = {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
            ...options,
        };

        const session = await ort.InferenceSession.create(
            onnxPath, sessionOptions
        );

        // Load metadata sidecar
        let metadata = {};
        try {
            const metadataPath = onnxPath.replace('.onnx', '_metadata.json');
            const response = await fetch(metadataPath);
            if (response.ok) {
                metadata = await response.json();
            } else {
                console.warn(`[GNN] Metadata file not found (${response.status})`);
            }
        } catch (e) {
            console.warn(`[GNN] Failed to load metadata: ${e.message}`);
        }

        return new TrussPolicyGNN(session, metadata);
    }

    /**
     * Run GNN inference to get per-node actions.
     *
     * @param {Float32Array|number[]} nodeFeatures - (numNodes * nodeFeatDim,) flattened
     * @param {Float32Array|number[]} edgeFeatures - (numEdges * edgeFeatDim,) flattened
     * @param {BigInt64Array|number[]} senders - (numEdges,) int64 source node indices
     * @param {BigInt64Array|number[]} receivers - (numEdges,) int64 target node indices
     * @param {BigInt64Array|number[]} moveableIndices - (numMoveable,) int64 indices
     * @param {number} numNodes - number of nodes
     * @param {number} numEdges - number of directed edges
     * @param {number} numMoveable - number of moveable nodes
     * @returns {Promise<Float32Array>} - (numMoveable * actionDim,) actions
     */
    async predict(
        nodeFeatures, edgeFeatures,
        senders, receivers, moveableIndices,
        numNodes, numEdges, numMoveable,
    ) {
        // Convert to typed arrays if needed
        const nfArray = nodeFeatures instanceof Float32Array
            ? nodeFeatures : new Float32Array(nodeFeatures);
        const efArray = edgeFeatures instanceof Float32Array
            ? edgeFeatures : new Float32Array(edgeFeatures);

        // ONNX Runtime Web requires BigInt64Array for int64 tensors
        const sendersBI = senders instanceof BigInt64Array
            ? senders : new BigInt64Array(Array.from(senders).map(x => BigInt(x)));
        const receiversBI = receivers instanceof BigInt64Array
            ? receivers : new BigInt64Array(Array.from(receivers).map(x => BigInt(x)));
        const moveableBI = moveableIndices instanceof BigInt64Array
            ? moveableIndices : new BigInt64Array(Array.from(moveableIndices).map(x => BigInt(x)));

        // Create tensors
        const nfTensor = new ort.Tensor('float32', nfArray, [numNodes, this.nodeFeatDim]);
        const efTensor = new ort.Tensor('float32', efArray, [numEdges, this.edgeFeatDim]);
        const sTensor = new ort.Tensor('int64', sendersBI, [numEdges]);
        const rTensor = new ort.Tensor('int64', receiversBI, [numEdges]);
        const mTensor = new ort.Tensor('int64', moveableBI, [numMoveable]);

        // Run inference
        const feeds = {
            node_features: nfTensor,
            edge_features: efTensor,
            senders: sTensor,
            receivers: rTensor,
            moveable_indices: mTensor,
        };

        const results = await this.session.run(feeds);
        const output = results.actions;

        return new Float32Array(output.data);
    }

    /**
     * Get model info.
     * @returns {Object}
     */
    getInfo() {
        return {
            modelType: 'gnn_onnx',
            actionDim: this.actionDim,
            actionConvention: this.actionConvention,
            nodeFeatDim: this.nodeFeatDim,
            edgeFeatDim: this.edgeFeatDim,
            hiddenDim: this.metadata.hidden_dim || null,
            numMPLayers: this.metadata.num_mp_layers || null,
            inputNames: this.session.inputNames,
            outputNames: this.session.outputNames,
        };
    }

    /**
     * Release model resources.
     */
    async dispose() {
        if (this.session) {
            await this.session.release();
            this.session = null;
        }
    }
}


// Export for browser
if (typeof window !== 'undefined') {
    window.TrussPolicyGNN = TrussPolicyGNN;
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TrussPolicyGNN };
}
