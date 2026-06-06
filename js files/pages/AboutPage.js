import { SpriteWrite } from '../main.js';

export class AboutPage {
  constructor(container, heroPool) {
    this.container = container;
    this.heroPool = heroPool;
    
    // A static layout for the about page
    this.spriteController = new SpriteWrite("about page\n\n\nHydrophase'S RePo 2026\nin development...", 14).attach(this.heroPool);
  }

  async mount() {
    // Example of failsafe HTML for standard text or links
    this.container.innerHTML = `
      <div class="page-about" style="position: absolute; bottom: 10%; width: 100%; text-align: center;">
        <a href="https://hsrp.cc" style="color: white; z-index: 20;">hsrp.cc</a>
      </div>
    `;
  }

  async unmount() {
    this.container.innerHTML = '';
  }

  getSpriteConfig() {
    return this.spriteController;
  }
}