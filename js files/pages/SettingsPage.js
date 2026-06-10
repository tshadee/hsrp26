import { SpriteWrite, SpriteGroup, SpriteRectangle, SpriteSlider } from '../main.js';

// Define the limits for all engine variables
const PHYSICS_CONFIGS = [
  { id: 'DEFAULT_SPRITE_SPEED', name: 'SPRITE SPEED', min: 0.005, max: 0.15 },
  { id: 'DEFAULT_SPRITE_SPEED_VARIANCE', name: 'SPEED VARIANCE', min: 0.0, max: 0.15 },
  { id: 'SPRITE_DRAG_BASE', name: 'DRAG BASE', min: 0.01, max: 0.3 },
  { id: 'SPRITE_DRAG_VARIANCE', name: 'DRAG VARIANCE', min: 0.0, max: 0.8 },
  { id: 'SPRITE_SPAWN_RADIUS_BASE', name: 'SPAWN RADIUS', min: 5, max: 100 },
  { id: 'SPRITE_SPAWN_RADIUS_VARIANCE', name: 'SPAWN VARIANCE', min: 0, max: 100 },
  { id: 'SPRITE_CLICK_FORCE', name: 'CLICK FORCE', min: 1, max: 50 },
  { id: 'SPRITE_CLICK_FORCE_RADIUS', name: 'CLICK RADIUS', min: 0.01, max: 0.3 },
  { id: 'SPRITE_HOVER_RADIUS', name: 'HOVER RADIUS', min: 0.01, max: 0.1 },
  { id: 'MORPH_TIME_CULLING_MS', name: 'CULLING TIME', min: 1000, max: 5000 },
  { id: 'K_ALPHA_MULTIPLIER', name: 'ALPHA MULTIPLIER', min: 0.1, max: 2.0 },
  { id: 'YIELD_BATCH_SIZE_PER_FRAME', name: 'BATCH SIZE', min: 50, max: 1000 },
  { id: 'SPRITE_SHEDDING_THRESHOLD', name: 'SHED THRESHOLD', min: 0.1, max: 0.3 }
];

export class SettingsPage {
  constructor(container, heroPool, physicsStore) {
    this.container = container;
    this.heroPool = heroPool;
    this.physicsStore = physicsStore; 
    this.sliderInstances = {};

    this.spriteGroup = new SpriteGroup().attach(heroPool);

    this.settingsBorderBox = new SpriteRectangle(35, 80, 0.6)
      .setAnchor(25, 50).setJustify('center').setAlign('center')
      .setLayers(2).setLayerSpacing(8).setLayerDirection('inwards')
      .setCornerRadius(5);
    
    this.spriteController = new SpriteWrite("[i]PhysEngine Settings[/i]", 12)
      .setAnchor(25, 25).setJustify('center').setAlign('center').setWrap(true);

    this.sprite2Controller = new SpriteWrite("Get jiggy wid it\n\nThe logo has been reduced\nto 50% density\nMigrating the\nengine to WebGL\n\n[a:0]Back to Home[a]\n\n[a:2]Go to About[a]", 9, 1.0)
      .setAnchor(25, 35).setJustify('center').setAlign('top').setWrap(true);

    this.pageTextController = new SpriteWrite("settings", 9, 0.8)
      .setAnchor(50, 95).setJustify('center').setAlign('top');

    this.spriteGroup.add(this.settingsBorderBox, container);
    this.spriteGroup.add(this.spriteController, container);
    this.spriteGroup.add(this.sprite2Controller, container);
    this.spriteGroup.add(this.pageTextController, container);

    this._buildSliders(container);

    this.onSliderDrag = this.onSliderDrag.bind(this);
    this.onSliderDrop = this.onSliderDrop.bind(this);
  }

  _buildSliders(container) {
    let startY = 15; // Starting Y percentage for the top slider
    const spacingY = 6; // Percentage gap between each slider

    PHYSICS_CONFIGS.forEach((config) => {
      // Grab current value from store, or default to halfway
      const currentValue = this.physicsStore.config[config.id] ?? ((config.min + config.max) / 2);
      const currentPercent = this._mapToPercent(currentValue, config.max, config.min);

      // 1. Build the Label
      const label = new SpriteWrite(config.name.toLowerCase(), 6)
        .setAnchor(45, startY)
        .setJustify('left')
        .setAlign('center');

      // 2. Build the Slider Track
      const slider = new SpriteSlider(30, 1.2, 0.6)
        .setId(config.id)
        .setAnchor(88, startY) // Aligned to the right side of the screen
        .setJustify('right')
        .setAlign('center')
        .setBallPosition(currentPercent);

      // Save to instance dictionary and add to group
      this.sliderInstances[config.id] = slider;
      this.spriteGroup.add(label, container);
      this.spriteGroup.add(slider, container);

      startY += spacingY;
    });
  }

  _mapToPercent(val, max, min) { return ((val - min) / (max - min)) * 100; }
  _mapToPhysics(percent, max, min) { return min + (percent / 100) * (max - min); }

  _getConfigById(id) {
    return PHYSICS_CONFIGS.find(c => c.id === id);
  }

  // Fires continuously while moving the mouse. Updates engine instantly.
  onSliderDrag(e) {
    const config = this._getConfigById(e.detail.id);
    if (!config) return;
    
    const sliderPercent = e.detail.value;
    const actualPhysicsValue = this._mapToPhysics(sliderPercent, config.max, config.min);
    
    this.physicsStore.update(config.id, actualPhysicsValue);
  }

  // Fires ONLY when the mouse is released. Triggers the heavy sprite morph.
  onSliderDrop(e) {
    const config = this._getConfigById(e.detail.id);
    if (!config || !this.sliderInstances[config.id]) return;
    
    const sliderPercent = e.detail.value;
    this.sliderInstances[config.id].morphValueTo(sliderPercent);
  }

  async mount() {
    this.container.innerHTML = ``; 
    window.addEventListener('hsrp-slider-drag', this.onSliderDrag);
    window.addEventListener('hsrp-slider-drop', this.onSliderDrop);
  }

  async unmount() {
    this.container.innerHTML = '';
    window.removeEventListener('hsrp-slider-drag', this.onSliderDrag);
    window.removeEventListener('hsrp-slider-drop', this.onSliderDrop);
  }

  getSpriteConfig() {
    return this.spriteGroup;
  }
}