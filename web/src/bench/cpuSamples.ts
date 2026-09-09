/**
 * The one number the scene hands the bench, in a module small enough for the scene to import.
 *
 * PRD 7.2's "CPU time per frame in the render loop" is the *scene's* work, not the whole task, and
 * only the scene knows where that starts — so the scene reports it rather than the bench guessing.
 * That makes the writer part of the shipped path while the reader (`BenchRunner`, 622 lines) is
 * not, which is why the two live apart: `EternitiesScene` imports this and lazy-imports the runner,
 * so a visitor who is not benching downloads these six lines and nothing else (review §6.3).
 */

let lastCpuMs = 0

export function recordBenchCpu(ms: number): void {
  lastCpuMs = ms
}

export function benchCpuMs(): number {
  return lastCpuMs
}
