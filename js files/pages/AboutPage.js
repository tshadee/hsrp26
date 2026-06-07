import { SpriteWrite , SpriteGroup } from '../main.js';

export class AboutPage {
  constructor(container, heroPool) {
    this.container = container;
    this.heroPool = heroPool;
    
    this.spriteController = new SpriteWrite(
      "[i][b]H[/b]ydrophase'[b]S[/b] [b]R[/b]e[b]P[/b]o[/i] 2026\nwebsite in development...\n\nBack to [a:0]Home Page[/a]\n", 
      14
    )
    .setAnchor(50, 50)
    .setJustify('center')
    .setAlign('center')
    .setWrap(true)
    .attach(this.heroPool);

    this.pageTextController = new SpriteWrite("about", 8, 0.5)
    .setAnchor(50,98)
    .setJustify('center')
    .setAlign('top')
    .attach(this.heroPool);

    this.spriteGroup = new SpriteGroup().attach(heroPool);
    this.spriteGroup.add(this.spriteController, container);
    this.spriteGroup.add(this.pageTextController, container);
  }

  async mount() {
    // Example of failsafe HTML for standard text or links
    this.container.innerHTML = `
      <div class="page-about">
      </div>
    `;
  }

  async unmount() {
    this.container.innerHTML = '';
  }

  getSpriteConfig() {
    return this.spriteGroup;
  }
}