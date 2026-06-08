import { SpriteWrite, SpriteGroup , SpriteRectangle } from '../main.js';

export class SettingsPage {
  // We add physicsStore to the constructor so we can broadcast updates
  constructor(container, heroPool, physicsStore) {
    this.container = container;
    this.heroPool = heroPool;
    this.physicsStore = physicsStore; 

    this.borderBox = new SpriteRectangle(40,60,0.6)
    .setAnchor(30,50)
    .setJustify('left')
    .setAlign('center')
    .setLayers(2)
    .setLayerSpacing(10)
    .setLayerDirection('inwards')
    .setCornerRadius(5)
    .attach(this.heroPool);
    
    this.spriteController = new SpriteWrite(
      "[i]Engine Settings[/i]", 
      14
    )
    .setAnchor(50, 30)
    .setJustify('center')
    .setAlign('center')
    .setWrap(true)
    .attach(this.heroPool);

    this.pageTextController = new SpriteWrite("settings", 9, 0.8)
    .setAnchor(50, 98)
    .setJustify('center')
    .setAlign('top')
    .attach(this.heroPool);

    this.spriteGroup = new SpriteGroup().attach(heroPool);
    this.spriteGroup.add(this.spriteController, container);
    this.spriteGroup.add(this.pageTextController, container);
    this.spriteGroup.add(this.borderBox, container);
  }

  async mount() {
    // Inject the slider UI
    this.container.innerHTML = `
      <div class="page-settings" style="position: absolute; top: 55%; left: 50%; transform: translate(-50%, -50%); text-align: center; color: white; font-family: monospace; pointer-events: auto;">
        <label for="speed-slider" style="display: block; margin-bottom: 10px;">Sprite Speed</label>
        <input type="range" id="speed-slider" min="0.005" max="0.15" step="0.001" style="width: 200px;">
        <div id="speed-value" style="margin-top: 10px;"></div>
      </div>
    `;

    // Hook up the physics store
    const slider = document.getElementById('speed-slider');
    const display = document.getElementById('speed-value');
    
    // Set initial slider value from the store
    const currentSpeed = this.physicsStore.getConfig().DEFAULT_SPRITE_SPEED;
    slider.value = currentSpeed;
    display.innerText = currentSpeed;

    // Broadcast changes on drag
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      display.innerText = val;
      this.physicsStore.update('DEFAULT_SPRITE_SPEED', val);
    });
  }

  async unmount() {
    this.container.innerHTML = '';
  }

  getSpriteConfig() {
    return this.spriteGroup;
  }
}