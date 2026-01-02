// js/memory/elara-engine.js

// Using a placeholder for VECTOR_DIMENSION. It should ideally be passed in or configured globally.
// For now, I will define it here as 768, which is a common embedding dimension.
const VECTOR_DIMENSION = 768;

class Elara_VectorEngine {
    constructor(dim = VECTOR_DIMENSION) {
        this.dim = dim;
        this.isGpuAvailable = ('gpu' in navigator);
        this.device = null;
        this.searchShaderModule = null;
    }

    async initialize() {
        if (!this.isGpuAvailable) {
            console.warn("[Elara] WebGPU not supported. Vector search will be slow (CPU Fallback).");
            return;
        }
        try {
            const adapter = await navigator.gpu.requestAdapter();
            this.device = await adapter.requestDevice();
            this.searchShaderModule = this.device.createShaderModule({
                code: this.getSearchShaderCode()
            });
            console.log("[Elara] WebGPU Engine Online. Vector search is GPU-Accelerated.");
        } catch (e) {
            console.error(`[Elara] WebGPU Init Failed: ${e.message} (CPU Fallback).`);
            this.isGpuAvailable = false;
        }
    }
    
    getSearchShaderCode() {
        return `
            struct Uniforms {
                numVectors: u32,
                vectorDim: u32,
                queryNormSq: f32,
            };
            @group(0) @binding(0) var<uniform> u: Uniforms;
            @group(0) @binding(1) var<storage, read> queryVector: array<f32>;
            @group(0) @binding(2) var<storage, read> vectorDB: array<f32>;
            @group(0) @binding(3) var<storage, read_write> scoreBuffer: array<f32>;

            @compute
            @workgroup_size(64)
            fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
                let vecIndex = global_id.x;
                if (vecIndex >= u.numVectors) { return; }

                var dotProduct: f32 = 0.0;
                var dbNormSq: f32 = 0.0;

                let start = vecIndex * u.vectorDim;
                for (var i: u32 = 0u; i < u.vectorDim; i = i + 1u) {
                    let dbValue = vectorDB[start + i];
                    dotProduct += queryVector[i] * dbValue;
                    dbNormSq += dbValue * dbValue;
                }
                
                let divisor = sqrt(u.queryNormSq) * sqrt(dbNormSq);
                let similarity = dotProduct / divisor;

                scoreBuffer[vecIndex] = select(0.0, similarity, divisor != 0.0);
            }
        `;
    }
    
    async search(queryVector, ramVectors, isElaraEnabled = true) { // Added isElaraEnabled parameter
        if (!this.isGpuAvailable || ramVectors.length === 0 || !isElaraEnabled) { // Use parameter
            return this._cpuSearchFallback(queryVector, ramVectors);
        }
        
        const numVectors = ramVectors.length;
        const vectorDimension = this.dim;

        let queryBuffer, dbBuffer, scoreBuffer, stagingBuffer, uniformBuffer;
        let scoredResults = null;

        try {
            const qVecFloat32 = new Float32Array(queryVector); 
            const dbFlattened = new Float32Array(ramVectors.length * vectorDimension);
            for (let i = 0; i < ramVectors.length; i++) {
                dbFlattened.set(ramVectors[i].vector, i * vectorDimension);
            }

            let queryNormSq = 0;
            for (let i = 0; i < qVecFloat32.length; i++) {
                queryNormSq += qVecFloat32[i] * qVecFloat32[i];
            }

            // --- GPU BUFFERS & COMMAND ENCODING ---
            queryBuffer = this.device.createBuffer({
                size: qVecFloat32.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            });
            new Float32Array(queryBuffer.getMappedRange()).set(qVecFloat32);
            queryBuffer.unmap();

            dbBuffer = this.device.createBuffer({
                size: dbFlattened.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            });
            new Float32Array(dbBuffer.getMappedRange()).set(dbFlattened);
            dbBuffer.unmap();
            
            const scoreBufferSize = numVectors * Float32Array.BYTES_PER_ELEMENT;
            scoreBuffer = this.device.createBuffer({
                size: scoreBufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            stagingBuffer = this.device.createBuffer({
                size: scoreBufferSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
            });

            const uniformData = new Float32Array([
                numVectors, vectorDimension, queryNormSq, 0
            ]);
            uniformBuffer = this.device.createBuffer({
                size: uniformData.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            });
            new Float32Array(uniformBuffer.getMappedRange()).set(uniformData);
            uniformBuffer.unmap();

            const pipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: { module: this.searchShaderModule, entryPoint: 'main' },
            });

            const bindGroup = this.device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } },
                    { binding: 1, resource: { buffer: queryBuffer } },
                    { binding: 2, resource: { buffer: dbBuffer } },
                    { binding: 3, resource: { buffer: scoreBuffer } },
                ],
            });

            const commandEncoder = this.device.createCommandEncoder();
            const passEncoder = commandEncoder.beginComputePass();
            passEncoder.setPipeline(pipeline);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.dispatchWorkgroups(Math.ceil(numVectors / 64)); 
            passEncoder.end();

            commandEncoder.copyBufferToBuffer(
                scoreBuffer, 0,
                stagingBuffer, 0,
                scoreBufferSize
            );

            this.device.queue.submit([commandEncoder.finish()]);

            await stagingBuffer.mapAsync(GPUMapMode.READ);
            const scores = new Float32Array(stagingBuffer.getMappedRange());
            
            scoredResults = ramVectors.map((v, i) => ({
                ...v,
                score: scores[i]
            }));
            
            stagingBuffer.unmap();

        } catch(e) {
            console.error(`[Elara] GPU Execution failed (Validation Error/Hang). Falling back to CPU.`, e);
            scoredResults = this._cpuSearchFallback(queryVector, ramVectors);
        } finally {
            if (queryBuffer) queryBuffer.destroy();
            if (dbBuffer) dbBuffer.destroy();
            if (scoreBuffer) scoreBuffer.destroy();
            if (stagingBuffer) stagingBuffer.destroy();
            if (uniformBuffer) uniformBuffer.destroy();
        }

        return scoredResults;
    }
    
    _cpuSearchFallback(qVec, ramVectors) {
        console.warn("[Elara] Performing CPU-based vector search (FALLBACK).");
        
        const cosineSimilarity = (a, b) => {
            let dot=0, nA=0, nB=0; for(let i=0; i<a.length; i++) { dot+=a[i]*b[i]; nA+=a[i]*a[i]; nB+=b[i]*b[i]; }
            return dot/(Math.sqrt(nA)*Math.sqrt(nB)) || 0;
        };
        return ramVectors.map(v => ({ ...v, score: cosineSimilarity(qVec, v.vector) }));
    }
}

// Export the Elara_VectorEngine class
export { Elara_VectorEngine };
