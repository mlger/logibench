import type { Ne555AstableInfo, PartInstance, Project } from './types';
import type { NetlistResult } from './netlist';
import { holeKey } from './geometry';

/**
 * Real NE555 astable detection (P4-a): find the RA / RB / C network wired to a
 * `555` chip from the parts the user actually placed, so
 * f = 1.44/((RA+2RB)·C) emerges from the bench, not from a prop.
 *
 * Canonical astable (TI SLFS022 §8.3.2, Fig. 12):
 *   RA: VCC(8) → DISCH(7)
 *   RB: DISCH(7) → THRES(6)
 *   C:  THRES(6) → GND(1)
 *   TRIG(2) tied to THRES(6) — the cap node drives both comparators.
 * RESET̅(4) → VCC when unused; CTRL(5) open (default ⅓–⅔ VCC thresholds).
 *
 * The resistor/cap are ELEMENTS in the netlist model (not unions), so the
 * network is found by scanning two-terminal parts against the pin nets.
 * Never throws; returns null whenever the topology is incomplete.
 */
export function ne555Astable(
  project: Project,
  netlist: NetlistResult,
  part: PartInstance,
): Ne555AstableInfo | null {
  if (part.type !== 'chip' || part.defId !== '555' || part.pins.length < 8) return null;
  const net = (pin: number) => netlist.pinNet(part.id, pin);
  const vcc = net(8);
  const gnd = net(1);
  const disch = net(7);
  const thresh = net(6);
  const trig = net(2);
  if (vcc === undefined || gnd === undefined || disch === undefined || thresh === undefined) return null;

  let ra: number | undefined;
  let rb: number | undefined;
  let c: number | undefined;
  for (const p of project.parts) {
    if (p.id === part.id || p.pins.length < 2) continue;
    const a = netlist.holeNet.get(holeKey(p.pins[0]));
    const b = netlist.holeNet.get(holeKey(p.pins[1]));
    if (a === undefined || b === undefined || a === b) continue;
    if (p.type === 'resistor') {
      const ohms = p.props.ohms ?? 330;
      if ((a === vcc && b === disch) || (b === vcc && a === disch)) ra = ohms;
      else if ((a === disch && b === thresh) || (b === disch && a === thresh)) rb = ohms;
    } else if (p.type === 'cap') {
      if ((a === thresh && b === gnd) || (b === thresh && a === gnd)) c = p.props.farads ?? 100e-9;
    }
  }

  if (ra === undefined || rb === undefined || c === undefined) return null;
  if (ra <= 0 || rb <= 0 || c <= 0) return null;
  const denom = (ra + 2 * rb) * c;
  if (denom <= 0) return null;

  return {
    ra,
    rb,
    c,
    freqHz: 1.44 / denom,
    dutyHigh: (ra + rb) / (ra + 2 * rb),
    trigTied: trig === thresh,
  };
}
