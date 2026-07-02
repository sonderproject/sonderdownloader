// Bridge between the downloader and Sonder Simulation.
//
// "Send to Simulator" on the main page stages the current photo set +
// listing facts under this key; /simulator/projects/new picks it up
// and pre-fills a new project (photos become gallery media, room
// labels become hotspots, facts become property info).

import type { ListingFacts } from "./sources";
import type { RoomKey } from "./rooms";

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
