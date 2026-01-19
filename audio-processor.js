
/**
 * audio-processor.js
 * This file defines an AudioWorkletProcessor responsible for capturing raw audio data
 * from the microphone input and passing it to the main thread. This approach moves
 * audio processing off the main thread to prevent performance bottlenecks and audio glitches.
 */
class AudioStreamProcessor extends AudioWorkletProcessor {
  /**
   * The process method is called for each block of audio data.
   * @param {Float32Array[][]} inputs - An array of inputs, each containing channels of audio data.
   * @returns {boolean} - Returns true to keep the processor alive.
   */
  process(inputs) {
    // We only expect one input, and we'll use the first channel of that input.
    const input = inputs[0];
    if (input.length > 0) {
      const channelData = input[0];
      // Post the Float32Array data to the main thread.
      // A copy is made automatically, allowing continuous processing without transferring ownership.
      this.port.postMessage(channelData);
    }
    // Indicate that the processor should remain active.
    return true;
  }
}

registerProcessor('audio-stream-processor', AudioStreamProcessor);
