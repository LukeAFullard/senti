/**
 * @file tests/test_state_machine.js
 * Unit test suite for js/core/00-state-machine.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const FSM = require('../js/core/00-state-machine.js');

test('SentiStateMachine exports', () => {
  assert.ok(FSM && typeof FSM === 'object');
  assert.equal(typeof FSM.StateMachine, 'function');
  assert.equal(typeof FSM.createMachine, 'function');
  assert.equal(typeof FSM.getMachine, 'function');
  assert.equal(typeof FSM.getAllSnapshots, 'function');
  assert.ok(FSM.schemas && typeof FSM.schemas === 'object');
  assert.ok(FSM.schemas.S2_PIPELINE);
  assert.ok(FSM.schemas.MAP_INTERACTION);
  assert.ok(FSM.schemas.AQ_DASHBOARD);
});

test('StateMachine lifecycle and transitions', () => {
  const machine = FSM.createMachine({
    id: 'test-flow',
    initial: 'IDLE',
    context: { count: 0 },
    states: {
      IDLE: {
        on: { START: 'RUNNING' }
      },
      RUNNING: {
        on: {
          STOP: 'IDLE',
          INCREMENT: {
            target: 'RUNNING',
            action: (ctx) => { ctx.count++; }
          }
        }
      }
    }
  });

  assert.equal(machine.getState(), 'IDLE');
  assert.equal(machine.matches('IDLE'), true);
  assert.equal(machine.can('START'), true);
  assert.equal(machine.can('STOP'), false);

  // Transition to RUNNING
  const transitioned = machine.send('START');
  assert.equal(transitioned, true);
  assert.equal(machine.getState(), 'RUNNING');
  assert.equal(machine.matches('RUNNING'), true);

  // Invalid transition rejected
  const rejected = machine.send('START');
  assert.equal(rejected, false);
  assert.equal(machine.getState(), 'RUNNING');

  // Transition with action
  machine.send('INCREMENT');
  assert.equal(machine.getContext().count, 1);
  machine.send('INCREMENT');
  assert.equal(machine.getContext().count, 2);

  // Transition back to IDLE
  machine.send('STOP');
  assert.equal(machine.getState(), 'IDLE');
});

test('Guards on state transitions', () => {
  const machine = FSM.createMachine({
    id: 'test-guards',
    initial: 'LOCKED',
    context: { attempts: 0 },
    states: {
      LOCKED: {
        on: {
          UNLOCK: {
            target: 'UNLOCKED',
            guard: (ctx, payload) => payload && payload.code === '1234'
          }
        }
      },
      UNLOCKED: {
        on: { LOCK: 'LOCKED' }
      }
    }
  });

  // Wrong code fails guard
  assert.equal(machine.send('UNLOCK', { code: '0000' }), false);
  assert.equal(machine.getState(), 'LOCKED');

  // Correct code passes guard
  assert.equal(machine.send('UNLOCK', { code: '1234' }), true);
  assert.equal(machine.getState(), 'UNLOCKED');
});

test('Pub/Sub listener and AX Snapshot API', () => {
  const machine = FSM.createMachine({
    id: 'test-pubsub',
    initial: 'A',
    states: {
      A: { on: { GO: 'B' } },
      B: { on: { GO: 'C' } },
      C: { on: { RESET: 'A' } }
    }
  });

  const observed = [];
  const unsubscribe = machine.subscribe((current, prev, event) => {
    observed.push({ current, prev, event });
  });

  // Initial subscription notification
  assert.equal(observed.length, 1);
  assert.equal(observed[0].current, 'A');

  machine.send('GO');
  assert.equal(observed.length, 2);
  assert.equal(observed[1].current, 'B');
  assert.equal(observed[1].prev, 'A');

  // Test Snapshot for Agents (AX)
  const snapshot = machine.getSnapshot();
  assert.equal(snapshot.id, 'test-pubsub');
  assert.equal(snapshot.state, 'B');
  assert.deepEqual(snapshot.allowedEvents, ['GO']);

  // Global registry check
  const all = FSM.getAllSnapshots();
  assert.ok(all['test-pubsub']);
  assert.equal(all['test-pubsub'].state, 'B');

  unsubscribe();
  machine.send('GO');
  // Subscriber not called after unsubscribe
  assert.equal(observed.length, 2);
});

test('Predefined S2 Pipeline schema validation', () => {
  const s2 = FSM.createMachine(FSM.schemas.S2_PIPELINE);
  assert.equal(s2.getState(), 'UNINITIALIZED');

  assert.equal(s2.send('SET_AOI', { bbox: [10, 40, 11, 41] }), true);
  assert.equal(s2.getState(), 'AOI_READY');

  assert.equal(s2.send('START_SEARCH'), true);
  assert.equal(s2.getState(), 'SEARCHING_STAC');

  assert.equal(s2.send('STAC_SUCCESS', { sceneCount: 5 }), true);
  assert.equal(s2.getState(), 'LOADING_DATA');

  assert.equal(s2.send('DATA_LOADED'), true);
  assert.equal(s2.getState(), 'RENDERING_SCENE');

  assert.equal(s2.send('RENDER_SUCCESS'), true);
  assert.equal(s2.getState(), 'DISPLAY_READY');

  assert.deepEqual(s2.getAllowedEvents().sort(), [
    'CHANGE_MODE',
    'CHANGE_TEMPORAL',
    'CLEAR_AOI',
    'SELECT_SCENE',
    'START_SEARCH'
  ].sort());
});

test('Predefined Map Interaction schema validation', () => {
  const mapMachine = FSM.createMachine(FSM.schemas.MAP_INTERACTION);
  assert.equal(mapMachine.getState(), 'IDLE');

  assert.equal(mapMachine.send('ENABLE_POINT_MODE'), true);
  assert.equal(mapMachine.getState(), 'POINT_PROBING');

  // Starting AOI draw disables point mode
  assert.equal(mapMachine.send('DRAW_AOI_START'), true);
  assert.equal(mapMachine.getState(), 'DRAWING_AOI');

  assert.equal(mapMachine.send('AOI_COMPLETE'), true);
  assert.equal(mapMachine.getState(), 'IDLE');

  // Drawing transect line
  assert.equal(mapMachine.send('DRAW_TRANSECT_START'), true);
  assert.equal(mapMachine.getState(), 'DRAWING_TRANSECT');

  assert.equal(mapMachine.send('TRANSECT_COMPLETE'), true);
  assert.equal(mapMachine.getState(), 'TRANSECT_ACTIVE');

  assert.equal(mapMachine.send('CLEAR_TRANSECT'), true);
  assert.equal(mapMachine.getState(), 'IDLE');
});

test('Predefined AQ Dashboard schema validation', () => {
  const aq = FSM.createMachine(FSM.schemas.AQ_DASHBOARD);
  assert.equal(aq.getState(), 'IDLE');

  assert.equal(aq.send('START_LOAD'), true);
  assert.equal(aq.getState(), 'LOADING_DATA');

  assert.equal(aq.send('LOAD_SUCCESS'), true);
  assert.equal(aq.getState(), 'DATA_LOADED');

  assert.equal(aq.send('VIEW_SCATTER'), true);
  assert.equal(aq.getState(), 'SCATTER_ANALYSIS');

  assert.equal(aq.send('VIEW_TIMELINE'), true);
  assert.equal(aq.getState(), 'DATA_LOADED');
});

test('Predefined Seasonal Anomaly schema validation', () => {
  const sa = FSM.createMachine(FSM.schemas.SEASONAL_ANOMALY);
  assert.equal(sa.getState(), 'DISABLED');

  assert.equal(sa.send('ENABLE'), true);
  assert.equal(sa.getState(), 'STANDBY');

  assert.equal(sa.send('START_CALC'), true);
  assert.equal(sa.getState(), 'CALCULATING');

  assert.equal(sa.send('CALC_SUCCESS'), true);
  assert.equal(sa.getState(), 'ANOMALY_DISPLAYED');

  assert.equal(sa.send('CLEAR'), true);
  assert.equal(sa.getState(), 'STANDBY');
});

test('Predefined Radar Workflow schema validation', () => {
  const rw = FSM.createMachine(FSM.schemas.RADAR_WORKFLOW);
  assert.equal(rw.getState(), 'IDLE');

  assert.equal(rw.send('START_SEARCH'), true);
  assert.equal(rw.getState(), 'SEARCHING');

  assert.equal(rw.send('SEARCH_SUCCESS'), true);
  assert.equal(rw.getState(), 'SCENES_FOUND');

  assert.equal(rw.send('SELECT_SCENE'), true);
  assert.equal(rw.getState(), 'RENDERING_RADAR');

  assert.equal(rw.send('RENDER_SUCCESS'), true);
  assert.equal(rw.getState(), 'RADAR_ACTIVE');

  assert.equal(rw.send('START_COMPARE'), true);
  assert.equal(rw.getState(), 'COMPARING_OPTICAL_RADAR');

  assert.equal(rw.send('CLEAR_COMPARE'), true);
  assert.equal(rw.getState(), 'RADAR_ACTIVE');
});

test('Agent Experience (AX) global registry and dispatch helper', () => {
  // Simulate browser environment with window object
  global.window = global;
  const testAgentMachine = FSM.createMachine({
    id: 'agent-test',
    initial: 'READY',
    states: {
      READY: { on: { RUN: 'RUNNING' } },
      RUNNING: { on: { STOP: 'READY' } }
    }
  });

  assert.ok(global.window.__SENTI_MACHINES__);
  assert.equal(global.window.__SENTI_MACHINES__['agent-test'], testAgentMachine);
  assert.equal(typeof global.window.__SENTI_DISPATCH__, 'function');

  const dispatched = global.window.__SENTI_DISPATCH__('agent-test', 'RUN', { agent: 'antigravity' });
  assert.equal(dispatched, true);
  assert.equal(testAgentMachine.getState(), 'RUNNING');
  assert.equal(testAgentMachine.getContext().agent, 'antigravity');

  const allSnapshots = FSM.getAllSnapshots();
  assert.ok(allSnapshots['agent-test']);
  assert.equal(allSnapshots['agent-test'].state, 'RUNNING');
  assert.deepEqual(allSnapshots['agent-test'].allowedEvents, ['STOP']);

  delete global.window;
});


