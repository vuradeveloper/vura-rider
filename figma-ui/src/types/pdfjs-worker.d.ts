// pdf.js is shipped in two pieces: the API in pdf.mjs and the parser in
// pdf.worker.mjs. lib/carscan.ts loads the parser on the MAIN thread (see the
// note in that file), which is a path pdf.js supports but only types for the
// main module, so the worker module is declared here.

declare module "pdfjs-dist/legacy/build/pdf.worker.min.mjs" {
  /** Registered on `globalThis.pdfjsWorker`; pdf.js reads it from there. */
  export const WorkerMessageHandler: unknown;
}
