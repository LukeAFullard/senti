/**
 * @file js/core/00-state-machine.js
 * Universal, zero-DOM-dependency Finite State Machine (FSM) & State Bus engine.
 *
 * Designed to elevate UX, DX, and AX (Agent Experience):
 * - UX: Deterministic state flows, eliminates race conditions, enables state-driven UI feedback.
 * - DX: Explicit, self-documenting transition schemas, central transition logger, pub/sub subscribers.
 * - AX: Full machine-readable state snapshots, deterministic action dispatching (`__SENTI_DISPATCH__`),
 *       and introspection APIs (`__SENTI_MACHINES__`) for automated tools and AI coding agents.
 *
 * UMD module: CommonJS (Node.js) + Browser window.SentiStateMachine.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SentiStateMachine = factory();
    if (typeof window !== 'undefined') {
      window.SentiStateMachine = root.SentiStateMachine;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Global registry of all active machines in the runtime
  const registry = new Map();

  /**
   * Represents an explicit Finite State Machine with context and pub/sub capabilities.
   */
  class StateMachine {
    /**
     * @param {Object} config
     * @param {string} config.id - Unique identifier for the machine
     * @param {string} config.initial - Initial state name
     * @param {Object} config.states - State definition table: { [state]: { on: { [event]: targetState | { target, guard, action } } } }
     * @param {Object} [config.context={}] - Mutable state context data
     * @param {boolean} [config.logTransitions=false] - Whether to log transitions to console
     */
    constructor(config) {
      if (!config || !config.id || !config.initial || !config.states) {
        throw new Error('StateMachine requires "id", "initial", and "states" definition.');
      }
      this.id = config.id;
      this.initialState = config.initial;
      this.states = config.states;
      this.context = { ...(config.context || {}) };
      this.logTransitions = Boolean(config.logTransitions);

      this.current = this.initialState;
      this.subscribers = new Set();
      this.history = [];
      this.maxHistory = config.maxHistory || 50;

      if (!this.states[this.current]) {
        throw new Error(`Initial state "${this.current}" is not defined in states.`);
      }

      // Record initial history entry
      this._recordHistory(null, null, this.current, 'INIT');
    }

    /**
     * Gets current state name.
     * @returns {string}
     */
    getState() {
      return this.current;
    }

    /**
     * Checks if machine matches a given state.
     * @param {string} stateName
     * @returns {boolean}
     */
    matches(stateName) {
      return this.current === stateName;
    }

    /**
     * Returns list of valid event names from current state.
     * @returns {string[]}
     */
    getAllowedEvents() {
      const stateDef = this.states[this.current];
      return stateDef && stateDef.on ? Object.keys(stateDef.on) : [];
    }

    /**
     * Checks if an event can be handled in the current state.
     * @param {string} event
     * @returns {boolean}
     */
    can(event) {
      const stateDef = this.states[this.current];
      return Boolean(stateDef && stateDef.on && stateDef.on[event]);
    }

    /**
     * Sends an event to trigger a transition.
     *
     * @param {string} event - Event name
     * @param {Object} [payload] - Optional event payload to update context or evaluate guards
     * @returns {boolean} True if transition occurred, false if ignored/rejected
     */
    send(event, payload = {}) {
      const stateDef = this.states[this.current];
      if (!stateDef || !stateDef.on || !stateDef.on[event]) {
        if (this.logTransitions) {
          console.warn(`[FSM:${this.id}] Event "${event}" rejected: no transition from "${this.current}".`);
        }
        return false;
      }

      const transitionDef = stateDef.on[event];
      let targetState = null;
      let guard = null;
      let action = null;

      if (typeof transitionDef === 'string') {
        targetState = transitionDef;
      } else if (typeof transitionDef === 'object' && transitionDef !== null) {
        targetState = transitionDef.target;
        guard = transitionDef.guard;
        action = transitionDef.action;
      }

      if (!targetState || !this.states[targetState]) {
        console.error(`[FSM:${this.id}] Target state "${targetState}" is undefined.`);
        return false;
      }

      // Evaluate guard if specified
      if (typeof guard === 'function' && !guard(this.context, payload)) {
        if (this.logTransitions) {
          console.warn(`[FSM:${this.id}] Guard rejected transition "${this.current}" -> "${targetState}" on "${event}".`);
        }
        return false;
      }

      const prev = this.current;
      this.current = targetState;

      // Update context with payload if provided
      if (payload && typeof payload === 'object') {
        Object.assign(this.context, payload);
      }

      // Execute transition action if specified
      if (typeof action === 'function') {
        try {
          action(this.context, payload);
        } catch (err) {
          console.error(`[FSM:${this.id}] Error in action for "${event}":`, err);
        }
      }

      this._recordHistory(prev, event, this.current, 'TRANSITION');

      if (this.logTransitions) {
        console.log(`[FSM:${this.id}] ${prev} -> ${this.current} (${event})`, this.context);
      }

      // Notify subscribers
      this._notify(prev, event, payload);
      return true;
    }

    /**
     * Updates context data without changing state.
     * @param {Object} partialContext
     */
    setContext(partialContext) {
      if (partialContext && typeof partialContext === 'object') {
        Object.assign(this.context, partialContext);
        this._notify(this.current, 'CONTEXT_UPDATE', partialContext);
      }
    }

    /**
     * Gets a copy of current context.
     * @returns {Object}
     */
    getContext() {
      return { ...this.context };
    }

    /**
     * Subscribes a listener callback to state transitions.
     * @param {Function} listener - (currentState, prevState, event, context) => void
     * @returns {Function} Unsubscribe function
     */
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      this.subscribers.add(listener);
      // Immediately invoke with current state
      try {
        listener(this.current, null, 'SUBSCRIBE', this.context);
      } catch (err) {
        console.error(`[FSM:${this.id}] Subscriber threw error on init:`, err);
      }
      return () => this.subscribers.delete(listener);
    }

    /**
     * Machine-readable state snapshot for Agents (AX) and debugging (DX).
     * @returns {Object}
     */
    getSnapshot() {
      return {
        id: this.id,
        state: this.current,
        allowedEvents: this.getAllowedEvents(),
        context: { ...this.context },
        timestamp: Date.now()
      };
    }

    /**
     * Returns history log of transitions.
     * @returns {Array<Object>}
     */
    getHistory() {
      return this.history.slice();
    }

    /**
     * Resets machine back to initial state.
     * @param {Object} [newContext]
     */
    reset(newContext = null) {
      const prev = this.current;
      this.current = this.initialState;
      if (newContext && typeof newContext === 'object') {
        this.context = { ...newContext };
      }
      this._recordHistory(prev, 'RESET', this.current, 'RESET');
      this._notify(prev, 'RESET', {});
    }

    _recordHistory(from, event, to, type) {
      this.history.push({
        from,
        event,
        to,
        type,
        timestamp: Date.now(),
        context: { ...this.context }
      });
      if (this.history.length > this.maxHistory) {
        this.history.shift();
      }
    }

    _notify(prev, event, payload) {
      for (const listener of this.subscribers) {
        try {
          listener(this.current, prev, event, this.context);
        } catch (err) {
          console.error(`[FSM:${this.id}] Subscriber threw error:`, err);
        }
      }
    }
  }

  // ============================================================================
  // Standard Pre-Defined Machine Schemas for the Senti Application
  // ============================================================================

  /**
   * Sentinel-2 Pipeline FSM Schema:
   * Coordinates STAC discovery, mosaicking, band loading, index calculations, and scene rendering.
   */
  const S2_PIPELINE_SCHEMA = {
    id: 's2-pipeline',
    initial: 'UNINITIALIZED',
    states: {
      UNINITIALIZED: {
        on: {
          SET_AOI: 'AOI_READY'
        }
      },
      AOI_READY: {
        on: {
          START_SEARCH: 'SEARCHING_STAC',
          CLEAR_AOI: 'UNINITIALIZED'
        }
      },
      SEARCHING_STAC: {
        on: {
          STAC_SUCCESS: 'LOADING_DATA',
          STAC_EMPTY: 'NO_SCENES_FOUND',
          ERROR: 'PIPELINE_ERROR',
          CANCEL: 'AOI_READY'
        }
      },
      LOADING_DATA: {
        on: {
          DATA_LOADED: 'RENDERING_SCENE',
          ERROR: 'PIPELINE_ERROR',
          CANCEL: 'AOI_READY'
        }
      },
      RENDERING_SCENE: {
        on: {
          RENDER_SUCCESS: 'DISPLAY_READY',
          ERROR: 'PIPELINE_ERROR'
        }
      },
      DISPLAY_READY: {
        on: {
          SELECT_SCENE: 'RENDERING_SCENE',
          CHANGE_MODE: 'RENDERING_SCENE',
          CHANGE_TEMPORAL: 'RENDERING_SCENE',
          START_SEARCH: 'SEARCHING_STAC',
          CLEAR_AOI: 'UNINITIALIZED'
        }
      },
      NO_SCENES_FOUND: {
        on: {
          START_SEARCH: 'SEARCHING_STAC',
          SET_AOI: 'AOI_READY',
          CLEAR_AOI: 'UNINITIALIZED'
        }
      },
      PIPELINE_ERROR: {
        on: {
          RETRY: 'SEARCHING_STAC',
          SET_AOI: 'AOI_READY',
          CLEAR_AOI: 'UNINITIALIZED'
        }
      }
    }
  };

  /**
   * Map Interaction & Probing FSM Schema:
   * Guarantees mutually exclusive interaction modes (Idle, Point Sampling, Polygon Summary, Transect).
   */
  const MAP_INTERACTION_SCHEMA = {
    id: 'map-interaction',
    initial: 'IDLE',
    states: {
      IDLE: {
        on: {
          ENABLE_POINT_MODE: 'POINT_PROBING',
          DRAW_AOI_START: 'DRAWING_AOI',
          DRAW_TRANSECT_START: 'DRAWING_TRANSECT',
          DRAW_POLYGON_START: 'DRAWING_POLYGON'
        }
      },
      POINT_PROBING: {
        on: {
          DISABLE_POINT_MODE: 'IDLE',
          DRAW_AOI_START: 'DRAWING_AOI',
          CLEAR_POINTS: 'IDLE'
        }
      },
      DRAWING_AOI: {
        on: {
          AOI_COMPLETE: 'IDLE',
          CANCEL: 'IDLE'
        }
      },
      DRAWING_TRANSECT: {
        on: {
          TRANSECT_COMPLETE: 'TRANSECT_ACTIVE',
          CANCEL: 'IDLE'
        }
      },
      TRANSECT_ACTIVE: {
        on: {
          CLEAR_TRANSECT: 'IDLE',
          DRAW_TRANSECT_START: 'DRAWING_TRANSECT',
          ENABLE_POINT_MODE: 'POINT_PROBING',
          DRAW_AOI_START: 'DRAWING_AOI'
        }
      },
      DRAWING_POLYGON: {
        on: {
          POLYGON_COMPLETE: 'POLYGON_ACTIVE',
          CANCEL: 'IDLE'
        }
      },
      POLYGON_ACTIVE: {
        on: {
          CLEAR_POLYGON: 'IDLE',
          DRAW_POLYGON_START: 'DRAWING_POLYGON',
          ENABLE_POINT_MODE: 'POINT_PROBING',
          DRAW_AOI_START: 'DRAWING_AOI'
        }
      }
    }
  };

  /**
   * Air Quality Dashboard FSM Schema:
   * Controls data loading, views, scatter correlation, and ground monitor integration.
   */
  const AQ_DASHBOARD_SCHEMA = {
    id: 'aq-dashboard',
    initial: 'IDLE',
    states: {
      IDLE: {
        on: {
          SELECT_PRESET: 'IDLE',
          START_LOAD: 'LOADING_DATA'
        }
      },
      LOADING_DATA: {
        on: {
          LOAD_SUCCESS: 'DATA_LOADED',
          LOAD_ERROR: 'ERROR_STATE'
        }
      },
      DATA_LOADED: {
        on: {
          CHANGE_FRAME: 'DATA_LOADED',
          SET_VIEW_MODE: 'DATA_LOADED',
          VIEW_SCATTER: 'SCATTER_ANALYSIS',
          TOGGLE_GROUND_MONITORS: 'DATA_LOADED',
          START_LOAD: 'LOADING_DATA'
        }
      },
      SCATTER_ANALYSIS: {
        on: {
          VIEW_TIMELINE: 'DATA_LOADED',
          START_LOAD: 'LOADING_DATA'
        }
      },
      ERROR_STATE: {
        on: {
          RETRY: 'LOADING_DATA',
          RESET: 'IDLE'
        }
      }
    }
  };

  /**
   * Seasonal Anomaly FSM Schema:
   * Manages anomaly calculation lifecycle, baseline reference loading, and results.
   */
  const SEASONAL_ANOMALY_SCHEMA = {
    id: 'seasonal-anomaly',
    initial: 'DISABLED',
    states: {
      DISABLED: {
        on: {
          ENABLE: 'STANDBY',
          SET_AOI: 'STANDBY'
        }
      },
      STANDBY: {
        on: {
          START_CALC: 'CALCULATING',
          RESET: 'STANDBY',
          DISABLE: 'DISABLED'
        }
      },
      CALCULATING: {
        on: {
          CALC_SUCCESS: 'ANOMALY_DISPLAYED',
          ERROR: 'ERROR_STATE',
          CANCEL: 'STANDBY'
        }
      },
      ANOMALY_DISPLAYED: {
        on: {
          CLEAR: 'STANDBY',
          START_CALC: 'CALCULATING',
          EXPORT: 'ANOMALY_DISPLAYED',
          RESET: 'STANDBY'
        }
      },
      ERROR_STATE: {
        on: {
          RETRY: 'CALCULATING',
          RESET: 'STANDBY',
          START_CALC: 'CALCULATING'
        }
      }
    }
  };

  /**
   * Sentinel-1 Radar / SAR Workflow FSM Schema:
   * Coordinates STAC discovery, RTC fetching/signing, local NetCDF rendering, and optical-radar comparison.
   */
  const RADAR_WORKFLOW_SCHEMA = {
    id: 'radar-workflow',
    initial: 'IDLE',
    states: {
      IDLE: {
        on: {
          START_SEARCH: 'SEARCHING'
        }
      },
      SEARCHING: {
        on: {
          SEARCH_SUCCESS: 'SCENES_FOUND',
          SEARCH_EMPTY: 'IDLE',
          ERROR: 'ERROR_STATE',
          CANCEL: 'IDLE'
        }
      },
      SCENES_FOUND: {
        on: {
          SELECT_SCENE: 'RENDERING_RADAR',
          START_SEARCH: 'SEARCHING',
          CLEAR: 'IDLE'
        }
      },
      RENDERING_RADAR: {
        on: {
          RENDER_SUCCESS: 'RADAR_ACTIVE',
          ERROR: 'ERROR_STATE',
          CANCEL: 'SCENES_FOUND'
        }
      },
      RADAR_ACTIVE: {
        on: {
          START_COMPARE: 'COMPARING_OPTICAL_RADAR',
          CLEAR: 'SCENES_FOUND',
          SELECT_SCENE: 'RENDERING_RADAR',
          START_SEARCH: 'SEARCHING'
        }
      },
      COMPARING_OPTICAL_RADAR: {
        on: {
          CLEAR_COMPARE: 'RADAR_ACTIVE',
          SELECT_SCENE: 'RENDERING_RADAR',
          CLEAR: 'SCENES_FOUND'
        }
      },
      ERROR_STATE: {
        on: {
          RETRY: 'SEARCHING',
          RESET: 'IDLE',
          START_SEARCH: 'SEARCHING'
        }
      }
    }
  };

  /**
   * Factory function to create and register a new StateMachine.
   * @param {Object} config
   * @returns {StateMachine}
   */
  function createMachine(config) {
    const machine = new StateMachine(config);
    registry.set(machine.id, machine);

    // Expose machine on global window.__SENTI_MACHINES__ for devtools & AI agents (AX)
    if (typeof window !== 'undefined') {
      window.__SENTI_MACHINES__ = window.__SENTI_MACHINES__ || {};
      window.__SENTI_MACHINES__[machine.id] = machine;

      // Global dispatch helper: window.__SENTI_DISPATCH__(machineId, event, payload)
      window.__SENTI_DISPATCH__ = function (id, event, payload) {
        const m = registry.get(id);
        if (!m) {
          console.warn(`[SentiStateMachine] No machine found with id "${id}".`);
          return false;
        }
        return m.send(event, payload);
      };
    }
    return machine;
  }

  /**
   * Returns a registered StateMachine by id.
   * @param {string} id
   * @returns {StateMachine|null}
   */
  function getMachine(id) {
    return registry.get(id) || null;
  }

  /**
   * Returns a complete JSON snapshot of all registered state machines.
   * Crucial for AI Agents (AX) to read the full app state at any moment.
   * @returns {Object}
   */
  function getAllSnapshots() {
    const snapshots = {};
    for (const [id, m] of registry.entries()) {
      snapshots[id] = m.getSnapshot();
    }
    return snapshots;
  }

  return {
    StateMachine,
    createMachine,
    getMachine,
    getAllSnapshots,
    schemas: {
      S2_PIPELINE: S2_PIPELINE_SCHEMA,
      MAP_INTERACTION: MAP_INTERACTION_SCHEMA,
      AQ_DASHBOARD: AQ_DASHBOARD_SCHEMA,
      SEASONAL_ANOMALY: SEASONAL_ANOMALY_SCHEMA,
      RADAR_WORKFLOW: RADAR_WORKFLOW_SCHEMA
    }
  };
});
