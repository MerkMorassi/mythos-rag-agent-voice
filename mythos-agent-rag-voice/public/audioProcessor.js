// audioProcessor.js
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input.length > 0) {
      const pcmData = input[0];
      this.port.postMessage(pcmData);
    }
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor);
