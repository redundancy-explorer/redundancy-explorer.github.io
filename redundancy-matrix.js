/**
 * Redundancy Matrix Calculation for Truss Structures
 * JavaScript implementation matching Python reference
 */

class Matrix {
  // Row-major dense matrix backed by a flat Float64Array. Element (i, j) lives
  // at data[i * cols + j]. Flat typed storage keeps the hot multiply / invert
  // loops in a monomorphic, cache-friendly path (much faster than the previous
  // array-of-arrays with per-element method dispatch).
  constructor(rows, cols, data = null) {
    this.rows = rows;
    this.cols = cols;
    this.data = data || new Float64Array(rows * cols);
  }

  static zeros(rows, cols) {
    return new Matrix(rows, cols);
  }

  static identity(size) {
    const m = new Matrix(size, size);
    for (let i = 0; i < size; i++) m.data[i * size + i] = 1;
    return m;
  }

  get(i, j) {
    return this.data[i * this.cols + j];
  }

  set(i, j, val) {
    this.data[i * this.cols + j] = val;
  }

  transpose() {
    const r = this.rows, c = this.cols;
    const src = this.data;
    const out = new Float64Array(r * c);
    for (let i = 0; i < r; i++) {
      const ic = i * c;
      for (let j = 0; j < c; j++) out[j * r + i] = src[ic + j];
    }
    return new Matrix(c, r, out);
  }

  multiply(other) {
    if (this.cols !== other.rows) {
      throw new Error('Matrix dimensions incompatible for multiplication');
    }
    const n = this.rows, k = this.cols, m = other.cols;
    const A = this.data, B = other.data;
    const C = new Float64Array(n * m);
    // i-k-j order: stream B rows contiguously and skip zero entries of A
    // (the compatibility matrix Af is very sparse, so this saves most work).
    for (let i = 0; i < n; i++) {
      const iA = i * k, iC = i * m;
      for (let p = 0; p < k; p++) {
        const a = A[iA + p];
        if (a === 0) continue;
        const pB = p * m;
        for (let j = 0; j < m; j++) C[iC + j] += a * B[pB + j];
      }
    }
    return new Matrix(n, m, C);
  }

  diag() {
    const size = Math.min(this.rows, this.cols);
    const c = this.cols, d = this.data;
    const result = new Array(size);
    for (let i = 0; i < size; i++) result[i] = d[i * c + i];
    return result;
  }

  pseudoInverse() {
    // For full rank matrices: A^+ = (A^T A)^-1 A^T
    const At = this.transpose();
    const AtA = At.multiply(this);

    // Add regularization for numerical stability
    const lambda = 1e-6;
    for (let i = 0; i < AtA.rows; i++) {
      AtA.data[i * AtA.cols + i] += lambda;
    }

    try {
      const AtAinv = AtA.invertSmall();
      return AtAinv.multiply(At);
    } catch (e) {
      console.warn('Matrix inversion failed even with regularization:', e);
      // Return a zero matrix as last resort
      return Matrix.zeros(AtA.cols, At.rows);
    }
  }

  invertSmall() {
    const n = this.rows;
    if (n !== this.cols) throw new Error('Matrix must be square');

    // Augmented [A + lambda I | I] as a flat n x 2n Float64Array.
    const w = 2 * n;
    const aug = new Float64Array(n * w);
    const lambda = 1e-10;
    const src = this.data;
    for (let i = 0; i < n; i++) {
      const rowSrc = i * n, rowAug = i * w;
      for (let j = 0; j < n; j++) aug[rowAug + j] = src[rowSrc + j];
      aug[rowAug + i] += lambda;
      aug[rowAug + n + i] = 1;
    }

    // Gauss-Jordan elimination with partial pivoting.
    for (let i = 0; i < n; i++) {
      const rowI = i * w;
      let maxRow = i, maxVal = Math.abs(aug[rowI + i]);
      for (let r = i + 1; r < n; r++) {
        const v = Math.abs(aug[r * w + i]);
        if (v > maxVal) { maxVal = v; maxRow = r; }
      }
      if (maxRow !== i) {
        const rowM = maxRow * w;
        for (let j = 0; j < w; j++) {
          const t = aug[rowI + j]; aug[rowI + j] = aug[rowM + j]; aug[rowM + j] = t;
        }
      }

      const pivot = aug[rowI + i];
      if (Math.abs(pivot) < 1e-12) {
        throw new Error('Matrix is singular or nearly singular');
      }
      const invPivot = 1 / pivot;
      for (let j = 0; j < w; j++) aug[rowI + j] *= invPivot;

      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const rowR = r * w;
        const factor = aug[rowR + i];
        if (factor === 0) continue;
        for (let j = 0; j < w; j++) aug[rowR + j] -= factor * aug[rowI + j];
      }
    }

