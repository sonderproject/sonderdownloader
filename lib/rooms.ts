// Canonical room taxonomy + walkthrough order + prompt templates.
// Used to auto-sort photos into "walkthrough order" and to synthesize
// prompts for Kling / Higgsfield / Runway.

export type RoomKey =
  | "unknown"
  | "exterior_front"
  | "aerial"
  | "entryway"
  | "living_room"
  | "family_room"
  | "dining_room"
  | "kitchen"
  | "pantry"
  | "office"
  | "primary_bedroom"
  | "bedroom"
  | "primary_bathroom"
  | "bathroom"
  | "laundry"
  | "closet"
  | "garage"
  | "basement"
  | "patio"
  | "pool"
  | "yard"
  | "exterior_back"
  | "detail";

export const ROOM_LABEL: Record<RoomKey, string> = {
  unknown: "Unlabeled",
  exterior_front: "Exterior · Front",
  aerial: "Aerial",
  entryway: "Entryway",
  living_room: "Living Room",
  family_room: "Family Room",
  dining_room: "Dining Room",
  kitchen: "Kitchen",
  pantry: "Pantry",
  office: "Office",
  primary_bedroom: "Primary Bedroom",
  bedroom: "Bedroom",
  primary_bathroom: "Primary Bathroom",
  bathroom: "Bathroom",
  laundry: "Laundry",
  closet: "Closet",
  garage: "Garage",
  basement: "Basement",
  patio: "Patio",
  pool: "Pool",
  yard: "Yard",
  exterior_back: "Exterior · Back",
  detail: "Detail",
};

// Walkthrough order — how the sequence should read spatially so the
// generated video feels like a real house tour.
const WALKTHROUGH_ORDER: RoomKey[] = [
  "exterior_front",
  "aerial",
  "entryway",
  "living_room",
  "family_room",
  "dining_room",
  "kitchen",
  "pantry",
  "office",
  "primary_bedroom",
  "primary_bathroom",
  "bedroom",
  "bathroom",
  "closet",
  "laundry",
  "basement",
  "garage",
  "patio",
  "pool",
  "yard",
  "exterior_back",
  "detail",
  "unknown",
];

const ORDER_RANK: Record<RoomKey, number> = Object.fromEntries(
  WALKTHROUGH_ORDER.map((k, i) => [k, i]),
) as Record<RoomKey, number>;

export function walkthroughRank(k: RoomKey): number {
  return ORDER_RANK[k] ?? 999;
}

// Prompt templates for AI video generators. Written to work well with
// Kling 1.6 / Higgsfield DoP / Runway Gen-3 style prompts.
const PROMPT_TEMPLATES: Record<RoomKey, string> = {
  unknown:
    "Cinematic slow dolly forward, subtle handheld motion, warm afternoon light, 24mm lens, shallow depth of field.",
  exterior_front:
    "Cinematic slow reveal of a residential home exterior, gentle push-in from the street, golden hour light, subtle drone-like drift, 24mm lens.",
  aerial:
    "Slow aerial orbit around the property, mild parallax, high altitude to medium, golden hour, sharp architectural detail.",
  entryway:
    "Steady walk-through the front door into the entryway, subtle floor-tracking motion, natural window light, 24mm wide lens.",
  living_room:
    "Cinematic slow dolly forward through the living room, subtle parallax past furniture, warm ambient light, 24mm lens, shallow depth of field.",
  family_room:
    "Slow lateral tracking shot across the family room, warm side light, subtle depth cues, 28mm lens.",
  dining_room:
    "Elegant slow dolly around the dining table, gentle rotation, warm chandelier light, 35mm lens.",
  kitchen:
    "Cinematic push-in across kitchen countertops, subtle sparkle on stone surfaces, warm midday light, 24mm wide lens, marble and matte finishes.",
  pantry:
    "Steady reveal of pantry interior, soft overhead light, symmetric composition.",
  office:
    "Slow dolly forward through home office, focus rack from desk to window, natural side light, 35mm lens.",
  primary_bedroom:
    "Cinematic slow reveal of the primary bedroom, gentle push-in from doorway, soft morning light through curtains, 24mm lens.",
  bedroom:
    "Slow dolly forward into a bedroom, subtle parallax past bed, natural window light, 28mm lens.",
  primary_bathroom:
    "Elegant slow pan across the primary bathroom, marble and glass detail, natural window light, 35mm lens.",
  bathroom:
    "Steady slow reveal of the bathroom, clean symmetric composition, natural light, 35mm lens.",
  laundry: "Steady static-to-slow-drift reveal of the laundry room, cool overhead light.",
  closet:
    "Slow reveal walking into the closet, warm interior light, symmetric shelves, 24mm wide lens.",
  garage:
    "Wide reveal of the garage interior, natural fall of daylight from the door, 24mm lens.",
  basement: "Steady dolly through the basement space, cool ambient light, 24mm lens.",
  patio:
    "Slow drift across the patio, dappled afternoon light, gentle plant motion in breeze, 35mm lens.",
  pool:
    "Cinematic slow push-in over the pool, subtle water shimmer, sunset light, 35mm lens.",
  yard:
    "Aerial-style slow drift across the backyard, natural light, mild parallax on trees, 24mm lens.",
  exterior_back:
    "Cinematic reveal of the home's rear elevation, slow drone-like drift, golden hour, 24mm lens.",
  detail:
    "Extreme close-up macro drift across an architectural detail, shallow depth of field, warm rim light, 85mm lens.",
};

export function promptFor(room: RoomKey): string {
  return PROMPT_TEMPLATES[room];
}

export const ROOM_KEYS: RoomKey[] = Object.keys(ROOM_LABEL) as RoomKey[];
