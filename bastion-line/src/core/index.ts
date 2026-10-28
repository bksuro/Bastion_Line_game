/**
 * src/core entry module (SPEC.md section 2.1). Owner: agent 5 (Waves, Economy & Agents).
 * Event bus, data loading, context factory and the game (state machine, fixed-step loop, commands).
 * Other folders import only from this file.
 */
import type { LoadGameData, CreateEventBus, CreateGameContext, CreateGame } from '../types';
import { createMapQueries } from '../map';
import * as bus from './EventBus';
import * as dataLoader from './data';
import * as game from './game';

export const loadGameData: LoadGameData = dataLoader.loadGameData;
export const createEventBus: CreateEventBus = bus.createEventBus;
export const createGameContext: CreateGameContext = (data, map, agents) => ({
  data,
  map,
  mapQueries: createMapQueries(map),
  events: createEventBus(),
  agents,
});
export const createGame: CreateGame = game.createGame;

/* Extras for tests. */
export { createInitialState } from './state';
export { LOOP_LIMITS } from './game';
