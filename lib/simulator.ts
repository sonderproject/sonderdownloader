// Property Simulator — integration point.
//
// The /simulator page stages photos + listing facts here. When the
// simulator prompt is ready, drop it into SIMULATOR_PROMPT below and
// implement runSimulation(); the page's Generate button is already
// wired to call it with the user's selection.

import type { ListingFacts } from "./sources";
import type { RoomKey } from "./rooms";

// sessionStorage key the main page writes and /simulator reads.
export const SIMULATOR_STAGE_KEY = "sonder-simulator-v1";

export type SimulatorPhoto = {
  id: string;
  url: string;
  room: RoomKey;
};

export type SimulatorStage = {
  photos: SimulatorPhoto[];
  facts: ListingFacts;
  slug: string;
  sourceUrl?: string;
  ts: number;
};

export type SimulatorInput = {
  photos: SimulatorPhoto[]; // the user's selection, walkthrough order
  facts: ListingFacts;
  slug: string;
};

export type SimulatorResult = {
  // Shape TBD by the simulator prompt — e.g. generated image URLs,
  // a video blob, or a text report.
  outputs: unknown[];
};

// ── PASTE THE SIMULATOR PROMPT HERE ─────────────────────────────────
export const SIMULATOR_PROMPT = "";

export function simulatorReady(): boolean {
  return SIMULATOR_PROMPT.trim().length > 0;
}

export async function runSimulation(
  input: SimulatorInput,
): Promise<SimulatorResult> {
  void input;
  throw new Error(
    "Simulator prompt not configured yet — add it to lib/simulator.ts.",
  );
}