    const inv = new Matrix(n, n);
    for (let i = 0; i < n; i++) {
      const rowAug = i * w + n, rowInv = i * n;
      for (let j = 0; j < n; j++) inv.data[rowInv + j] = aug[rowAug + j];
    }
    return inv;
  }
}

class RedundancyMatrixTruss {
  constructor(nodes, topology, dirichletBC, stiffnessEA) {
    this.nodes = nodes;
    this.topology = topology;
    this.dirichletBC = dirichletBC;
    this.stiffnessEA = stiffnessEA;

    this.numElements = topology.length;
    this.numNodes = nodes.length;
    this.numDOFs = this.numNodes * 3;

    // Build list of free DOFs
    this.freeDOFs = [];
    for (let i = 0; i < this.numNodes; i++) {
      for (let j = 0; j < 3; j++) {
        if (this.dirichletBC[i][j] === 0) {
          this.freeDOFs.push(i * 3 + j);
        }
      }
    }
    this.numFreeDOFs = this.freeDOFs.length;
  }

  update(newNodes) {
    this.nodes = newNodes;
    return this.computeRedundancyMatrix();
  }

  computeRedundancyMatrix() {
    // Build matrices
    const A = this.buildEquilibriumMatrixA();
    const Af = this.extractFreeDOFsFromA(A);
    const C = this.buildDiagonalStiffnessMatrix();

    try {
      // R = I - A * (A^T*C*A)^-1 * A^T*C
      const AfT = Af.transpose();
      const AtC = AfT.multiply(C);
      const AtCA = AtC.multiply(Af);

      // Check for zero or near-zero determinant
      let isValid = true;
      for (let i = 0; i < AtCA.rows; i++) {
        if (Math.abs(AtCA.get(i, i)) < 1e-12) {
          console.warn('Near-singular stiffness matrix detected');
          isValid = false;
          break;
        }
      }

      if (!isValid) {
        // Return identity matrix as fallback (all redundancies = 1)
        return Matrix.identity(this.numElements);
      }

      // AtCA is square, symmetric, positive definite: invert it directly.
      // pseudoInverse() solved the normal equations, which squared the
      // condition number and drifted the redundancy values (the trace no
      // longer matched the integer degree of static indeterminacy).
      const AtCA_inv = AtCA.invertSmall();
      const temp1 = Af.multiply(AtCA_inv);
      const temp2 = temp1.multiply(AtC);

      const I = Matrix.identity(this.numElements);
      const R = Matrix.zeros(this.numElements, this.numElements);
      for (let i = 0; i < this.numElements; i++) {
        for (let j = 0; j < this.numElements; j++) {
          R.set(i, j, I.get(i, j) - temp2.get(i, j));
        }
      }
      return R;
    } catch (e) {
      console.error('Redundancy calculation failed:', e);
      console.error('Using identity matrix as fallback');
      // Return identity matrix as fallback
      return Matrix.identity(this.numElements);
    }
  }

  updateDiagonal(newNodes) {
    this.nodes = newNodes;
    return this.computeRedundancyDiagonal();
  }

  computeRedundancyDiagonal() {
    // Per-element redundancy r_e only (the diagonal of R). The app never uses
    // the off-diagonal entries, so we skip forming the full m x m product
    // temp2 = Af * AtCA_inv * AtC and instead evaluate just its diagonal:
    //   r_e = 1 - (Af * AtCA_inv * AtC)_ee
    //       = 1 - sum_j temp1[e][j] * AtC[j][e],   temp1 = Af * AtCA_inv.
    // This drops the O(m^2 * n_f) dense product and the m x m allocation.
    const A = this.buildEquilibriumMatrixA();
    const Af = this.extractFreeDOFsFromA(A);
    const C = this.buildDiagonalStiffnessMatrix();

    try {
      const AfT = Af.transpose();
      const AtC = AfT.multiply(C);     // (n_f x m)
      const AtCA = AtC.multiply(Af);   // (n_f x n_f)

      for (let i = 0; i < AtCA.rows; i++) {
        if (Math.abs(AtCA.get(i, i)) < 1e-12) {
          console.warn('Near-singular stiffness matrix detected');
          return new Array(this.numElements).fill(1);
        }
      }

      // AtCA is square, symmetric, positive definite, so invert it directly
      // rather than via pseudoInverse() (which needlessly solves the normal
      // equations, doubling the work and squaring the condition number).
      const AtCA_inv = AtCA.invertSmall();     // (n_f x n_f)
      const temp1 = Af.multiply(AtCA_inv);     // (m x n_f)

      const r = new Array(this.numElements);
      for (let e = 0; e < this.numElements; e++) {
        let s = 0;
        for (let j = 0; j < this.numFreeDOFs; j++) {
          s += temp1.get(e, j) * AtC.get(j, e);
        }
        r[e] = 1 - s;
      }
      return r;
    } catch (e) {
      console.error('Redundancy diagonal calculation failed:', e);
      return new Array(this.numElements).fill(1);
    }
  }

