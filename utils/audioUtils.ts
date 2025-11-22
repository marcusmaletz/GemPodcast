
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
  
  // Align to 2 bytes (16-bit) to avoid RangeError on Int16Array creation
  // If length is odd, drop the last byte
  let bufferToUse = bytes.buffer;
  if (bytes.byteLength % 2 !== 0) {
    bufferToUse = bytes.buffer.slice(0, bytes.byteLength - 1);
  }
  
  // Manual PCM decoding (Assumes 24kHz, Mono, 16-bit Little Endian based on typical Gemini output)
  const dataInt16 = new Int16Array(bufferToUse);
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
 * Decodes a Blob (MP3/WAV) into an AudioBuffer.
 */
export const decodeAudioBlob = async (
  blob: Blob,
  ctx: AudioContext
): Promise<AudioBuffer> => {
  const arrayBuffer = await blob.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
};

/**
 * Mixes a podcast sequence: Intro -> (Voice + Background) -> Outro.
 * Uses OfflineAudioContext to handle different sample rates (resampling) automatically.
 */
export const mixPodcastSequence = async (
  voiceBuffer: AudioBuffer,
  backgroundBuffer: AudioBuffer | null,
  introBuffer: AudioBuffer | null,
  outroBuffer: AudioBuffer | null,
  musicVolume: number,
  introVolume: number,
  outroVolume: number
): Promise<AudioBuffer> => {
  // Target standard sample rate for MP3 (44.1kHz)
  const outputSampleRate = 44100; 
  const numberOfChannels = 2; // Stereo output

  // Calculate durations in seconds
  const introDur = introBuffer ? introBuffer.duration : 0;
  const voiceDur = voiceBuffer.duration;
  const outroDur = outroBuffer ? outroBuffer.duration : 0;
  
  const totalDuration = introDur + voiceDur + outroDur;
  
  // Ensure minimum length to avoid constructor error if duration is 0
  const safeDuration = Math.max(totalDuration, 0.001);
  const length = Math.ceil(safeDuration * outputSampleRate);
  
  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, outputSampleRate);

  // Helper to create and connect source with gain
  const createSource = (buffer: AudioBuffer, vol: number, startTime: number, stopTime?: number, loop: boolean = false) => {
    // Ensure volume is finite and non-negative
    const safeVol = isFinite(vol) && vol >= 0 ? vol : 0;

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = safeVol;

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    source.start(startTime);
    if (stopTime !== undefined) {
      // Ensure stop time is after start time
      if (stopTime > startTime) {
        source.stop(stopTime);
      }
    }
    return source;
  };

  // 1. Intro
  if (introBuffer) {
    createSource(introBuffer, introVolume, 0);
  }

  // 2. Voice (Standard volume 1.0)
  createSource(voiceBuffer, 1.0, introDur);

  // 3. Background Music
  if (backgroundBuffer) {
    createSource(backgroundBuffer, musicVolume, introDur, introDur + voiceDur, true);
  }

  // 4. Outro
  if (outroBuffer) {
    createSource(outroBuffer, outroVolume, introDur + voiceDur);
  }

  // Render
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
};

/**
 * Converts an AudioBuffer to a WAV Blob.
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
  setUint16(16); // 16-bit

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < buffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos])); 
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; 
      view.setInt16(44 + offset, sample, true); 
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
 */
export const audioBufferToMp3 = (buffer: AudioBuffer): Blob => {
  // @ts-ignore
  const lamejs = window.lamejs;
  if (!lamejs) {
    throw new Error("Lamejs library not found. Please ensure internet connection or script loading.");
  }

  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const kbps = 320; 
  
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Int8Array[] = [];

  const rawLeft = buffer.getChannelData(0);
  const rawRight = channels > 1 ? buffer.getChannelData(1) : rawLeft;
  const length = rawLeft.length;
  
  const sampleBlockSize = 1152; 
  const leftInt16 = new Int16Array(sampleBlockSize);
  const rightInt16 = new Int16Array(sampleBlockSize);
  
  for (let i = 0; i < length; i += sampleBlockSize) {
    const chunkLen = Math.min(sampleBlockSize, length - i);
    
    for (let j = 0; j < chunkLen; j++) {
      const l = Math.max(-1, Math.min(1, rawLeft[i + j]));
      const r = Math.max(-1, Math.min(1, rawRight[i + j]));
      
      leftInt16[j] = (l < 0 ? l * 32768 : l * 32767);
      rightInt16[j] = (r < 0 ? r * 32768 : r * 32767);
    }

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

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
};

/**
 * Helper to convert a Blob to a Base64 string.
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // Remove data URL prefix (e.g. "data:audio/mp3;base64,")
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};


// --- INDEXED DB PERSISTENCE HELPERS ---

const DB_NAME = 'GeminiPodcastStudioDB';
const STORE_NAME = 'audioFiles';
const DB_VERSION = 1;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      console.error("IndexedDB Error:", request.error);
      reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
};

export const storeAudioFile = async (key: string, file: File): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    // We store the object. Note: File objects are supported in modern IndexedDB.
    const data = { name: file.name, blob: file };
    const req = store.put(data, key);
    
    // Use oncomplete to ensure transaction is fully committed
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error("IndexedDB Transaction Error:", tx.error);
      reject(tx.error);
    };
  });
};

export const getAudioFile = async (key: string): Promise<{ name: string, blob: Blob } | null> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      
      req.onsuccess = () => {
        resolve(req.result || null);
      };
      req.onerror = () => {
        console.error("IndexedDB Read Error:", req.error);
        reject(req.error);
      };
    });
  } catch (err) {
    console.error("Error opening DB for reading:", err);
    return null;
  }
};

export const deleteAudioFile = async (key: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      console.error("IndexedDB Delete Error:", tx.error);
      reject(tx.error);
    };
  });
};
