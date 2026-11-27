// Writes mod/assets/question.wav: the soft two-note chime played when a question waits while the run goes on.
// It is synthesised here, so the clip has no third-party source and can be regenerated: node scripts/make-question-sound.mjs
import { writeFileSync } from "node:fs";

const RATE = 22050;
const NOTES = [
  { freq: 880, start: 0, length: 0.22 }, // A5
  { freq: 1318.5, start: 0.13, length: 0.3 }, // E6, a fifth up
];
const PEAK = 0.18; // well under the stop sound, so the two never read as the same alert
const total = Math.ceil(RATE * Math.max(...NOTES.map(({ start, length }) => start + length)));
const samples = new Float64Array(total);
for (const { freq, start, length } of NOTES) {
  const from = Math.floor(start * RATE);
  const count = Math.floor(length * RATE);
  for (let i = 0; i < count; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.008);
    const decay = Math.exp(-t * 9);
    samples[from + i] += Math.sin(2 * Math.PI * freq * t) * attack * decay;
  }
}
const pcm = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * PEAK)) * 32767), i * 2);
const header = Buffer.alloc(44);
header.write("RIFF", 0, "ascii");
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8, "ascii");
header.write("fmt ", 12, "ascii");
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36, "ascii");
header.writeUInt32LE(pcm.length, 40);
writeFileSync(new URL("../mod/assets/question.wav", import.meta.url), Buffer.concat([header, pcm]));
