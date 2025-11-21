
/**
 * Decodes a base64 string into an AudioBuffer.
 */
export const decodeBase64Audio = async (
  base64String: string,
  ctx: AudioContext
): Promise<AudioBuffer> => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Manual PCM decoding (Assumes 24kHz, Mono, 16-bit Little Endian based on typical Gemini output)
  const dataInt16 = new Int16Array(bytes.buffer);
  const numChannels = 1;
  const sampleRate = 24000; 
  const frameCount = dataInt16.length / numChannels;
  
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  const channelData = buffer.getChannelData(0);
  
  for (let i = 0; i < frameCount; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  
  return buffer;
};

/**
 * Mixes a voice buffer with a background music buffer.
 * Handles looping the music if it's shorter than the voice.
 */
export const mixAudioBuffers = (
  voiceBuffer: AudioBuffer,
  musicBuffer: AudioBuffer | null,
  musicVolume: number,
  ctx: AudioContext
): AudioBuffer => {
  if (!musicBuffer) return voiceBuffer;

  const channels = voiceBuffer.numberOfChannels; // Usually 1 for TTS
  const outputLength = voiceBuffer.length;
  
  // Create a stereo buffer if music is stereo, otherwise mono
  const outputChannels = Math.max(voiceBuffer.numberOfChannels, musicBuffer.numberOfChannels);
  const mixed = ctx.createBuffer(outputChannels, outputLength, voiceBuffer.sampleRate);

  for (let c = 0; c < outputChannels; c++) {
    // Get voice data (map mono to both channels if output is stereo)
    const voiceChannelIndex = c % voiceBuffer.numberOfChannels;
    const voiceData = voiceBuffer.getChannelData(voiceChannelIndex);
    
    // Get music data (map mono to both channels if output is stereo)
    const musicChannelIndex = c % musicBuffer.numberOfChannels;
    const musicData = musicBuffer.getChannelData(musicChannelIndex);
    
    const outData = mixed.getChannelData(c);

    for (let i = 0; i < outputLength; i++) {
      const voiceSample = voiceData[i];
      
      // Loop music logic
      const musicSample = musicData[i % musicBuffer.length];
      
      // Simple mix with hard limiter
      let mixedSample = voiceSample + (musicSample * musicVolume);
      
      // Fade out music at the very end (last 2 seconds)
      const remaining = outputLength - i;
      const fadeLength = 2 * mixed.sampleRate;
      if (remaining < fadeLength) {
        const fade = remaining / fadeLength;
        // Keep voice, fade music out
        mixedSample = voiceSample + (musicSample * musicVolume * fade);
      }

      if (mixedSample > 1) mixedSample = 1;
      if (mixedSample < -1) mixedSample = -1;
      
      outData[i] = mixedSample;
    }
  }
  return mixed;
};

/**
 * Generates a simple procedural background track to avoid CORS/External dependency issues.
 */
export const generateProceduralTrack = (
  type: 'chill' | 'news',
  duration: number,
  ctx: AudioContext
): AudioBuffer => {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(duration * sampleRate);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let sampleL = 0;
    let sampleR = 0;

    if (type === 'chill') {
      // Ethereal Pad: Low freq sine waves + gentle noise
      // Chord: A maj7 (A=220, C#=277, E=329, G#=415)
      const f1 = Math.sin(t * 220 * Math.PI * 2);
      const f2 = Math.sin(t * 277 * Math.PI * 2);
      const f3 = Math.sin(t * 329 * Math.PI * 2);
      
      // Slow modulation
      const mod = Math.sin(t * 0.5 * Math.PI * 2) * 0.5 + 0.5;
      
      sampleL = (f1 + f2) * 0.1 * mod;
      sampleR = (f2 + f3) * 0.1 * (1 - mod);
      
      // Add some pinkish noise floor
      const noise = (Math.random() * 2 - 1) * 0.02;
      sampleL += noise;
      sampleR += noise;

    } else if (type === 'news') {
      // News Pulse: Rhythmic high hat pattern + low drone
      const beat = t % 0.5; // 120 BPM
      let pulse = 0;
      if (beat < 0.05) pulse = (Math.random() * 2 - 1) * 0.1; // Hi-hat tick
      
      // Low drone D=146Hz
      const drone = Math.sin(t * 146 * Math.PI * 2) * 0.05;
      
      sampleL = pulse + drone;
      sampleR = pulse * 0.8 + drone;
    }

    left[i] = sampleL;
    right[i] = sampleR;
  }

  return buffer;
};

/**
 * Converts an AudioBuffer to a WAV Blob.
 * Used for previews.
 */
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this writer)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([bufferArr], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
};

/**
 * Converts an AudioBuffer to a High Quality MP3 (320kbps) Blob.
 * Uses lamejs (assumed to be loaded globally).
 */
export const audioBufferToMp3 = (buffer: AudioBuffer): Blob => {
  // @ts-ignore
  const lamejs = window.lamejs;
  if (!lamejs) {
    throw new Error("Lamejs library not found");
  }

  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = 320; // High Quality
  
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Int8Array[] = [];

  // Prepare data for encoding (Float to Int16)
  const rawLeft = buffer.getChannelData(0);
  const rawRight = channels > 1 ? buffer.getChannelData(1) : rawLeft;
  const length = rawLeft.length;
  
  const sampleBlockSize = 1152; // Must be multiples of 576 for lamejs
  const leftInt16 = new Int16Array(sampleBlockSize);
  const rightInt16 = new Int16Array(sampleBlockSize);
  
  for (let i = 0; i < length; i += sampleBlockSize) {
    const chunkLen = Math.min(sampleBlockSize, length - i);
    
    // Fill chunk buffers
    for (let j = 0; j < chunkLen; j++) {
      // Clamp and scale
      const l = Math.max(-1, Math.min(1, rawLeft[i + j]));
      const r = Math.max(-1, Math.min(1, rawRight[i + j]));
      
      leftInt16[j] = (l < 0 ? l * 32768 : l * 32767);
      rightInt16[j] = (r < 0 ? r * 32768 : r * 32767);
    }

    // If last chunk is smaller, we pass the subarray
    const leftChunk = (chunkLen === sampleBlockSize) ? leftInt16 : leftInt16.subarray(0, chunkLen);
    const rightChunk = (chunkLen === sampleBlockSize) ? rightInt16 : rightInt16.subarray(0, chunkLen);
    
    let mp3buf;
    if (channels === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    } else {
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    }
    
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }

  // Flush buffer
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
};