  buildEquilibriumMatrixA() {
    const A = Matrix.zeros(this.numElements, this.numDOFs);

    for (let e = 0; e < this.numElements; e++) {
      const [nodeA, nodeB] = this.topology[e];
      const posA = this.nodes[nodeA];
      const posB = this.nodes[nodeB];

      // Element vector
      const dx = posB[0] - posA[0];
      const dy = posB[1] - posA[1];
      const dz = posB[2] - posA[2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (L < 1e-10) continue;

      // Unit vector (direction cosines)
      const vector_norm = [dx / L, dy / L, dz / L];

      // Compute rotation matrix (matching Python implementation)
      const z_axis = [0, 0, -1];
      let y_axis = [
        vector_norm[1] * z_axis[2] - vector_norm[2] * z_axis[1],
        vector_norm[2] * z_axis[0] - vector_norm[0] * z_axis[2],
        vector_norm[0] * z_axis[1] - vector_norm[1] * z_axis[0]
      ];

      const y_norm = Math.sqrt(y_axis[0] ** 2 + y_axis[1] ** 2 + y_axis[2] ** 2);
      if (y_norm > 1e-10) {
        y_axis = [y_axis[0] / y_norm, y_axis[1] / y_norm, y_axis[2] / y_norm];
      } else {
        y_axis = [0, 1, 0]; // Fallback for vertical elements
      }

      const z_norm = [
        vector_norm[1] * y_axis[2] - vector_norm[2] * y_axis[1],
        vector_norm[2] * y_axis[0] - vector_norm[0] * y_axis[2],
        vector_norm[0] * y_axis[1] - vector_norm[1] * y_axis[0]
      ];

      // Build 6x6 rotation matrix (block diagonal)
      const rotation_matrix = [];
      for (let i = 0; i < 6; i++) {
        rotation_matrix[i] = [];
        for (let j = 0; j < 6; j++) {
          rotation_matrix[i][j] = 0;
        }
      }

      // First 3x3 block
      for (let i = 0; i < 3; i++) {
        rotation_matrix[0][i] = vector_norm[i];
        rotation_matrix[1][i] = y_axis[i];
        rotation_matrix[2][i] = z_norm[i];
      }

      // Second 3x3 block
      for (let i = 0; i < 3; i++) {
        rotation_matrix[3][3 + i] = vector_norm[i];
        rotation_matrix[4][3 + i] = y_axis[i];
        rotation_matrix[5][3 + i] = z_norm[i];
      }

      // Mode vector in local coordinates [-1, 0, 0, 1, 0, 0]
      const mode_local = [-1, 0, 0, 1, 0, 0];

      // Transform to global: rotation_matrix^T * mode_local
      const mode_global = [];
      for (let i = 0; i < 6; i++) {
        let sum = 0;
        for (let j = 0; j < 6; j++) {
          sum += rotation_matrix[j][i] * mode_local[j];
        }
        mode_global.push(sum);
      }

      // Populate A matrix
      const dofs = [
        nodeA * 3, nodeA * 3 + 1, nodeA * 3 + 2,
        nodeB * 3, nodeB * 3 + 1, nodeB * 3 + 2
      ];
      for (let i = 0; i < 6; i++) {
        A.set(e, dofs[i], mode_global[i]);
      }
    }

    return A;
  }

  buildDiagonalStiffnessMatrix() {
    const C = Matrix.zeros(this.numElements, this.numElements);

    for (let e = 0; e < this.numElements; e++) {
      const [nodeA, nodeB] = this.topology[e];
      const posA = this.nodes[nodeA];
      const posB = this.nodes[nodeB];

      const dx = posB[0] - posA[0];
      const dy = posB[1] - posA[1];
      const dz = posB[2] - posA[2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (L < 1e-10) {
        C.set(e, e, 0);
      } else {
        C.set(e, e, this.stiffnessEA[e] / L);
      }
    }

    return C;
  }

  extractFreeDOFsFromA(A) {
    const Af = Matrix.zeros(this.numElements, this.numFreeDOFs);

    for (let i = 0; i < this.numElements; i++) {
      for (let j = 0; j < this.numFreeDOFs; j++) {
        Af.set(i, j, A.get(i, this.freeDOFs[j]));
      }
    }

    return Af;
  }

  // ---- Analytic gradients --------------------------------------------------

  // Element-local data for one truss element: the 6 global DOF indices, the
  // corresponding row of the equilibrium matrix A, and the stiffness diagonal
  // entry C_ee = EA / L. For the axial mode the rotation machinery of
  // buildEquilibriumMatrixA reduces to [-d_hat; +d_hat], so this mirrors that
  // assembly (including the degenerate-length guard) for a single element.
  elementRow(e, nodes) {
    const [nodeA, nodeB] = this.topology[e];
    const posA = nodes[nodeA];
    const posB = nodes[nodeB];
    const dx = posB[0] - posA[0];
    const dy = posB[1] - posA[1];
    const dz = posB[2] - posA[2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dofs = [
      nodeA * 3, nodeA * 3 + 1, nodeA * 3 + 2,
      nodeB * 3, nodeB * 3 + 1, nodeB * 3 + 2,
    ];
    if (L < 1e-10) {
      return { dofs, arow: [0, 0, 0, 0, 0, 0], cval: 0, nodeA, nodeB };
    }
    const ux = dx / L, uy = dy / L, uz = dz / L;
    return {
      dofs,
      arow: [-ux, -uy, -uz, ux, uy, uz],
      cval: this.stiffnessEA[e] / L,
      nodeA, nodeB,
    };
  }

  // Gradient of a weighted sum of per-element redundancies  L = sum_e w_e r_e
  // with respect to every node position (n_nodes x 3). Truss analog of
  // RedundancyMatrixBeam.weightedRedundancyGradient: the same closed-form
  // sensitivities from one factorization of K = A^T C A,
  //   dJ/dA[r,c] = 2 C_r ( w_r (A K^-1)[r,c] - (A Q)[r,c] ),
  //   dJ/dC_rr   = w_r (A K^-1 A^T)_rr - (A Q A^T)_rr,
  //   Q = K^-1 (A^T C diag(w) A) K^-1,
  // with the truss's single axial mode per element (one row of A, 6
  // possibly-free DOF entries) in place of the beam's 6 x 12 block. A and C
  // are then chained to node coordinates with element-local central
  // differences (each row depends only on its two endpoints, so no global
  // solve is involved).
  weightedRedundancyGradient(weights, eps = 1e-6) {
    const m = this.numElements;
    const nf = this.numFreeDOFs;

    // Global-DOF -> free-column map.
    const freeCol = new Array(this.numDOFs).fill(-1);
    for (let j = 0; j < nf; j++) freeCol[this.freeDOFs[j]] = j;

    const A = this.buildEquilibriumMatrixA();
    const Af = this.extractFreeDOFsFromA(A);
    const C = this.buildDiagonalStiffnessMatrix();
    const Cdiag = new Array(m);
    for (let e = 0; e < m; e++) Cdiag[e] = C.get(e, e);
    const elemRows = new Array(m);
    for (let e = 0; e < m; e++) elemRows[e] = this.elementRow(e, this.nodes);

    // K = A^T C A and its inverse (single factorization).
    const AtC = Af.transpose().multiply(C);   // nf x m
    const K = AtC.multiply(Af);               // nf x nf
    const Kinv = K.invertSmall();
    const AK = Af.multiply(Kinv);             // m x nf  (= A K^-1)

    // M = A^T diag(C w) A and Q = K^-1 M K^-1.
    const AtCD = Matrix.zeros(nf, m);
    for (let r = 0; r < m; r++) {
      const s = Cdiag[r] * weights[r];
      for (let j = 0; j < nf; j++) AtCD.set(j, r, Af.get(r, j) * s);
    }
    const M = AtCD.multiply(Af);
    const Q = Kinv.multiply(M).multiply(Kinv);
    const AQ = Af.multiply(Q);                // m x nf

    // dJ/dC diagonal, using the sparse A rows (6 nonzeros per row).
    const GC = new Array(m).fill(0);
    for (let e = 0; e < m; e++) {
      const er = elemRows[e];
      let akA = 0, aqA = 0;
      for (let k = 0; k < 6; k++) {
        const col = freeCol[er.dofs[k]];
        if (col >= 0) {
          akA += AK.get(e, col) * er.arow[k];
          aqA += AQ.get(e, col) * er.arow[k];
        }
      }
      GC[e] = weights[e] * akA - aqA;
    }

    // Chain A, C -> node coordinates via element-local central differences.
    const grad = this.nodes.map(() => [0, 0, 0]);
    for (let e = 0; e < m; e++) {
      const base = elemRows[e];
      const twoC = 2 * Cdiag[e];
      const elemNodes = [base.nodeA, base.nodeB];
      for (let en = 0; en < 2; en++) {
        const gNode = elemNodes[en];
        for (let d = 0; d < 3; d++) {
          const saved = this.nodes[gNode][d];
          this.nodes[gNode][d] = saved + eps;
          const erP = this.elementRow(e, this.nodes);
          this.nodes[gNode][d] = saved - eps;
          const erM = this.elementRow(e, this.nodes);
          this.nodes[gNode][d] = saved;

          let contrib = 0;
          for (let k = 0; k < 6; k++) {
            const col = freeCol[base.dofs[k]];
            if (col >= 0) {
              const dA = (erP.arow[k] - erM.arow[k]) / (2 * eps);
              const GA = twoC * (weights[e] * AK.get(e, col) - AQ.get(e, col));
              contrib += GA * dA;
            }
          }
          const dC = (erP.cval - erM.cval) / (2 * eps);
          contrib += GC[e] * dC;
          grad[gNode][d] += contrib;
        }
      }
    }

    // grad currently holds dJ/dx; L = const - J, so dL/dx = -dJ/dx.
    for (let p = 0; p < grad.length; p++) {
      grad[p][0] = -grad[p][0];
      grad[p][1] = -grad[p][1];
      grad[p][2] = -grad[p][2];
    }
    return grad;
  }

  // Adjoint gradient of the redundancy range (max_e r_e - min_e r_e) w.r.t.
  // node positions, via its subgradient weights (+1 at argmax, -1 at argmin).
  redundancyRangeGradient(nodes) {
    if (nodes) this.nodes = nodes;
    const r = this.computeRedundancyDiagonal();
    let iMax = 0, iMin = 0;
    for (let e = 1; e < r.length; e++) {
      if (r[e] > r[iMax]) iMax = e;
      if (r[e] < r[iMin]) iMin = e;
    }
    const weights = new Array(this.numElements).fill(0);
    weights[iMax] += 1;
    weights[iMin] -= 1;
    return this.weightedRedundancyGradient(weights);
  }

  // Adjoint gradient of the mean-squared deviation from a target redundancy
  //   L = sum_e (r_e - target)^2,   dL/dr_e = 2 (r_e - target),
  // w.r.t. node positions. Every element contributes proportionally to how far
  // it is from target, giving a smoother, more informative descent than range.
  // The total redundancy (sum of r_e) is invariant, so the mean is constant and
  // equals the target; if target is omitted the current mean is used.
  redundancyDeviationGradient(nodes, target) {
    if (nodes) this.nodes = nodes;
    const r = this.computeRedundancyDiagonal();
    let t = target;
    if (t == null || isNaN(t)) {
      let s = 0;
      for (const v of r) s += v;
      t = s / r.length;
    }
    const weights = r.map((v) => 2 * (v - t));
    return this.weightedRedundancyGradient(weights);
  }
}

/**
 * Redundancy Matrix Calculation for 3D Beam (frame) Structures.
 *
 * Port of jaxredmat.beam.RedundancyMatrixBeam:
 *   - 6 DOFs per node (3 translations + 3 rotations)
 *   - 6 load-carrying modes per element (axial, torsion, and two coupled
 *     bending/shear modes per principal bending direction)
 *   - per-element 6x6 diagonal stiffness from EA / EIy / EIz / GJ
 *   - per-element redundancy = sum of the 6 diagonal entries of that element's
 *     block on the main diagonal of the full redundancy matrix R.
 *
 * The public interface mirrors RedundancyMatrixTruss so redundancy.js can use
 * either one interchangeably (update / updateDiagonal return per-element r).
 */
class RedundancyMatrixBeam {
  constructor(nodes, topology, dirichletBC, stiffnessEA, stiffnessEIy, stiffnessEIz, stiffnessGJ) {
    this.nodes = nodes;
    this.topology = topology;
    this.dirichletBC = dirichletBC;   // per node: array of 6 (0 = free, 1 = fixed)
    this.stiffnessEA = stiffnessEA;   // per element
    this.stiffnessEIy = stiffnessEIy;
    this.stiffnessEIz = stiffnessEIz;
    this.stiffnessGJ = stiffnessGJ;

    this.numElements = topology.length;
    this.numNodes = nodes.length;
    this.numDOFs = this.numNodes * 6;

    // Free DOFs are those with dirichlet_bc == 0.
    this.freeDOFs = [];
    for (let i = 0; i < this.numNodes; i++) {
      const bc = this.dirichletBC[i];
      for (let j = 0; j < 6; j++) {
        if (bc[j] === 0) {
          this.freeDOFs.push(i * 6 + j);
        }
      }
    }
    this.numFreeDOFs = this.freeDOFs.length;
  }

  update(newNodes) {
    this.nodes = newNodes;
    return this.computeRedundancyDiagonal();
  }

  updateDiagonal(newNodes) {
    this.nodes = newNodes;
    return this.computeRedundancyDiagonal();
  }

  // Per-element compatibility block (6 mode rows x 12 element DOFs), the 12
  // global DOF indices it couples to, and the 6 diagonal stiffness entries.
  // Depends only on the element's own two node positions, so it is cheap to
  // re-evaluate for local finite differences in the gradient.
  elementAC(e, nodes) {
    const [nodeA, nodeB] = this.topology[e];
    const posA = nodes[nodeA];
    const posB = nodes[nodeB];

    const dx = posB[0] - posA[0];
    const dy = posB[1] - posA[1];
    const dz = posB[2] - posA[2];
    let L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-10) L = 1e-10;

    const vn = [dx / L, dy / L, dz / L];

    // Local frame (matches _compute_beam_matrices): y = vn x [0,0,-1].
    const zAxis = [0, 0, -1];
    let y = [
      vn[1] * zAxis[2] - vn[2] * zAxis[1],
      vn[2] * zAxis[0] - vn[0] * zAxis[2],
      vn[0] * zAxis[1] - vn[1] * zAxis[0],
    ];
    const yn = Math.sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2]);
    if (yn > 1e-10) {
      y = [y[0] / yn, y[1] / yn, y[2] / yn];
    } else {
      y = [0, 1, 0];
    }
    const z = [
      vn[1] * y[2] - vn[2] * y[1],
      vn[2] * y[0] - vn[0] * y[2],
      vn[0] * y[1] - vn[1] * y[0],
    ];

    // R has rows [vn; y; z]; a_transp = R^T. mode_global = R^T @ mode, applied
    // independently to each of the 4 translation/rotation triples.
    const rows = [vn, y, z];
    const applyRT = (v3) => [
      rows[0][0] * v3[0] + rows[1][0] * v3[1] + rows[2][0] * v3[2],
      rows[0][1] * v3[0] + rows[1][1] * v3[1] + rows[2][1] * v3[2],
      rows[0][2] * v3[0] + rows[1][2] * v3[1] + rows[2][2] * v3[2],
    ];
    const transform12 = (mode) => {
      const out = new Array(12);
      for (let b = 0; b < 4; b++) {
        const t = applyRT([mode[b * 3], mode[b * 3 + 1], mode[b * 3 + 2]]);
        out[b * 3] = t[0]; out[b * 3 + 1] = t[1]; out[b * 3 + 2] = t[2];
      }
      return out;
    };

    // Local kinematic modes (start 6 dofs, then end 6 dofs).
    const modes = [
      [-1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
      [0, 2 / L, 0, 0, 0, 1, 0, -2 / L, 0, 0, 0, 1],
      [0, 0, -2 / L, 0, 1, 0, 0, 0, 2 / L, 0, 1, 0],
      [0, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0],
      [0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1],
    ];

    const gmodes = new Array(6);
    for (let mi = 0; mi < 6; mi++) gmodes[mi] = transform12(modes[mi]);

    const dofs = new Array(12);
    for (let k = 0; k < 6; k++) dofs[k] = nodeA * 6 + k;
    for (let k = 0; k < 6; k++) dofs[6 + k] = nodeB * 6 + k;

    const EA = this.stiffnessEA[e];
    const EIy = this.stiffnessEIy[e];
    const EIz = this.stiffnessEIz[e];
    const GJ = this.stiffnessGJ[e];
    const cdiag = [EA / L, 3 * EIz / L, 3 * EIy / L, GJ / L, EIy / L, EIz / L];

    return { nodeA, nodeB, dofs, gmodes, cdiag };
  }

  // Assemble the reduced compatibility matrix Af (m6 x nf) and the diagonal
  // stiffness C (m6 x m6). Also returns the per-DOF free-column map, the
  // diagonal of C as a flat array, and the cached per-element blocks (reused by
  // the gradient).
  buildBeamMatrices() {
    const m6 = this.numElements * 6;
    const Af = Matrix.zeros(m6, this.numFreeDOFs);
    const C = Matrix.zeros(m6, m6);
    const Cdiag = new Array(m6).fill(0);
    const elemAC = new Array(this.numElements);

    // Map every DOF index -> its column in the reduced free set (-1 if fixed).
    const freeCol = new Array(this.numDOFs).fill(-1);
    for (let j = 0; j < this.numFreeDOFs; j++) freeCol[this.freeDOFs[j]] = j;

    for (let e = 0; e < this.numElements; e++) {
      const ac = this.elementAC(e, this.nodes);
      elemAC[e] = ac;

      for (let mi = 0; mi < 6; mi++) {
        const g = ac.gmodes[mi];
        const row = e * 6 + mi;
        for (let k = 0; k < 12; k++) {
          const col = freeCol[ac.dofs[k]];
          if (col >= 0) Af.set(row, col, g[k]);
        }
      }
      for (let k = 0; k < 6; k++) {
        C.set(e * 6 + k, e * 6 + k, ac.cdiag[k]);
        Cdiag[e * 6 + k] = ac.cdiag[k];
      }
    }

    return { Af, C, Cdiag, elemAC, freeCol };
  }

  computeRedundancyDiagonal() {
    // r_e = sum_{k=0..5} R[6e+k, 6e+k], with R = I - Af (Af^T C Af)^-1 Af^T C.
    // Only the diagonal is needed, so we avoid forming the full m6 x m6 product.
    try {
      const { Af, C } = this.buildBeamMatrices();
      const AfT = Af.transpose();
      const AtC = AfT.multiply(C);      // (nf x m6)
      const AtCA = AtC.multiply(Af);    // (nf x nf)

      for (let i = 0; i < AtCA.rows; i++) {
        if (Math.abs(AtCA.get(i, i)) < 1e-12) {
          console.warn('Near-singular beam stiffness matrix detected');
          return new Array(this.numElements).fill(6);
        }
      }

      const AtCA_inv = AtCA.invertSmall();  // (nf x nf)
      const temp1 = Af.multiply(AtCA_inv);  // (m6 x nf)

      const r = new Array(this.numElements);
      for (let e = 0; e < this.numElements; e++) {
        let sumDiag = 0;
        for (let k = 0; k < 6; k++) {
          const row = e * 6 + k;
          let s = 0;
          for (let j = 0; j < this.numFreeDOFs; j++) {
            s += temp1.get(row, j) * AtC.get(j, row);
          }
          sumDiag += (1 - s);   // diagonal of I - Af Kinv AtC
        }
        r[e] = sumDiag;
      }
      return r;
    } catch (err) {
      console.error('Beam redundancy diagonal calculation failed:', err);
      return new Array(this.numElements).fill(6);
    }
  }

  // Gradient of a weighted sum of per-element redundancies  L = sum_e w_e r_e
  // with respect to every node position (n_nodes x 3).
  //
  // With R = I - A K^-1 A^T C, K = A^T C A, C diagonal, one has
  //   L = const - J,   J = tr(D A K^-1 A^T C),   D = diag(w broadcast to rows),
  // and the closed-form sensitivities (C, D diagonal, B = K^-1,
  // Q = K^-1 (A^T C D A) K^-1) are
  //   dJ/dA[r,c] = 2 C_r ( w_r (A B)[r,c] - (A Q)[r,c] )
  //   dJ/dC_rr   = w_r (A B A^T)_rr - (A Q A^T)_rr .
  // These need only ONE factorization of K (reused for A B and A Q), instead of
  // one full solve per finite-difference perturbation. A and C are then chained
  // to node coordinates with cheap element-local finite differences (each block
  // depends only on its two nodes, so no global solve is involved).
  weightedRedundancyGradient(weights, eps = 1e-6) {
    const nElem = this.numElements;
    const m6 = nElem * 6;
    const nf = this.numFreeDOFs;

    const { Af, C, Cdiag, elemAC, freeCol } = this.buildBeamMatrices();

    // K = A^T C A and its inverse (single factorization).
    const AtC = Af.transpose().multiply(C);   // nf x m6
    const AtCA = AtC.multiply(Af);            // nf x nf
    const Kinv = AtCA.invertSmall();          // nf x nf

    const AK = Af.multiply(Kinv);             // m6 x nf  (= A K^-1)

    // Per-row weights, then M = A^T diag(Cdiag * w) A and Q = K^-1 M K^-1.
    const wRow = new Array(m6);
    for (let r = 0; r < m6; r++) wRow[r] = weights[Math.floor(r / 6)];
    const AtCD = Matrix.zeros(nf, m6);
    for (let r = 0; r < m6; r++) {
      const s = Cdiag[r] * wRow[r];
      for (let j = 0; j < nf; j++) AtCD.set(j, r, Af.get(r, j) * s);
    }
    const M = AtCD.multiply(Af);              // nf x nf
    const Q = Kinv.multiply(M).multiply(Kinv);// nf x nf
    const AQ = Af.multiply(Q);                // m6 x nf

    // dJ/dC diagonal, using the sparse Af rows (12 nonzeros per row).
    const GC = new Array(m6).fill(0);
    for (let e = 0; e < nElem; e++) {
      const ac = elemAC[e];
      for (let mi = 0; mi < 6; mi++) {
        const r = e * 6 + mi;
        let akAf = 0, aqAf = 0;
        for (let k = 0; k < 12; k++) {
          const col = freeCol[ac.dofs[k]];
          if (col >= 0) {
            const afv = ac.gmodes[mi][k];     // = Af[r][col]
            akAf += AK.get(r, col) * afv;
            aqAf += AQ.get(r, col) * afv;
          }
        }
        GC[r] = wRow[r] * akAf - aqAf;
      }
    }

    // Chain A, C -> node coordinates via element-local central differences.
    const grad = this.nodes.map(() => [0, 0, 0]);
    for (let e = 0; e < nElem; e++) {
      const base = elemAC[e];
      const elemNodes = [base.nodeA, base.nodeB];
      for (let en = 0; en < 2; en++) {
        const gNode = elemNodes[en];
        for (let d = 0; d < 3; d++) {
          const saved = this.nodes[gNode][d];
          this.nodes[gNode][d] = saved + eps;
          const acP = this.elementAC(e, this.nodes);
          this.nodes[gNode][d] = saved - eps;
          const acM = this.elementAC(e, this.nodes);
          this.nodes[gNode][d] = saved;

          let contrib = 0;
          for (let mi = 0; mi < 6; mi++) {
            const r = e * 6 + mi;
            const twoC = 2 * Cdiag[r];
            for (let k = 0; k < 12; k++) {
              const col = freeCol[base.dofs[k]];
              if (col >= 0) {
                const dA = (acP.gmodes[mi][k] - acM.gmodes[mi][k]) / (2 * eps);
                const GA = twoC * (wRow[r] * AK.get(r, col) - AQ.get(r, col));
                contrib += GA * dA;
              }
            }
          }
          for (let k = 0; k < 6; k++) {
            const r = e * 6 + k;
            const dC = (acP.cdiag[k] - acM.cdiag[k]) / (2 * eps);
            contrib += GC[r] * dC;
          }
          grad[gNode][d] += contrib;
        }
      }
    }

    // grad currently holds dJ/dx; L = const - J, so dL/dx = -dJ/dx.
    for (let p = 0; p < grad.length; p++) {
      grad[p][0] = -grad[p][0];
      grad[p][1] = -grad[p][1];
      grad[p][2] = -grad[p][2];
    }
    return grad;
  }

  // Adjoint gradient of the redundancy range (max_e r_e - min_e r_e) w.r.t.
  // node positions, via its subgradient weights (+1 at argmax, -1 at argmin).
  redundancyRangeGradient(nodes) {
    if (nodes) this.nodes = nodes;
    const r = this.computeRedundancyDiagonal();
    let iMax = 0, iMin = 0;
    for (let e = 1; e < r.length; e++) {
      if (r[e] > r[iMax]) iMax = e;
      if (r[e] < r[iMin]) iMin = e;
    }
    const weights = new Array(this.numElements).fill(0);
    weights[iMax] += 1;
    weights[iMin] -= 1;
    return this.weightedRedundancyGradient(weights);
  }

  // Adjoint gradient of the mean-squared deviation from a target redundancy
  //   L = sum_e (r_e - target)^2,   dL/dr_e = 2 (r_e - target),
  // w.r.t. node positions. Every element contributes proportionally to how far
  // it is from target, giving a smoother, more informative descent than range.
  // The total redundancy (sum of r_e) is invariant, so the mean is constant and
  // equals the target; if target is omitted the current mean is used.
  redundancyDeviationGradient(nodes, target) {
    if (nodes) this.nodes = nodes;
    const r = this.computeRedundancyDiagonal();
    let t = target;
    if (t == null || isNaN(t)) {
      let s = 0;
      for (const v of r) s += v;
      t = s / r.length;
    }
    const weights = r.map((v) => 2 * (v - t));
    return this.weightedRedundancyGradient(weights);
  }
}
