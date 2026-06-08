export class PhysicsStore {
  constructor() {
    this.pools = [];
    this.storageKey = 'hsrp_physics_config';

    // Baseline fallback values.
    this.defaults = {
      DEFAULT_SPRITE_SPEED: 0.04,
      DEFAULT_SPRITE_SPEED_VARIANCE: 0.04,
      SPRITE_DRAG_BASE: 0.1,
      SPRITE_DRAG_VARIANCE: 0.4,
      SPRITE_SPAWN_RADIUS_BASE: 20,
      SPRITE_SPAWN_RADIUS_VARIANCE: 30,
      SPRITE_CLICK_FORCE: 10,
      SPRITE_CLICK_FORCE_RADIUS: 0.085,
      SPRITE_HOVER_RADIUS: 0.015,
      MORPH_TIME_CULLING_MS: 5000,
      K_ALPHA_MULTIPLIER: 0.85,
      YIELD_BATCH_SIZE_PER_FRAME: 333
    };

    this.config = this._loadFromStorage();
  }

  _loadFromStorage() {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        // Merge saved data over defaults in case new variables added later
        return { ...this.defaults, ...JSON.parse(saved) }; 
      }
    } catch (e) {
      console.warn("Could not read from localStorage, using defaults.", e);
    }
    return { ...this.defaults };
  }

  _saveToStorage() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (e) {
      console.warn("Could not save to localStorage.", e);
    }
  }

  register(pool) {
    this.pools.push(pool);
    // Instantly sync the newly registered pool with the current loaded settings
    pool.updatePhysics(this.config);
  }

  update(key, value) {
    if (this.config[key] !== undefined) {
      this.config[key] = value;
      this._saveToStorage();
      this._broadcast();
    }
  }

  resetToDefaults() {
    this.config = { ...this.defaults };
    this._saveToStorage();
    this._broadcast();
  }

  _broadcast() {
    for (const pool of this.pools) {
      pool.updatePhysics(this.config);
    }
  }
  
  getConfig() {
    return { ...this.config };
  }
}