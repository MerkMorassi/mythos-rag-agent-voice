// js/retrieval/retrieval-gate.js
// MAGRAG Retrieval Gate (Vector-only, deterministic)

import { VectorEngine } from '../core/core.js';

export class RetrievalGate {
  constructor(vectors = []) {
    this.vectors = vectors;
  }

  retrieve(queryVector, limit = 8, threshold = 0.35) {
    if (!queryVector || !this.vectors.length) return [];

    return VectorEngine
      .search(queryVector, this.vectors, limit, threshold)
      .map(hit => hit.text);
  }
}
